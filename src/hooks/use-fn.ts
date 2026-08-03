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

/**
 * Lifecycle callbacks, shared by both hooks. Each may be async — the call
 * counts as loading until they settle, the way TanStack Query holds pending.
 * They fire for every call, superseded or not; only the *state* is guarded
 * to the latest call. A callback that throws is a bug in the callback, and
 * surfaces as a rejection of `refetch()`/`mutate()` rather than being eaten.
 */
export type FnCallbacks<Args extends readonly unknown[], R> = {
	/** Fires as a call starts, before the function runs. Throwing cancels the call into `onError`. */
	onRequest?: (...args: Args) => void | Promise<void>;
	/** Fires when the function resolves. */
	onSuccess?: (data: R, ...args: Args) => void | Promise<void>;
	/** Fires when the function (or `onRequest`) throws. */
	onError?: (error: unknown, ...args: Args) => void | Promise<void>;
	/** Fires last, success and failure alike. */
	onSettled?: (data: R | undefined, error: unknown, ...args: Args) => void | Promise<void>;
};

export type UseQueryFnOptions<Args extends readonly unknown[], R> = FnCallbacks<Args, R> & {
	/**
	 * Arguments for the automatic call and for a bare `refetch()`.
	 *
	 * Optional, TanStack style: a function that needs arguments usually reads
	 * best captured in a closure — `useQueryFn(() => getUser(id))` — which
	 * also keeps the typing airtight without this field.
	 */
	args?: Args;
	/** Skip the automatic call. `refetch()` still works. Defaults to true. */
	enabled?: boolean;
};

export type UseMutateFnOptions<Args extends readonly unknown[], R> = FnCallbacks<Args, R>;

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
	 * Runs the mutation. Resolves with the result, or `undefined` when the
	 * function failed — that failure lands in `error`, never as a rejection,
	 * so a bare `onClick={() => mutate(...)}` cannot leak an unhandled
	 * promise.
	 */
	mutate: (...args: Args) => Promise<R | undefined>;
	data: FnData<R>;
	/** True while the mutation (callbacks included) runs. Starts false. */
	loading: Tracked<boolean>;
	/** What the last call threw, or `null`. Cleared when a new call starts. */
	error: Tracked<unknown>;
	/** Back to the initial state: no data, no error, not loading. */
	reset: () => void;
};

/** The tracked state and single-flight runner both hooks are built from. */
function createFnState<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	initialLoading: boolean,
	callbacks: FnCallbacks<Args, Awaited<R>> | undefined
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

		let result: Awaited<R> | undefined;
		let thrown: unknown = null;
		let failed = false;

		try {
			// Guarded rather than optional-chained: with no callback, the
			// function must start synchronously, not a microtask later.
			if (callbacks?.onRequest !== undefined) await callbacks.onRequest(...args);

			result = await fn(...args);
		} catch (caught) {
			thrown = caught;
			failed = true;
		}

		try {
			if (failed) {
				if (token === latest) error.value = thrown;

				await callbacks?.onError?.(thrown, ...args);
			} else {
				if (token === latest) data.value = result;

				await callbacks?.onSuccess?.(result as Awaited<R>, ...args);
			}

			await callbacks?.onSettled?.(result, failed ? thrown : null, ...args);
		} finally {
			if (token === latest) loading.value = false;
		}

		return failed ? undefined : result;
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
 * 	const { data, loading, refetch } = useQueryFn(listTodos, {
 * 		onError: (error) => toast(String(error)),
 * 	});
 *
 * 	<ul>
 * 		@for (const todo of data; key todo.id) {
 * 			<li>{todo.name}</li>
 * 		}
 * 	</ul>
 * }
 * ```
 *
 * Options are always optional, TanStack style. A function that needs
 * arguments is usually written as a closure — `useQueryFn(() => getUser(id))`
 * — or handed them through `options.args`, typed against its signature.
 * Built for server functions but happy with any function. During SSR nothing
 * runs — network belongs to the browser — so the page server-renders in its
 * loading state and fills in after hydration. Iterating before the data
 * lands yields nothing.
 */
export function useQueryFn<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	options?: UseQueryFnOptions<Args, Awaited<R>>
): UseQueryFnResult<Args, Awaited<R>> {
	const args = (options?.args ?? []) as never as Args;
	const enabled = options?.enabled !== false;

	const state = createFnState(fn, enabled, options);

	if (IS_BROWSER && enabled) void state.run(...args);

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
 * const { mutate: addTodo, loading: adding } = useMutateFn(createTodo, {
 * 	onSuccess: () => todos.refetch(),
 * });
 *
 * <button onClick={() => addTodo('milk')} disabled={adding.value}>{'Add'}</button>
 * ```
 */
export function useMutateFn<Args extends readonly unknown[], R>(
	fn: (...args: Args) => R,
	options?: UseMutateFnOptions<Args, Awaited<R>>
): UseMutateFnResult<Args, Awaited<R>> {
	const state = createFnState(fn, false, options);

	return {
		mutate: (...args: Args) => state.run(...args),
		data: state.view,
		loading: state.loading,
		error: state.error,
		reset: state.reset,
	};
}
