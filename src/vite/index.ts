import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Plugin, ResolvedConfig, ViteBuilder } from 'vite';

import { SERVER_FN_PREFIX } from '../constants';
import {
	collectDevCssIds,
	installDevMiddleware,
	sendResponse,
	toWebRequest,
} from './dev-middleware';
import { hasResolvedNitroPlugin, nitroBeforeRiproute, resolveAdapter } from './nitro';
import type { AdapterName } from './options';
import { resolveOptions } from './options';
import type { ResolvedRiprouteOptions, RiprouteOptions } from './options';
import { ROUTE_EXTENSIONS, scanRoutes } from './route-scan';
import type { DiscoveredRoutes } from './route-scan';
import { isScaffoldable, scaffoldRoute } from './scaffold';
import { normalizeId } from './package-root';
import { isServerFnFile, scanServerFnFiles, serverFnClientPlugin } from './server-fn';
import { serverGuardPlugin } from './server-guard';
import { tsrxFallbackPlugin } from './tsrx-fallback';
import { extractBaseTitle, titleRewritePlugin } from './title-rewrite';
import {
	CLIENT_ID,
	DEV_CSS_IDS_PATH,
	HANDLER_ID,
	NITRO_ID,
	ROUTES_ID,
	SERVER_FNS_ID,
	SERVER_ID,
	VIRTUAL_IDS,
	generateClientModule,
	generateHandlerModule,
	generateNitroModule,
	generateRoutesModule,
	generateRoutesProxyModule,
	generateServerFnManifestModule,
	generateServerModule,
	resolvedId,
} from './virtual-modules';

export type { RiprouteOptions, ServerOnlyOptions } from './options';
export {
	ROUTES_ID,
	CLIENT_ID,
	HANDLER_ID,
	SERVER_ID,
	NITRO_ID,
	SERVER_FNS_ID,
} from './virtual-modules';

// Named `index`, so Vite names the built assets exactly as it would for a
// plain index.html app: `assets/index-<hash>.js`. The prefix carried no
// information a consumer wanted in their asset URLs.
const CLIENT_ENTRY_NAME = 'index';
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
 *
 * The production target is chosen with `riproute({ adapter })`: `'node'`
 * (default) and `'bun'` emit riproute's own server entry for that runtime,
 * while `'nitro'` hands off to nitro. With `nitro()` from `nitro/vite` in the
 * array the adapter defaults to `'nitro'` without any option — see `nitro.ts`.
 * The build bundles only the chosen adapter.
 *
 * Ordering does not matter, but not for free: `ripple()`'s compile transform is
 * *also* `enforce: 'pre'`, so with `[ripple(), riproute()]` it would compile
 * `.tsrx` before any riproute transform. The title rewrite therefore happens in
 * a `load` hook, which every plugin's transform runs after regardless of array
 * order.
 */
export function riproute(userOptions: RiprouteOptions = {}): Plugin[] {
	return [
		titleRewritePlugin(),
		// Before the guard: the swap happens in `load`, but the guard's
		// `resolveId` is what lets a serverFn-carrying import through to it.
		serverFnClientPlugin(),
		serverGuardPlugin(userOptions.serverOnly),
		corePlugin(userOptions),
		// Post-enforce: compiles only the query-carrying `.tsrx` ids that
		// `@ripple-ts/vite-plugin`'s end-anchored filter misses when riproute is
		// a real dependency inside node_modules.
		tsrxFallbackPlugin(),
	];
}

export default riproute;

function corePlugin(userOptions: RiprouteOptions): Plugin {
	let config: ResolvedConfig;
	let options: ResolvedRiprouteOptions;
	let discovered: DiscoveredRoutes = { routes: [], root: null };
	/** `<title>` found in the root route's `<head>`, if it wrote one. */
	let baseTitle: string | null = null;
	/** `<script>`/`<link>` tags for the built client, filled in by the client build. */
	let clientTags = '';
	/** Whether nitro owns the server. See `nitro.ts` for how the wiring works. */
	let nitroMode = false;
	/** The resolved target: `'node'`, `'bun'` or `'nitro'`. */
	let adapter: AdapterName = 'node';
	/** `*.server.*` files under src/, for the server-function manifest. */
	let serverFnFiles: string[] = [];

	/**
	 * Re-reads the base title from the root route.
	 *
	 * Cheap and best-effort: a root route mid-edit will not parse, and the
	 * previous value is a better answer than crashing the dev server over it.
	 */
	async function refreshBaseTitle(): Promise<void> {
		if (discovered.root === null) {
			baseTitle = null;
			return;
		}

		try {
			baseTitle = await extractBaseTitle(
				await fs.readFile(discovered.root, 'utf-8'),
				discovered.root
			);
		} catch {
			// Leave the last good value in place.
		}
	}

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

		// One instance across the client and ssr builds. The client build
		// collects the hashed asset tags; the ssr build bakes them into the
		// generated server — with per-environment instances the tags would
		// never make the trip.
		sharedDuringBuild: true,

		config(userConfig, env) {
			const root = path.resolve(userConfig.root ?? process.cwd());
			const resolved = resolveOptions(userOptions, root);

			adapter = resolveAdapter(userOptions, userConfig.plugins);
			nitroMode = adapter === 'nitro';

			const shared = {
				// Vite's SPA fallback would answer every navigation with the raw
				// index.html before the router ever sees the request.
				appType: 'custom' as const,
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
				builder: {
					async buildApp(builder: ViteBuilder) {
						// Client first: the server entry reads the shell the client
						// build writes, complete with hashed asset URLs. In nitro
						// mode this runs right before nitro's own (post-ordered)
						// buildApp hook, which skips environments already built here
						// and goes on to produce `.output/`.
						await builder.build(builder.environments.client);
						await builder.build(builder.environments.ssr);
					},
				},
			};

			if (nitroMode) {
				return {
					...shared,
					environments: {
						client: {
							build: {
								// Output dirs are nitro's: the client lands in its
								// public directory, the ssr service in its build dir.
								assetsDir: resolved.assetsDir,
								manifest: true,
								rollupOptions: { input: { [CLIENT_ENTRY_NAME]: CLIENT_ID } },
							},
						},
						ssr: {
							build: {
								// Nitro reads this input as its `ssr` service entry
								// (the plugin array puts nitro after riproute, so its
								// config hook sees the value planted here) and routes
								// every page request to the module's `fetch`.
								rollupOptions: { input: { index: NITRO_ID } },
							},
						},
					},
				};
			}

			return {
				...shared,
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
				build: env.isSsrBuild ? undefined : { outDir: resolved.clientOutDir },
			};
		},

		async configResolved(resolved) {
			config = resolved;
			options = resolveOptions(userOptions, resolved.root);

			const nitroPluginPresent = hasResolvedNitroPlugin(resolved.plugins);

			if (nitroMode && nitroBeforeRiproute(resolved.plugins)) {
				resolved.logger.warn(
					'[riproute] nitro() comes before riproute() in `plugins`. Nitro reads ' +
						'the ssr entry riproute plants during config resolution, so it has ' +
						'to run after riproute — move nitro() to the end of the array.'
				);
			}

			// The adapter choice and the plugin list have to agree: nitro's plugin
			// rewrites the whole build, so it cannot coexist with a node/bun entry,
			// and adapter:'nitro' without the plugin has nothing to hand off to.
			if (nitroMode && !nitroPluginPresent) {
				resolved.logger.warn(
					"[riproute] adapter: 'nitro' is set but nitro() is not in `plugins`. " +
						"Add nitro() from 'nitro/vite' (after riproute), or pick adapter: 'node' | 'bun'."
				);
			}

			if (!nitroMode && nitroPluginPresent) {
				resolved.logger.warn(
					`[riproute] nitro() is in \`plugins\` but adapter is '${adapter}'. Nitro drives ` +
						"the build regardless — set adapter: 'nitro' (or remove nitro() to use the " +
						`'${adapter}' entry).`
				);
			}

			warnAboutRippleConfig(resolved.root);
			rescan();
			serverFnFiles = scanServerFnFiles(resolved.root);
			await refreshBaseTitle();
		},

		resolveId(id) {
			return (VIRTUAL_IDS as readonly string[]).includes(id) ? resolvedId(id) : null;
		},

		async load(id) {
			switch (id) {
				case resolvedId(ROUTES_ID):
					return options.routesModule !== null
						? generateRoutesProxyModule(
								options.routesModule,
								options,
								config.root,
								baseTitle
							)
						: generateRoutesModule(discovered, options, config.root, baseTitle);

				case resolvedId(CLIENT_ID):
					return generateClientModule();

				case resolvedId(HANDLER_ID):
					return generateHandlerModule(options, config.root);

				case resolvedId(SERVER_ID):
					return generateServerModule(
						options,
						clientTags,
						adapter === 'bun' ? 'bun' : 'node'
					);

				case resolvedId(SERVER_FNS_ID):
					return generateServerFnManifestModule(serverFnFiles, config.root);

				case resolvedId(NITRO_ID): {
					const dev = config.command === 'serve';

					return generateNitroModule(options, {
						dev,
						base: config.base === '' ? '/' : config.base,
						tags: clientTags,
						// Baked into the bundle rather than written into nitro's
						// public directory, where a static index.html would be
						// served for `/` ahead of the renderer.
						template: dev
							? null
							: await fs.readFile(options.template, 'utf-8').catch(() => null),
					});
				}

				default:
					return null;
			}
		},

		configureServer(server) {
			if (options.routesDir !== null) server.watcher.add(options.routesDir);

			/**
			 * Fills a freshly created, still-empty route file with a working
			 * template — TanStack Start's create-a-file workflow. Guarded hard on
			 * emptiness: a populated file arriving in the watcher is real work
			 * (a git checkout, a paste) and is never touched.
			 */
			const maybeScaffold = async (file: string): Promise<void> => {
				if (userOptions.scaffold === false || options.routesDir === null) return;
				if (!isScaffoldable(file)) return;

				try {
					const stats = await fs.stat(file);

					// An editor that saved content before the watcher fired.
					if (stats.size > 0) return;

					const template = scaffoldRoute(file, options.routesDir);

					if (template === null) return;

					await fs.writeFile(file, template, { flag: 'wx' }).catch(async () => {
						// The file exists (we just statted it) so `wx` refuses;
						// re-check emptiness at the last moment and write over
						// nothing but nothing.
						if ((await fs.readFile(file, 'utf-8')) === '') {
							await fs.writeFile(file, template);
						}
					});

					config.logger.info(`riproute: scaffolded ${path.relative(config.root, file)}`, {
						timestamp: true,
					});
				} catch {
					// A vanished file or an unreadable one — nothing to scaffold.
				}
			};

			const onRouteFileChange = (file: string, added = false) => {
				if (options.routesDir === null) return;
				// Chokidar emits native separators; compare in posix on both sides.
				if (!normalizeId(file).startsWith(`${normalizeId(options.routesDir)}/`)) return;
				if (!ROUTE_EXTENSIONS.includes(path.extname(file))) return;

				if (added) void maybeScaffold(file);

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

			/**
			 * Keeps the server-function manifest in step with the filesystem.
			 * The manifest maps endpoint hashes to export names, so it changes
			 * when files appear or disappear *and* when a file's `serverFn`
			 * exports change — every event invalidates it. Vite reinvalidates
			 * the edited module itself either way.
			 */
			const onServerFnFileChange = (file: string, rescanFiles = false) => {
				if (!isServerFnFile(file)) return;
				if (!normalizeId(file).startsWith(`${normalizeId(config.root)}/`)) return;

				if (rescanFiles) serverFnFiles = scanServerFnFiles(config.root);

				for (const environment of Object.values(server.environments)) {
					const module = environment.moduleGraph.getModuleById(resolvedId(SERVER_FNS_ID));

					if (module != null) environment.moduleGraph.invalidateModule(module);
				}

				server.hot.send({ type: 'full-reload' });
			};

			server.watcher.on('add', (file) => {
				onRouteFileChange(file, true);
				onServerFnFileChange(file, true);
			});
			server.watcher.on('unlink', (file) => {
				onRouteFileChange(file);
				onServerFnFileChange(file, true);
			});
			server.watcher.on('change', (file) => onServerFnFileChange(file));

			if (nitroMode) {
				// Nitro's dev middleware answers the page requests; riproute's own
				// SSR middleware would never see one. What the nitro entry cannot
				// reach from inside the environment runner is the server-side
				// module graph, so the CSS ids it inlines against FOUC are served
				// from here. (Nitro skips `/__*` URLs, so this stays reachable.)
				server.middlewares.use(DEV_CSS_IDS_PATH, (_req, res) => {
					res.setHeader('content-type', 'application/json');
					res.end(JSON.stringify(collectDevCssIds(server)));
				});

				// Server-function endpoints live under `/__riproute/`, which
				// nitro's dev middleware deliberately skips — so riproute routes
				// them to the handler inside nitro's ssr service itself.
				server.middlewares.use(async (req, res, next) => {
					const url = (req.originalUrl ?? req.url ?? '').split('?')[0];

					if (!url.startsWith(SERVER_FN_PREFIX)) return next();

					const ssr = server.environments.ssr as unknown as {
						dispatchFetch?: (request: Request) => Promise<Response>;
					};

					if (typeof ssr?.dispatchFetch !== 'function') return next();

					try {
						await sendResponse(res, await ssr.dispatchFetch(toWebRequest(req)));
					} catch (error) {
						next(error);
					}
				});

				return;
			}

			return installDevMiddleware(server, options);
		},

		/**
		 * Collects the built asset tags, and writes the shell when there is one
		 * on disk.
		 *
		 * Vite's HTML pipeline is not involved — `appType` is `'custom'` and the
		 * client entry is a virtual module, so there is no HTML entry for Vite to
		 * process. An app whose root route renders the document has no
		 * `index.html` at all; there the tags are handed to the generated server,
		 * which injects them into the rendered document. The SSR build runs after
		 * this one, so `clientTags` is set by the time it asks.
		 */
		async writeBundle(_outputOptions, bundle) {
			if (this.environment?.name !== 'client') return;

			const entry = Object.values(bundle).find(
				(chunk) =>
					chunk.type === 'chunk' && chunk.isEntry && chunk.name === CLIENT_ENTRY_NAME
			);

			if (entry === undefined || entry.type !== 'chunk') return;

			const base = config.base === '' ? '/' : config.base;

			clientTags = [
				...collectCss(bundle, entry.fileName).map(
					(file) => `<link rel="stylesheet" crossorigin href="${base}${file}">`
				),
				`<script type="module" crossorigin src="${base}${entry.fileName}"></script>`,
			].join('');

			// In nitro mode the template is baked into the ssr service instead:
			// an index.html in nitro's public directory would be served for `/`
			// as a static asset, shadowing the renderer.
			if (nitroMode) return;

			const raw = await fs.readFile(options.template, 'utf-8').catch(() => null);

			if (raw === null) return;

			const html = raw.includes('</head>')
				? raw.replace('</head>', `\t${clientTags}\n\t</head>`)
				: raw + clientTags;

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
