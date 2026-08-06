import {
	normalizeWebRequest,
	toErrorResponse,
	type ErrorHandler,
	type WebRequestOptions,
} from '../adapter-shared';

/**
 * Cloudflare Workers (workerd) adapter.
 *
 * The thinnest of the three, because workerd *is* the web platform: a Worker
 * exports `{ fetch(request, env, ctx) }`, which is riproute's handler plus two
 * arguments. What the Node and Bun adapters do around the handler mostly
 * disappears here — there is no socket to listen on, no process to drain, and
 * Cloudflare compresses responses at the edge, so the adapter never touches
 * `node:zlib`. Nothing in this file imports a Node built-in.
 *
 * Two things do not come for free:
 *
 * - **Static assets** are served by the platform, not from disk. With Workers
 *   Static Assets, Cloudflare answers asset requests before the Worker runs;
 *   when the Worker runs first, an `ASSETS` binding is tried for anything that
 *   looks like a file.
 * - **`nodejs_compat`** must be on. riproute's request context (what
 *   `getRequestEvent()` reads, and therefore every server function) is an
 *   `AsyncLocalStorage`, which workerd provides only with that flag.
 */

/** The subset of a Cloudflare env riproute looks at. */
export type WorkerdEnv = {
	/** Workers Static Assets binding, when the Worker is configured to run first. */
	ASSETS?: { fetch: (request: Request) => Promise<Response> };
	[key: string]: unknown;
};

/** The `ctx` argument workerd passes; only `waitUntil` is used. */
export type WorkerdContext = {
	waitUntil?: (promise: Promise<unknown>) => void;
	passThroughOnException?: () => void;
};

export type Handler = (request: Request) => Response | Promise<Response>;

export type WorkerdAdapterOptions = WebRequestOptions & {
	/** Called when the handler throws. The default logs and returns a bare 500. */
	onError?: ErrorHandler;
	/**
	 * Name of the static-assets binding to try before rendering. Defaults to
	 * `ASSETS`. Set to `false` to never look for one — correct when Cloudflare
	 * is serving assets ahead of the Worker, which is the default arrangement.
	 */
	assets?: string | false;
};

export type WorkerdHandler = (
	request: Request,
	env?: WorkerdEnv,
	ctx?: WorkerdContext
) => Promise<Response>;

/** A path that names a file — `/assets/app-abc.js`, not `/users/42`. */
const LOOKS_LIKE_A_FILE = /\/[^/]+\.[a-z0-9]+$/i;

/**
 * Wraps a riproute handler into a Worker `fetch` export.
 *
 * ```js
 * export default { fetch: createFetchHandler(handler) };
 * ```
 */
export function createFetchHandler(
	handler: Handler,
	options: WorkerdAdapterOptions = {}
): WorkerdHandler {
	const assetsBinding = options.assets === undefined ? 'ASSETS' : options.assets;

	return async function fetch(request, env) {
		let normalized: Request;

		try {
			normalized = normalizeWebRequest(request, options);
		} catch {
			// A refused host — answer 400 rather than serve a forged origin.
			return new Response('Bad Request', {
				status: 400,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
		}

		try {
			// Only consulted for paths that name a file, so a page render never
			// pays for an extra subrequest. A 404 from the binding falls through
			// to the router, which is what makes a missing asset render the app's
			// own not-found page instead of Cloudflare's.
			if (assetsBinding !== false && env !== undefined) {
				const assets = env[assetsBinding] as WorkerdEnv['ASSETS'] | undefined;
				const pathname = new URL(normalized.url).pathname;

				if (assets !== undefined && LOOKS_LIKE_A_FILE.test(pathname)) {
					const response = await assets.fetch(new Request(normalized.url, normalized));

					if (response.status !== 404) return response;
				}
			}

			return await handler(normalized);
		} catch (error) {
			try {
				return await toErrorResponse(error, normalized, options.onError);
			} catch (nested) {
				// An `onError` that throws must not surface as a workerd exception
				// page.
				console.error('[riproute] onError threw', nested);

				return new Response('Internal Server Error', {
					status: 500,
					headers: { 'content-type': 'text/plain; charset=utf-8' },
				});
			}
		}
	};
}
