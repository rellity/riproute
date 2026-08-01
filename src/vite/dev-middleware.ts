import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { ViteDevServer } from 'vite';

import type { ResolvedRiprouteOptions } from './options';
import { HANDLER_ID, devUrl, CLIENT_ID } from './virtual-modules';

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
			if (req.method !== 'GET' && req.method !== 'HEAD') return next();

			const accept = req.headers.accept ?? '';

			// Vite has already had its turn, so anything left is either a page
			// or a missing asset. Only claim things a browser would render.
			if (accept !== '' && !accept.includes('text/html') && !accept.includes('*/*')) {
				return next();
			}

			try {
				const { createRiprouteHandler, shell } = await server.ssrLoadModule(HANDLER_ID);

				const handler = createRiprouteHandler({
					// A root route that renders the document supplies its own
					// template; otherwise the app has an index.html on disk.
					template: shell === undefined ? () => readTemplate(options) : undefined,
					// Either way Vite gets the last word: it injects the HMR
					// client, and the entry script is a virtual module that never
					// appears in the app's own markup.
					transformTemplate: (html) => transform(server, req, html),
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
	document: string
): Promise<string> {
	const html = await server.transformIndexHtml(req.originalUrl ?? req.url ?? '/', document);
	const script = `<script type="module" src=${JSON.stringify(devUrl(CLIENT_ID))}></script>`;

	return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : html + script;
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
