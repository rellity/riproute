/**
 * Request and response handling shared by every runtime adapter.
 *
 * Deliberately free of Node built-ins: the workerd adapter imports this
 * module, and a stray `node:zlib`/`node:stream` here would break a Worker
 * bundle. Compression lives with the Node/Bun adapters, which have those APIs.
 */

export type ErrorHandler = (error: unknown, request: Request) => Response | Promise<Response>;

/** The response for a handler that threw: the app's `onError`, or a bare 500. */
export async function toErrorResponse(
	error: unknown,
	request: Request,
	onError: ErrorHandler | undefined
): Promise<Response> {
	if (onError !== undefined) return onError(error, request);

	// eslint-disable-next-line no-console
	console.error(`[riproute] ${request.method} ${request.url} failed\n`, error);

	return new Response('Internal Server Error', {
		status: 500,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
}

function first(value: string | null): string | null {
	if (value === null) return null;

	const head = value.split(',')[0].trim();

	return head === '' ? null : head;
}

export type WebRequestOptions = {
	/** Trust `x-forwarded-*` when rebuilding the request URL. Off by default. */
	trustProxy?: boolean;
	/** Host names to accept. A request outside the list throws (→ 400). */
	allowedHosts?: string[];
};

/**
 * Applies proxy trust and host allow-listing to an already-web-standard
 * `Request` — the Bun path, where the runtime hands us a `Request` directly
 * rather than a node `IncomingMessage`. Returns the request unchanged in the
 * common case; rebuilds its URL only when a trusted forwarded header differs.
 */
export function normalizeWebRequest(request: Request, options: WebRequestOptions = {}): Request {
	const url = new URL(request.url);
	const forwarded = options.trustProxy === true;

	const host = (forwarded ? first(request.headers.get('x-forwarded-host')) : null) ?? url.host;
	const protocol =
		(forwarded ? first(request.headers.get('x-forwarded-proto')) : null) ??
		url.protocol.replace(/:$/, '');

	if (options.allowedHosts !== undefined && !options.allowedHosts.includes(host)) {
		throw new Error(`[riproute] Refused Host header: ${host}`);
	}

	if (host === url.host && `${protocol}:` === url.protocol) return request;

	// Rebuilt, not mutated: the WHATWG `host` setter only replaces the port when
	// the assigned value carries one, so `x-forwarded-host: app.example.com`
	// would leave the internal listening port on the URL — and every absolute
	// link the app derives from it (redirects, reset mails, OAuth callbacks)
	// would point at `app.example.com:3000`.
	const rebuilt = new URL(`${protocol}://${host}`);

	rebuilt.pathname = url.pathname;
	rebuilt.search = url.search;
	rebuilt.hash = url.hash;

	return new Request(rebuilt, request);
}
