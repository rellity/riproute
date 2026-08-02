import { getRequestEvent, serverFn } from 'riproute/server';

/**
 * A server function: exported from a `.server.ts` file, wrapped in
 * `serverFn()`, and from there callable anywhere — the browser gets a typed
 * stub that POSTs here, the server calls it directly.
 */
export const greet = serverFn(async (name: string) => {
	const { request } = getRequestEvent();

	return {
		message: `Hello, ${name}!`,
		via: new URL(request.url).pathname,
	};
});

/** Not wrapped, so not callable — and not importable from the browser. */
export const secret = 'server-only';
