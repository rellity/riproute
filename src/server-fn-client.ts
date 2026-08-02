import { RPC_PATH } from './constants';

/**
 * The browser half of a server function.
 *
 * The Vite plugin swaps a `*.server.ts` module for stubs built here — one per
 * `serverFn()` export, carrying the original signature through TypeScript's
 * view of the source module. Not part of the app-facing API: apps import
 * their server functions, never this.
 */
export function createServerFnStub(
	id: string,
	endpoint: string = RPC_PATH
): (...args: unknown[]) => Promise<unknown> {
	return async (...args) => {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, args }),
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
					: `[riproute] Server function ${JSON.stringify(id)} failed with status ${response.status}.`
			);
		}

		return payload.result;
	};
}
