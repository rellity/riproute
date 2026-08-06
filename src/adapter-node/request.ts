import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

export type RequestOptions = {
	/**
	 * Trust `x-forwarded-*` when building the request URL.
	 *
	 * Off by default: behind no proxy those headers are attacker-controlled,
	 * and the URL decides which route runs.
	 */
	trustProxy?: boolean;
	/**
	 * Host names to accept. When set, a request whose resolved host is not in
	 * the list is refused with a 400 instead of having its (attacker-controlled)
	 * `Host` become the request URL's origin — which downstream absolute-URL
	 * building (redirects, reset links, canonical tags) would otherwise inherit.
	 * Unset (default) accepts any host, matching the usual framework behaviour.
	 */
	allowedHosts?: string[];
};

/** Converts a Node request into the `Request` the handler expects. */
export function toWebRequest(req: IncomingMessage, options: RequestOptions = {}): Request {
	const headers = new Headers();

	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;

		if (Array.isArray(value)) for (const item of value) headers.append(key, item);
		else headers.set(key, value);
	}

	const forwarded = options.trustProxy === true;
	const protocol =
		(forwarded ? first(headers.get('x-forwarded-proto')) : null) ??
		((req.socket as { encrypted?: boolean }).encrypted === true ? 'https' : 'http');
	const host =
		(forwarded ? first(headers.get('x-forwarded-host')) : null) ??
		headers.get('host') ??
		'localhost';

	const url = new URL(req.url ?? '/', `${protocol}://${host}`);

	// Checked against the *resolved* URL, not the `Host` header. HTTP/1.1
	// permits an absolute-form request target, and it overrides the base — so
	// `GET http://evil.com/x` with an allow-listed `Host:` would otherwise pass
	// the check while the handler saw `http://evil.com` as its origin.
	if (options.allowedHosts !== undefined && !options.allowedHosts.includes(url.host)) {
		// The middleware turns this into a 400 — the same path a malformed host
		// takes — rather than serving a request under a forged origin.
		throw new Error(`[riproute] Refused Host header: ${url.host}`);
	}
	const method = (req.method ?? 'GET').toUpperCase();
	const init: RequestInit & { duplex?: 'half' } = { method, headers };

	// A body has to be streamed rather than buffered — an upload should not be
	// held in memory before the handler has decided whether it wants it.
	if (method !== 'GET' && method !== 'HEAD') {
		init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
		init.duplex = 'half';
	}

	return new Request(url, init);
}

function first(value: string | null): string | null {
	if (value === null) return null;

	const head = value.split(',')[0].trim();

	return head === '' ? null : head;
}
