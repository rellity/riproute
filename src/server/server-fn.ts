import { AsyncLocalStorage } from 'node:async_hooks';

import { SERVER_FN_PREFIX } from '../constants';

/**
 * Server functions.
 *
 * A function wrapped in `serverFn()` and exported from a `*.server.ts` file
 * can be imported and called from anywhere. On the server — SSR, hooks, other
 * server functions — the import is the real module and the call is direct. In
 * the browser the Vite plugin swaps the module for typed stubs that POST to
 * `SERVER_FN_PREFIX + hash`, where the dispatch built here runs the real
 * thing.
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
	/**
	 * Per-request scratch space. Middleware writes here — a session, a user —
	 * and the handler reads it back through `getRequestEvent()`.
	 */
	locals: Record<string, unknown>;
};

/**
 * Around-style middleware: runs before the handler, decides whether to
 * continue. Call `next()` to run the rest of the chain (its value is the
 * handler's result, yours to pass through or replace); return without calling
 * it to short-circuit; throw to fail the call.
 */
export type ServerFnMiddleware = (event: RequestEvent, next: () => Promise<unknown>) => unknown;

export type ServerFnBuilder = {
	/** Adds middleware, run in the order given, before the handler. */
	middleware(middleware: readonly ServerFnMiddleware[]): ServerFnBuilder;
	/** Sets the function itself and returns it, callable and typed as written. */
	handler<T extends (...args: never[]) => unknown>(fn: T): T;
};

const storage = new AsyncLocalStorage<RequestEvent>();

/**
 * Declares a server function, TanStack Start style:
 *
 * ```ts
 * export const addTodo = serverFn()
 * 	.middleware([requireUser])
 * 	.handler(async (text: string) => db.todos.insert(text));
 * ```
 *
 * The handler keeps its own signature — `addTodo('milk')`, arguments typed and
 * checked, not a `data` envelope. `serverFn(fn)` stays as shorthand for a
 * function with no middleware. Arguments and return value cross the wire as
 * JSON — keep them plain data.
 *
 * Middleware runs wherever the function is called — an RPC call from the
 * browser or a direct call on the server — always inside the request context,
 * so an auth check guards both doors.
 */
export function serverFn(): ServerFnBuilder;
export function serverFn<T extends (...args: never[]) => unknown>(fn: T): T;
export function serverFn<T extends (...args: never[]) => unknown>(fn?: T): T | ServerFnBuilder {
	if (fn !== undefined) return mark(fn);

	const middlewares: ServerFnMiddleware[] = [];

	const builder: ServerFnBuilder = {
		middleware(more) {
			middlewares.push(...more);

			return builder;
		},

		handler(handlerFn) {
			if (middlewares.length === 0) return mark(handlerFn);

			const chain = [...middlewares];

			const composed = (...args: never[]) => {
				const event = getRequestEvent();
				let called = -1;

				// `async`, so a middleware that throws synchronously rejects like
				// one that throws after an await, and callers see one behaviour.
				const run = async (index: number): Promise<unknown> => {
					if (index <= called) {
						throw new Error('[riproute] next() was called twice in middleware.');
					}

					called = index;

					return index < chain.length
						? chain[index](event, () => run(index + 1))
						: handlerFn(...args);
				};

				return run(0);
			};

			return mark(composed as never as typeof handlerFn);
		},
	};

	return builder;
}

function mark<T extends (...args: never[]) => unknown>(fn: T): T {
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
	return storage.run({ request, locals: {} }, run);
}

export type ServerFnTable = Record<
	string,
	{
		/** The export name inside the module. */
		name: string;
		/** Lazy module import, so only called-into files ever load. */
		load: () => Promise<Record<string, unknown>>;
	}
>;

/**
 * Builds the endpoint half of server functions, as an `onRequest`-style hook:
 * it answers its own URL space — `<prefix><hash>`, one endpoint per function
 * — and lets everything else pass. Wired into the generated handler after the
 * app's hooks, so an auth gate in `hooks.server.ts` covers RPC calls too.
 *
 * A call the table cannot serve — unknown hash, missing export, an export
 * without the `serverFn` mark — gets the same 404, so the endpoint cannot be
 * used to probe what exists on the server.
 */
export function createServerFnDispatch(
	functions: ServerFnTable,
	prefix: string = SERVER_FN_PREFIX
): (request: Request) => Promise<Response | undefined> {
	return async (request) => {
		const pathname = new URL(request.url).pathname;

		if (!pathname.startsWith(prefix)) return undefined;

		if (request.method !== 'POST') {
			return json({ ok: false, error: 'Server functions are called with POST.' }, 405);
		}

		let args: unknown;

		try {
			({ args } = (await request.json()) as { args?: unknown });
		} catch {
			return json({ ok: false, error: 'Malformed server function call.' }, 400);
		}

		if (!Array.isArray(args)) {
			return json({ ok: false, error: 'Malformed server function call.' }, 400);
		}

		const entry = functions[pathname.slice(prefix.length)];

		if (entry === undefined) return unknownFunction();

		const module = await entry.load();
		const fn = module[entry.name];

		if (!isServerFn(fn)) return unknownFunction();

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

function unknownFunction(): Response {
	return json({ ok: false, error: 'Unknown server function.' }, 404);
}

function json(payload: unknown, status: number): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}
