import { AsyncLocalStorage } from 'node:async_hooks';

import { RPC_PATH } from '../constants';

/**
 * Server functions.
 *
 * A function wrapped in `serverFn()` and exported from a `*.server.ts` file
 * can be imported and called from anywhere. On the server — SSR, hooks, other
 * server functions — the import is the real module and the call is direct. In
 * the browser the Vite plugin swaps the module for typed stubs that POST to
 * `RPC_PATH`, where the dispatch built here runs the real thing.
 *
 * The wrapper is deliberate, not ceremony: only marked exports are callable
 * over the wire. Everything else in a `.server.ts` file stays exactly as
 * server-only as it was.
 */

/**
 * `Symbol.for`, not a private symbol: the marker must survive the module being
 * loaded twice (dev runners, test harnesses re-instantiating the graph).
 */
const MARKER = Symbol.for('riproute.serverFn');

export type RequestEvent = {
	/** The request being served — the RPC call, or the page being rendered. */
	request: Request;
};

const storage = new AsyncLocalStorage<RequestEvent>();

/**
 * Marks a function as callable from the browser.
 *
 * Returns the function unchanged (same identity, same type), so server-side
 * callers pay nothing and the client's stub carries the original signature.
 * Arguments and return value cross the wire as JSON — keep them plain data.
 */
export function serverFn<T extends (...args: never[]) => unknown>(fn: T): T {
	(fn as Record<PropertyKey, unknown>)[MARKER] = true;

	return fn;
}

function isServerFn(value: unknown): value is (...args: unknown[]) => unknown {
	return typeof value === 'function' && (value as Record<PropertyKey, unknown>)[MARKER] === true;
}

/**
 * The request behind the current call.
 *
 * Available inside a server function handling an RPC call, and anywhere in a
 * server render — the handler opens the context before rendering. Cookies and
 * headers live here; there is no hidden second channel for them.
 */
export function getRequestEvent(): RequestEvent {
	const event = storage.getStore();

	if (event === undefined) {
		throw new Error(
			'[riproute] getRequestEvent() was called outside a request. It works ' +
				'inside server functions and during server rendering, not at module ' +
				'top level.'
		);
	}

	return event;
}

/** Opens the request context around `run`. Used by the handler and the dispatch. */
export function withRequestEvent<T>(request: Request, run: () => T): T {
	return storage.run({ request }, run);
}

type Loaders = Record<string, () => Promise<Record<string, unknown>>>;

/**
 * Builds the endpoint half of server functions, as an `onRequest`-style hook:
 * it answers its own path and lets everything else pass. Wired into the
 * generated handler after the app's hooks, so an auth gate in
 * `hooks.server.ts` covers RPC calls too.
 *
 * A call the table cannot serve — unknown module, unknown export, an export
 * without the `serverFn` mark — gets the same 404, so the endpoint cannot be
 * used to probe what exists on the server.
 */
export function createServerFnDispatch(
	loaders: Loaders,
	endpoint: string = RPC_PATH
): (request: Request) => Promise<Response | undefined> {
	return async (request) => {
		if (new URL(request.url).pathname !== endpoint) return undefined;

		if (request.method !== 'POST') {
			return json({ ok: false, error: 'Server functions are called with POST.' }, 405);
		}

		let id: unknown;
		let args: unknown;

		try {
			({ id, args } = (await request.json()) as { id?: unknown; args?: unknown });
		} catch {
			return json({ ok: false, error: 'Malformed server function call.' }, 400);
		}

		if (typeof id !== 'string' || !Array.isArray(args)) {
			return json({ ok: false, error: 'Malformed server function call.' }, 400);
		}

		const separator = id.lastIndexOf('#');
		const file = separator === -1 ? '' : id.slice(0, separator);
		const name = separator === -1 ? '' : id.slice(separator + 1);
		const loader = loaders[file];

		if (loader === undefined) return unknownFunction(id);

		const module = await loader();
		const fn = module[name];

		if (!isServerFn(fn)) return unknownFunction(id);

		try {
			const result = await withRequestEvent(request, () => fn(...(args as unknown[])));

			return json({ ok: true, result });
		} catch (error) {
			return json(
				{
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
				500
			);
		}
	};
}

function unknownFunction(id: string): Response {
	return json({ ok: false, error: `Unknown server function ${JSON.stringify(id)}.` }, 404);
}

function json(payload: unknown, status: number): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}
