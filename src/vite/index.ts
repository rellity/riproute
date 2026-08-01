import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

import { installDevMiddleware } from './dev-middleware';
import { resolveOptions } from './options';
import type { ResolvedRiprouteOptions, RiprouteOptions } from './options';
import { ROUTE_EXTENSIONS, scanRoutes } from './route-scan';
import type { DiscoveredRoutes } from './route-scan';
import { serverGuardPlugin } from './server-guard';
import { titleRewritePlugin } from './title-rewrite';
import {
	CLIENT_ID,
	HANDLER_ID,
	ROUTES_ID,
	SERVER_ID,
	VIRTUAL_IDS,
	generateClientModule,
	generateHandlerModule,
	generateRoutesModule,
	generateRoutesProxyModule,
	generateServerModule,
	resolvedId,
} from './virtual-modules';

export type { RiprouteOptions, ServerOnlyOptions } from './options';
export { ROUTES_ID, CLIENT_ID, HANDLER_ID, SERVER_ID } from './virtual-modules';

const CLIENT_ENTRY_NAME = 'riproute-client';
// `dist/server/index.js` — the conventional entry name, so `node dist/server`
// and a bare `import('./dist/server')` both work.
const SERVER_ENTRY_NAME = 'index';

/**
 * The riproute Vite plugin.
 *
 * Add it alongside Ripple's own plugin, the way a TanStack Start app adds its
 * framework plugin:
 *
 * ```ts
 * plugins: [riproute(), ripple()];
 * ```
 *
 * riproute does not wrap or vendor `ripple()` — that plugin owns `.tsrx`
 * compilation, scoped CSS, HMR and the dependency scanner, and it stays the
 * consumer's to configure. riproute contributes routing, SSR and the build.
 * Ordering does not matter: everything here is `enforce: 'pre'`, and Ripple's
 * compile step is not.
 */
export function riproute(userOptions: RiprouteOptions = {}): Plugin[] {
	return [
		titleRewritePlugin(),
		serverGuardPlugin(userOptions.serverOnly),
		corePlugin(userOptions),
	];
}

export default riproute;

function corePlugin(userOptions: RiprouteOptions): Plugin {
	let config: ResolvedConfig;
	let options: ResolvedRiprouteOptions;
	let discovered: DiscoveredRoutes = { routes: [], root: null };

	function rescan(): boolean {
		if (options.routesDir === null) return false;

		const next = scanRoutes(options.routesDir);
		const changed =
			next.root !== discovered.root ||
			next.routes.length !== discovered.routes.length ||
			next.routes.some(
				(route, index) =>
					route.path !== discovered.routes[index]?.path ||
					route.file !== discovered.routes[index]?.file
			);

		discovered = next;

		return changed;
	}

	return {
		name: 'riproute',

		config(userConfig, env) {
			const root = path.resolve(userConfig.root ?? process.cwd());
			const resolved = resolveOptions(userOptions, root);

			return {
				// Vite's SPA fallback would answer every navigation with the raw
				// index.html before the router ever sees the request.
				appType: 'custom',
				resolve: {
					// Two copies of the Ripple runtime means two `active_component`
					// bindings, and `Context.set()` throws against the wrong one.
					dedupe: ['ripple'],
				},
				optimizeDeps: {
					// riproute ships `.tsrx` source. esbuild has no loader for it,
					// so pre-bundling would fail — and, worse, would give the app
					// a second Ripple runtime instance.
					exclude: ['riproute'],
				},
				ssr: {
					// The same reasoning, on the server side: externalising
					// riproute loads its `.tsrx` outside Vite's transform.
					noExternal: ['riproute'],
				},
				environments: {
					client: {
						build: {
							outDir: resolved.clientOutDir,
							assetsDir: resolved.assetsDir,
							manifest: true,
							rollupOptions: { input: { [CLIENT_ENTRY_NAME]: CLIENT_ID } },
						},
					},
					ssr: {
						build: {
							outDir: resolved.serverOutDir,
							// The server bundle is read by Node, never by a browser,
							// so there is nothing to hash against.
							rollupOptions: {
								input: { [SERVER_ENTRY_NAME]: SERVER_ID },
								output: { entryFileNames: '[name].js' },
							},
						},
					},
				},
				builder: {
					async buildApp(builder) {
						// Client first: the server entry reads the shell the client
						// build writes, complete with hashed asset URLs.
						await builder.build(builder.environments.client);
						await builder.build(builder.environments.ssr);
					},
				},
				build: env.isSsrBuild ? undefined : { outDir: resolved.clientOutDir },
			};
		},

		configResolved(resolved) {
			config = resolved;
			options = resolveOptions(userOptions, resolved.root);

			warnAboutRippleConfig(resolved.root);
			rescan();
		},

		resolveId(id) {
			return (VIRTUAL_IDS as readonly string[]).includes(id) ? resolvedId(id) : null;
		},

		load(id) {
			switch (id) {
				case resolvedId(ROUTES_ID):
					return options.routesModule !== null
						? generateRoutesProxyModule(options.routesModule, options, config.root)
						: generateRoutesModule(discovered, options, config.root);

				case resolvedId(CLIENT_ID):
					return generateClientModule();

				case resolvedId(HANDLER_ID):
					return generateHandlerModule();

				case resolvedId(SERVER_ID):
					return generateServerModule(options);

				default:
					return null;
			}
		},

		configureServer(server) {
			if (options.routesDir !== null) server.watcher.add(options.routesDir);

			const onRouteFileChange = (file: string) => {
				if (options.routesDir === null) return;
				if (!file.startsWith(options.routesDir + path.sep)) return;
				if (!ROUTE_EXTENSIONS.includes(path.extname(file))) return;
				if (!rescan()) return;

				const module = server.environments.client.moduleGraph.getModuleById(
					resolvedId(ROUTES_ID)
				);

				if (module != null) server.environments.client.moduleGraph.invalidateModule(module);

				const ssrModule = server.environments.ssr?.moduleGraph.getModuleById(
					resolvedId(ROUTES_ID)
				);

				if (ssrModule != null)
					server.environments.ssr.moduleGraph.invalidateModule(ssrModule);

				// The table is imported by both entries; a reload is cheaper than
				// reasoning about which half of the graph is stale.
				server.hot.send({ type: 'full-reload' });
			};

			server.watcher.on('add', onRouteFileChange);
			server.watcher.on('unlink', onRouteFileChange);

			return installDevMiddleware(server, options);
		},

		/**
		 * Writes the production shell.
		 *
		 * Vite's HTML pipeline is not involved — `appType` is `'custom'` and the
		 * client entry is a virtual module, so there is no HTML entry for Vite to
		 * process. The manifest gives us the hashed entry chunk and its CSS.
		 */
		async writeBundle(_outputOptions, bundle) {
			if (this.environment?.name !== 'client') return;

			const entry = Object.values(bundle).find(
				(chunk) =>
					chunk.type === 'chunk' && chunk.isEntry && chunk.name === CLIENT_ENTRY_NAME
			);

			if (entry === undefined || entry.type !== 'chunk') return;

			const raw = await fs.readFile(options.template, 'utf-8');
			const base = config.base === '' ? '/' : config.base;
			const tags = [
				...collectCss(bundle, entry.fileName).map(
					(file) => `<link rel="stylesheet" crossorigin href="${base}${file}">`
				),
				`<script type="module" crossorigin src="${base}${entry.fileName}"></script>`,
			].join('\n\t\t');

			const html = raw.includes('</head>')
				? raw.replace('</head>', `\t${tags}\n\t</head>`)
				: raw + tags;

			await fs.mkdir(options.clientOutDir, { recursive: true });
			await fs.writeFile(path.join(options.clientOutDir, 'index.html'), html, 'utf-8');
		},
	};
}

/**
 * Warns when the app has a `ripple.config.ts`.
 *
 * riproute never reads one, but its mere existence switches
 * `@ripple-ts/vite-plugin` into metaframework mode: it loads the file, builds a
 * router from it, and registers an SSR middleware *ahead* of Vite's own stack —
 * ahead of riproute's, which installs after Vite's on purpose. Requests then get
 * answered by the wrong router, and the symptom is a dev server that serves HTML
 * for `/@vite/client` and a page that never hydrates. That took a long time to
 * diagnose once; it should not have to happen twice.
 */
function warnAboutRippleConfig(root: string): void {
	const candidates = ['ripple.config.ts', 'ripple.config.js', 'ripple.config.mjs'];
	const found = candidates.find((name) => existsSync(path.join(root, name)));

	if (found === undefined) return;

	// eslint-disable-next-line no-console
	console.warn(
		`\n[riproute] Found ${found}.\n` +
			'  riproute does not read it, but @ripple-ts/vite-plugin does, and having one\n' +
			'  puts that plugin in charge of routing — its dev middleware runs before\n' +
			"  Vite's own and will intercept requests riproute expects to answer.\n" +
			'  Delete it, or move its settings into vite.config.ts.\n'
	);
}

/** Collects the stylesheets an entry chunk and its imports pull in. */
function collectCss(
	bundle: Record<string, { type: string } & Record<string, any>>,
	entryFileName: string
): string[] {
	const seen = new Set<string>();
	const css: string[] = [];
	const queue = [entryFileName];

	while (queue.length > 0) {
		const name = queue.shift() as string;

		if (seen.has(name)) continue;

		seen.add(name);

		const chunk = bundle[name];

		if (chunk === undefined || chunk.type !== 'chunk') continue;

		for (const file of chunk.viteMetadata?.importedCss ?? []) {
			if (!css.includes(file)) css.push(file);
		}

		queue.push(...(chunk.imports ?? []));
	}

	return css;
}
