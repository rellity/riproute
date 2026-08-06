import { SERVER_FN_PREFIX } from './constants';

/**
 * The browser half of a server function.
 *
 * The Vite plugin swaps a `*.server.ts` module for stubs built here — one per
 * `serverFn()` export, each with its own endpoint under `SERVER_FN_PREFIX`,
 * carrying the original signature through TypeScript's view of the source
 * module. `label` is the export name, for error messages; the hash is all the
 * wire ever sees. Not part of the app-facing API: apps import their server
 * functions, never this.
 */
export function createServerFnStub(
	hash: string,
	label: string
): (...args: unknown[]) => Promise<unknown> {
	return async (...args) => {
		const response = await fetch(`${SERVER_FN_PREFIX}${hash}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ args }),
		});

		let payload: { ok?: boolean; result?: unknown; error?: unknown } | null = null;

		try {
			payload = (await response.json()) as typeof payload;
		} catch {
			// A non-JSON answer — a proxy error page, a dead server. The status
			// line below is the best information available.
		}

		if (!response.ok || payload === null || payload.ok !== true) {
			throw new Error(
				typeof payload?.error === 'string'
					? payload.error
					: `[riproute] Server function ${label}() failed with status ${response.status}.`
			);
		}

		return payload.result;
	};
}
