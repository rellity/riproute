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
};

export type ResolvedRiprouteOptions = {
	routesDir: string | null;
	routesModule: string | null;
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
	template: 'index.html',
	rootId: 'root',
	clientOutDir: 'dist/client',
	serverOutDir: 'dist/server',
	assetsDir: 'assets',
};

export function resolveOptions(options: RiprouteOptions, root: string): ResolvedRiprouteOptions {
	const clientOutDir = path.resolve(root, options.clientOutDir ?? DEFAULTS.clientOutDir);
	const serverOutDir = path.resolve(root, options.serverOutDir ?? DEFAULTS.serverOutDir);

	const routesModule = options.routes !== undefined ? path.resolve(root, options.routes) : null;

	const routesDir =
		routesModule !== null || options.routesDir === false
			? null
			: path.resolve(root, options.routesDir ?? DEFAULTS.routesDir);

	return {
		routesDir,
		routesModule,
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
