import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ServerOnlyOptions } from './server-guard';

export type { ServerOnlyOptions };

export type RiprouteOptions = {
	/**
	 * Directory scanned for route files. Relative to the Vite root.
	 *
	 * Set to `false` to turn file routing off and supply the table yourself
	 * through `routes`.
	 */
	routesDir?: string | false;
	/**
	 * Module exporting a `routes` array (and optionally a `root` layout), for
	 * code-first apps. Takes precedence over `routesDir`.
	 */
	routes?: string;
	/**
	 * Module exporting `onRequest` / `onError`, for anything that is not a page
	 * — JSON endpoints, redirects, auth gates.
	 *
	 * Defaults to `src/hooks.server.ts` when it exists. `false` disables the
	 * lookup.
	 */
	hooks?: string | false;
	/** HTML shell. Relative to the Vite root. */
	template?: string;
	/** Element the app is rendered into. */
	rootId?: string;
	/** Mount the app under a path prefix, e.g. `/app`. */
	base?: string;
	/** Default document title, and what `&title` expands to. */
	title?: string;
	/** Client build output directory, relative to the Vite root. */
	clientOutDir?: string;
	/** Server build output directory, relative to the Vite root. */
	serverOutDir?: string;
	/** Tune which modules the client bundle refuses to import. */
	serverOnly?: ServerOnlyOptions;
	/**
	 * Write a working template into a new *empty* route file while the dev
	 * server is running, the way TanStack Start does. On by default.
	 */
	scaffold?: boolean;
};

export type ResolvedRiprouteOptions = {
	routesDir: string | null;
	routesModule: string | null;
	/** Absolute path of the hooks module, or `null` when the app has none. */
	hooksModule: string | null;
	template: string;
	rootId: string;
	base: string;
	title: string | undefined;
	clientOutDir: string;
	serverOutDir: string;
	assetsDir: string;
	/** Relative path from the server output to the client output, at runtime. */
	clientDirFromServer: string;
};

const DEFAULTS = {
	routesDir: 'src/routes',
	hooks: 'src/hooks.server',
	template: 'index.html',
	rootId: 'root',
	clientOutDir: 'dist/client',
	serverOutDir: 'dist/server',
	assetsDir: 'assets',
};

export function resolveOptions(options: RiprouteOptions, root: string): ResolvedRiprouteOptions {
	const clientOutDir = path.resolve(root, options.clientOutDir ?? DEFAULTS.clientOutDir);
	const serverOutDir = path.resolve(root, options.serverOutDir ?? DEFAULTS.serverOutDir);

	// The generated server serves `clientOutDir` as static files. If the server
	// bundle lives there too it is served with it — handing out the compiled
	// hooks, every `.server.ts` module and whatever the build baked in. The
	// degenerate case is quiet (`path.relative(x, x)` is `''`), so it is
	// refused rather than papered over.
	if (clientOutDir === serverOutDir || isInside(serverOutDir, clientOutDir)) {
		throw new Error(
			`[riproute] serverOutDir (${serverOutDir}) must not be inside clientOutDir ` +
				`(${clientOutDir}): the client directory is served as static files, and the ` +
				'server bundle would be served with it.'
		);
	}

	const routesModule = options.routes !== undefined ? path.resolve(root, options.routes) : null;

	const routesDir =
		routesModule !== null || options.routesDir === false
			? null
			: path.resolve(root, options.routesDir ?? DEFAULTS.routesDir);

	return {
		routesDir,
		routesModule,
		hooksModule: resolveHooks(options.hooks, root),
		template: path.resolve(root, options.template ?? DEFAULTS.template),
		rootId: options.rootId ?? DEFAULTS.rootId,
		base: options.base ?? '',
		title: options.title,
		clientOutDir,
		serverOutDir,
		assetsDir: DEFAULTS.assetsDir,
		clientDirFromServer:
			path.relative(serverOutDir, clientOutDir).split(path.sep).join('/') || '.',
	};
}

/** Whether `child` is the same directory as `parent`, or nested inside it. */
function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);

	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Finds the hooks module.
 *
 * Conventional by default and silent when absent, so an app that has no
 * endpoints never has to say so. An explicit path is required to exist —
 * quietly ignoring a typo would leave the app's auth gate switched off.
 */
function resolveHooks(hooks: string | false | undefined, root: string): string | null {
	if (hooks === false) return null;

	if (hooks !== undefined) {
		const file = path.resolve(root, hooks);

		if (!existsSync(file)) {
			throw new Error(`[riproute] hooks module not found: ${file}`);
		}

		return file;
	}

	for (const extension of ['.ts', '.js', '.mts', '.mjs']) {
		const file = path.resolve(root, DEFAULTS.hooks + extension);

		if (existsSync(file)) return file;
	}

	return null;
}
