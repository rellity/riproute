import { compressStream, negotiateEncoding, shouldCompress } from './adapter-node/compression';

/**
 * Response handling shared by every runtime adapter.
 *
 * The node and Bun adapters differ only in how they get a `Request` and hand
 * back a `Response` — the compression negotiation and the default error page
 * are identical web-standard code, and live here so there is one copy to keep
 * correct.
 */

/**
 * Compresses a response when the client, the content type and the size all say
 * it is worth it. A no-op when nothing is gained, returning the response as-is.
 */
export function maybeCompress(request: Request, response: Response): Response {
	if (response.body === null || response.status === 204 || response.status === 304) {
		return response;
	}

	const encoding = negotiateEncoding(request.headers.get('accept-encoding'));

	if (encoding === null) return response;

	const headers = new Headers(response.headers);
	const length = headers.get('content-length');

	if (!shouldCompress(headers, length === null ? null : Number(length))) return response;

	// The compressed size is unknowable up front, so the response streams.
	headers.delete('content-length');
	headers.set('content-encoding', encoding);
	appendVary(headers, 'accept-encoding');

	return new Response(compressStream(response.body, encoding), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function appendVary(headers: Headers, value: string): void {
	const existing = headers.get('vary');

	if (existing === null) {
		headers.set('vary', value);
		return;
	}

	const parts = existing
		.toLowerCase()
		.split(',')
		.map((part) => part.trim());

	if (parts.includes('*') || parts.includes(value)) return;

	headers.set('vary', `${existing}, ${value}`);
}

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
