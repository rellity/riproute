import { getRequestEvent, serverFn } from '@riproute/riproute/server';
import type { ServerFnMiddleware } from '@riproute/riproute/server';

/**
 * Middleware runs before the handler — on RPC calls from the browser and on
 * direct server-side calls alike. It can gate (`throw` or return without
 * calling `next()`), or stash things in `event.locals` for the handler.
 */
const notePath: ServerFnMiddleware = (event, next) => {
	event.locals.via = new URL(event.request.url).pathname;

	return next();
};

/**
 * A server function, TanStack Start style: exported from a `.server.ts` file,
 * declared with `serverFn()`, and from there callable anywhere — the browser
 * gets a typed stub that POSTs here, the server calls it directly.
 */
export const greet = serverFn()
	.middleware([notePath])
	.handler(async (name: string) => {
		const { locals } = getRequestEvent();

		return {
			message: `Hello, ${name}!`,
			via: locals.via as string,
		};
	});

export type Todo = { id: number; name: string };

/** Typed end to end: `useQueryFn(listTodos)` iterates as `Todo` in the browser. */
export const listTodos = serverFn(async (): Promise<Todo[]> => [
	{ id: 1, name: 'write a route' },
	{ id: 2, name: 'call a server function' },
	{ id: 3, name: 'ship it' },
]);

/** Not wrapped, so not callable — and not importable from the browser. */
export const secret = 'server-only';
