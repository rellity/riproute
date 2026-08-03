import { track } from 'ripple';
import type { Tracked } from 'ripple';

import { IS_BROWSER } from '../env';

/**
 * Server-function hooks, shaped like TanStack Query: `useQueryFn()` loads on
 * mount, `useMutateFn()` fires when told to. Both hand their state back as
 * tracked refs, so the result destructures without losing reactivity:
 *
 * ```tsrx
 * const { data, loading, error, refetch } = useQueryFn(listTodos);
 * ```
 *
 * Every field is a ref you read with `.value` — destructured or not, it keeps
 * updating. `data` is additionally iterable when it holds an array, typed to
 * the element, so `@for (const todo of data)` reads exactly as it should.
 */

/** The `data` ref: `.value` plus, for arrays, direct iteration. */
export type FnData<R> = {
	/** The latest resolved data; `undefined` until a call lands. */
	readonly value: R | undefined;
} & (R extends readonly (infer Item)[] ? Iterable<Item> : unknown);

export type UseQueryFnResult<Args extends readonly unknown[], R> = {
	data: FnData<R>;
	/** True while a call is in flight — including during SSR, where no call ever starts. */
	loading: Tracked<boolean>;
	/** What the last call threw, or `null`. Cleared when a new call starts. */
	error: Tracked<unknown>;
	/** Runs the query again — with the original arguments, or new ones. */
	refetch: (...args: Args) => Promise<R | undefined>;
} & (R extends readonly (infer Item)[] ? Iterable<Item> : unknown);

export type UseMutateFnResult<Args extends readonly unknown[], R> = {
	/**
	 * Runs the mutation. Resolves with the result, or `undefined` when it
	 * failed — the failure itself lands in `error`, never as a rejection, so a
	 * bare `onClick={() => mutate(...)}` cannot leak an unhandled promise.
	 */
	mutate: (...args: Args) => Promise<R | undefined>;
	data: FnData<R>;
	/** True while the mutation runs. Starts false. */
	loading: Tracked<boolean>;
	/** What the last call threw, or `null`. Cleared when a new call starts. */
	error: Tracked<unknown>;
	/** Back to the initial state: no data, no error, not loading. */
	reset: () => void;
};

/** The tracked state and single-flight runner both hooks are built from. */
function createFnState<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	initialLoading: boolean
) {
	const data = track<Awaited<R> | undefined>(undefined);
	const loading = track(initialLoading);
	const error = track<unknown>(null);

	// Late responses must not overwrite newer ones: only the latest call may
	// write, and a new call (or a reset) simply supersedes.
	let latest = 0;

	const run = async (...args: Args): Promise<Awaited<R> | undefined> => {
		const token = ++latest;

		loading.value = true;
		error.value = null;

		try {
			const result = await fn(...args);

			if (token === latest) data.value = result;

			return result;
		} catch (thrown) {
			if (token === latest) error.value = thrown;

			return undefined;
		} finally {
			if (token === latest) loading.value = false;
		}
	};

	const reset = (): void => {
		latest++;
		data.value = undefined;
		error.value = null;
		loading.value = false;
	};

	const view: FnData<Awaited<R>> = {
		get value() {
			return data.value;
		},
		[Symbol.iterator]() {
			const current: unknown = data.value;

			return (Array.isArray(current) ? current : [])[Symbol.iterator]();
		},
	} as never;

	return { view, loading, error, run, reset };
}

/**
 * Calls a function once the component is in the browser, and hands back its
 * state as reactive refs — the load-on-mount pattern without the effect
 * boilerplate:
 *
 * ```tsrx
 * import { listTodos } from '../lib/todos.server';
 *
 * export default function Todos() @{
 * 	const { data, loading, refetch } = useQueryFn(listTodos);
 *
 * 	<ul>
 * 		@for (const todo of data; key todo.id) {
 * 			<li>{todo.name}</li>
 * 		}
 * 	</ul>
 * }
 * ```
 *
 * Built for server functions but happy with any function: arguments are typed
 * against the function's signature, `data.value` against its (awaited)
 * return. During SSR nothing runs — network belongs to the browser — so the
 * page server-renders in its loading state and fills in after hydration.
 * Iterating before the data lands yields nothing.
 */
export function useQueryFn<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	...args: Args
): UseQueryFnResult<Args, Awaited<R>> {
	const state = createFnState(fn, true);

	if (IS_BROWSER) void state.run(...args);

	const result = {
		data: state.view,
		loading: state.loading,
		error: state.error,
		refetch: (...nextArgs: Args) =>
			state.run(...((nextArgs.length > 0 ? nextArgs : args) as never as Args)),
		[Symbol.iterator]() {
			return (state.view as never as Iterable<unknown>)[Symbol.iterator]();
		},
	};

	return result as never as UseQueryFnResult<Args, Awaited<R>>;
}

/**
 * The write-side twin: nothing runs until `mutate()` is called.
 *
 * ```tsrx
 * const todos = useQueryFn(listTodos);
 * const { mutate: addTodo, loading: adding } = useMutateFn(
 * 	async (text: string) => {
 * 		await createTodo(text);
 * 		await todos.refetch();
 * 	}
 * );
 *
 * <button onClick={() => addTodo('milk')} disabled={adding.value}>{'Add'}</button>
 * ```
 */
export function useMutateFn<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R
): UseMutateFnResult<Args, Awaited<R>> {
	const state = createFnState(fn, false);

	return {
		mutate: (...args: Args) => state.run(...args),
		data: state.view,
		loading: state.loading,
		error: state.error,
		reset: state.reset,
	};
}
