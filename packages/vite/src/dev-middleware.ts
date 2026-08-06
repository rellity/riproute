import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { ViteDevServer } from 'vite';

import { SERVER_FN_PREFIX } from '@riproute/router/primitives';
import type { ResolvedRiprouteOptions } from './options';
import { HANDLER_ID, devUrl, CLIENT_ID, resolvedId } from './virtual-modules';

/**
 * Installs the SSR middleware.
 *
 * The returned thunk is the whole point. Vite calls it *after* wiring its own
 * middlewares, so `/@vite/client`, `/@id/*`, `/src/*` and `/node_modules/*` are
 * answered before anything reaches the router. Registering in the hook body
 * instead — which is what `@ripple-ts/vite-plugin` does — puts a root catch-all
 * route ahead of Vite's transform middleware, and the HMR client comes back as
 * HTML. That is the bug that made the dev server look like hydration was
 * broken.
 */
export function installDevMiddleware(
	server: ViteDevServer,
	options: ResolvedRiprouteOptions
): () => void {
	return () => {
		server.middlewares.use(async (req, res, next) => {
			// Server-function calls are POSTs with a JSON accept header — the
			// one non-page URL space the handler owns.
			const isRpc = (req.originalUrl ?? req.url ?? '')
				.split('?')[0]
				.startsWith(SERVER_FN_PREFIX);

			if (!isRpc) {
				if (req.method !== 'GET' && req.method !== 'HEAD') return next();

				const accept = req.headers.accept ?? '';

				// Vite has already had its turn, so anything left is either a
				// page or a missing asset. Only claim things a browser would
				// render.
				if (accept !== '' && !accept.includes('text/html') && !accept.includes('*/*')) {
					return next();
				}
			}

			try {
				const { createRiprouteHandler, shell } = await server.ssrLoadModule(HANDLER_ID);

				// Loading the handler pulled every route module into the SSR
				// graph — the routes table imports them statically — so the CSS
				// they use is known before the document is assembled.
				const css = await collectDevCss(server);

				const handler = createRiprouteHandler({
					// A root route that renders the document supplies its own
					// template; otherwise the app has an index.html on disk.
					template: shell === undefined ? () => readTemplate(options) : undefined,
					// Either way Vite gets the last word: it injects the HMR
					// client, and the entry script is a virtual module that never
					// appears in the app's own markup.
					transformTemplate: (html) => transform(server, req, html, css),
				});

				await sendResponse(res, await handler(toWebRequest(req)));
			} catch (error) {
				if (error instanceof Error) server.ssrFixStacktrace(error);

				next(error);
			}
		});
	};
}

function readTemplate(options: ResolvedRiprouteOptions): Promise<string> {
	return fs.readFile(options.template, 'utf-8');
}

/**
 * Hands the document to Vite, then adds the hydration entry.
 *
 * `transformIndexHtml` injects `@vite/client` and any plugin tags. The entry
 * script is ours because it is a virtual module, so it never appears in the
 * app's own markup — whether that markup came from `index.html` or from a root
 * route that renders the document.
 */
async function transform(
	server: ViteDevServer,
	req: IncomingMessage,
	document: string,
	css: string
): Promise<string> {
	const withCss =
		css !== '' && document.includes('</head>')
			? document.replace('</head>', `${css}</head>`)
			: document + css;
	const html = await server.transformIndexHtml(req.originalUrl ?? req.url ?? '/', withCss);
	const script = `<script type="module" src=${JSON.stringify(devUrl(CLIENT_ID))}></script>`;

	return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script;
}

const CSS_ID = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)(\?|$)/;

/**
 * The CSS module ids reachable from the handler in the SSR module graph.
 *
 * Split out from the inlining because nitro mode needs the list alone: there
 * the handler runs inside nitro's environment runner, which can `?inline` the
 * modules itself but has no way to see this graph. An empty answer is normal
 * before the first render has populated it.
 */
export function collectDevCssIds(server: ViteDevServer): string[] {
	const graph = server.environments.ssr.moduleGraph;
	const entry = graph.getModuleById(resolvedId(HANDLER_ID));

	if (entry === undefined) return [];

	const seen = new Set<unknown>();
	const ids: string[] = [];

	const walk = (node: { id?: string | null; importedModules: Set<unknown> }): void => {
		if (seen.has(node)) return;

		seen.add(node);

		if (node.id != null && CSS_ID.test(node.id)) ids.push(node.id);

		for (const dep of node.importedModules) {
			walk(dep as never);
		}
	};

	walk(entry as never);

	return ids;
}

/**
 * Inlines the CSS of every module the app's SSR graph reaches.
 *
 * In dev, stylesheets normally arrive as JS: the client entry loads, each CSS
 * module injects a <style> tag, and everything before that moment paints
 * unstyled — the classic dev-only flash on a server-rendered page. Production
 * has no such gap (the built document carries <link> tags), so dev inlines the
 * same CSS up front instead.
 *
 * The inlined copy is the *initial* paint only. The client's JS-injected
 * styles land later in the document, so at equal specificity they win, and
 * HMR keeps updating them — a stale inline copy can never override a fresh
 * edit.
 */
async function collectDevCss(server: ViteDevServer): Promise<string> {
	const ids = collectDevCssIds(server);

	let out = '';

	for (const id of ids) {
		try {
			// `?inline` asks Vite for the transformed stylesheet as a string —
			// Tailwind, PostCSS and preprocessors all included.
			const mod = (await server.ssrLoadModule(
				id.includes('?') ? `${id.replace('?', '?inline&')}` : `${id}?inline`
			)) as { default?: unknown };

			if (typeof mod.default === 'string' && mod.default !== '') {
				out += `<style data-riproute-dev-css=${JSON.stringify(id)}>${mod.default}</style>`;
			}
		} catch {
			// A virtual CSS id that cannot be inlined; the JS-injected copy
			// still applies, it just cannot beat first paint.
		}
	}

	return out;
}

export function toWebRequest(req: IncomingMessage): Request {
	const host = req.headers.host ?? 'localhost';
	const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${host}`);
	const headers = new Headers();

	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;

		if (Array.isArray(value)) for (const item of value) headers.append(key, item);
		else headers.set(key, value);
	}

	const method = (req.method ?? 'GET').toUpperCase();
	const init: RequestInit & { duplex?: 'half' } = { method, headers };

	if (method !== 'GET' && method !== 'HEAD') {
		init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
		init.duplex = 'half';
	}

	return new Request(url, init);
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
	res.statusCode = response.status;

	if (response.statusText !== '') res.statusMessage = response.statusText;

	for (const [key, value] of response.headers) res.setHeader(key, value);

	if (response.body === null) {
		res.end();
		return;
	}

	const reader = response.body.getReader();

	try {
		for (;;) {
			const { done, value } = await reader.read();

			if (done) break;

			res.write(value);
		}
	} finally {
		reader.releaseLock();
	}

	res.end();
}
