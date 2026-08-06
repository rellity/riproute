/**
 * The contract every riproute adapter implements.
 *
 * An adapter is two halves that never meet at runtime:
 *
 * - a **build-time descriptor** (this file), which the Vite plugin asks for the
 *   source of the production server entry;
 * - a **runtime** (`createServer`, `createFetchHandler`, …), which that
 *   generated entry imports.
 *
 * Keeping the descriptor declarative is what lets the plugin stay ignorant of
 * the adapters: it discovers whichever `@riproute/*` adapter the app installed,
 * imports its descriptor, and asks it for an entry. Adding a target is a new
 * package, not a new branch in the plugin.
 *
 * This package is never released. Every package that uses it bundles it at
 * build time, so an app installs adapters and a plugin, not a kit — and the
 * contract stays an internal detail rather than a version an app has to match.
 */

export type AdapterEntryContext = {
	/** `<script>`/`<link>` tags for the built client, already escaped. */
	tags: string;
	/**
	 * The app's `index.html`, when it has one and no root `shell` export.
	 * `null` for shell-mode apps, and for runtimes that must bake it in the
	 * adapter decides whether to inline it.
	 */
	template: string | null;
	/** Absolute path of the app's template on disk, for adapters that read it. */
	templatePath: string;
	/** Relative path from the server output to the client output, at runtime. */
	clientDirFromServer: string;
	/** Directory within the client output holding hashed assets. */
	assetsDir: string;
	/** The app's base path, `''` at the root. */
	base: string;
	/** Virtual module id exporting `createRiprouteHandler` and `shell`. */
	handlerId: string;
};

/** Extra Vite config an adapter needs. Merged into the `ssr` environment. */
export type AdapterViteConfig = {
	/**
	 * Bundle every dependency into the server output instead of leaving them
	 * external. Required by runtimes uploaded as a single module — a Worker has
	 * no `node_modules` to resolve a bare import against.
	 */
	noExternal?: boolean;
	/** Written to the server output; `[name]` is the entry name. */
	entryFileNames?: string;
};

export type RiprouteAdapter = {
	/** Short name, used in logs and to resolve an explicit `adapter` option. */
	name: string;
	/** Package the generated entry imports its runtime from. */
	runtimePackage: string;
	/** How the built app is started, for the "build finished" hint. */
	startHint?: string;
	/** Vite config this target needs. */
	viteConfig?: AdapterViteConfig;
	/** Produces the source of `dist/server/index.js`. */
	entry(context: AdapterEntryContext): string;
};

/** Identity helper; exists for the type inference and to mark the export. */
export function defineAdapter(adapter: RiprouteAdapter): RiprouteAdapter {
	return adapter;
}

/**
 * Injects the built asset tags before `</head>`.
 *
 * Shared because every adapter needs it and the details are easy to get
 * wrong: a *string* replacement expands `$&`, `` $` ``, `$'` and `$n`, so a `$`
 * in an asset name would splice the document into an attribute — hence the
 * slice. The match is case-insensitive to agree with `splitTemplate`, so a
 * shell writing `</HEAD>` still gets its tags instead of silently shipping a
 * page that never hydrates.
 */
export const INJECT_TAGS_SOURCE = [
	'function injectTags(html) {',
	"\tif (tags === '') return html;",
	'',
	'\tconst close = /<\\/head\\s*>/i.exec(html);',
	'',
	'\treturn close === null',
	'\t\t? html + tags',
	'\t\t: html.slice(0, close.index) + tags + html.slice(close.index);',
	'}',
].join('\n');

/** The error a generated entry throws when it has no document to render. */
export function missingDocumentMessage(templatePath: string): string {
	return (
		'[riproute] No document to render: the root route exports no shell ' +
		`and no template was found at ${templatePath}.`
	);
}

export {
	normalizeWebRequest,
	toErrorResponse,
	type ErrorHandler,
	type WebRequestOptions,
} from './web';
