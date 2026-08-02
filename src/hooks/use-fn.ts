import { track } from 'ripple';

import { IS_BROWSER } from '../env';

/**
 * The reactive view `useFn()` returns.
 *
 * When the function resolves to an array the result is itself iterable, typed
 * to the element — `@for (const todo of todos)` reads exactly as it should
 * and re-renders when the data lands. Everything else goes through `value`.
 */
export type UseFnResult<Args extends readonly unknown[], R> = {
	/** The latest resolved data; `undefined` until the first load lands. */
	readonly value: R | undefined;
	/** True while a call is in flight — including during SSR, where no call ever starts. */
	readonly loading: boolean;
	/** What the last call threw, or `null`. Cleared when a new call starts. */
	readonly error: unknown;
	/** Runs the function again — with the original arguments, or new ones. */
	refresh: (...args: Args) => Promise<void>;
} & (R extends readonly (infer Item)[] ? Iterable<Item> : unknown);

/**
 * Calls a function once the component is in the browser, and hands back its
 * state as reactive values — the load-on-mount pattern without the effect
 * boilerplate:
 *
 * ```tsrx
 * import { listTodos } from '../lib/todos.server';
 *
 * export default function Todos() @{
 * 	const todos = useFn(listTodos);
 *
 * 	<ul>
 * 		@for (const todo of todos; key todo.id) {
 * 			<li>{todo.name}</li>
 * 		}
 * 	</ul>
 * }
 * ```
 *
 * Built for server functions but happy with any function: arguments are typed
 * against the function's signature, `value` against its (awaited) return.
 * During SSR nothing runs — effects and network belong to the browser — so
 * the page server-renders in its loading state and fills in after hydration.
 * Iterating before the data lands yields nothing.
 */
export function useFn<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	...args: Args
): UseFnResult<Args, Awaited<R>> {
	const data = track<Awaited<R> | undefined>(undefined);
	const loading = track(true);
	const error = track<unknown>(null);

	// Late responses must not overwrite newer ones: only the latest call may
	// write, and `refresh` during flight simply supersedes.
	let latest = 0;

	const run = async (...nextArgs: Args): Promise<void> => {
		const token = ++latest;

		loading.value = true;
		error.value = null;

		try {
			const result = await fn(...nextArgs);

			if (token === latest) data.value = result;
		} catch (thrown) {
			if (token === latest) error.value = thrown;
		} finally {
			if (token === latest) loading.value = false;
		}
	};

	if (IS_BROWSER) void run(...args);

	const result = {
		get value() {
			return data.value;
		},
		get loading() {
			return loading.value;
		},
		get error() {
			return error.value;
		},
		refresh: (...nextArgs: Args) =>
			run(...((nextArgs.length > 0 ? nextArgs : args) as never as Args)),
		[Symbol.iterator]() {
			const current: unknown = data.value;

			return (Array.isArray(current) ? current : [])[Symbol.iterator]();
		},
	};

	return result as never as UseFnResult<Args, Awaited<R>>;
}
