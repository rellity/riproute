import { flushSync } from 'ripple';
import { describe, expect, it, vi } from 'vitest';

import { useMutateFn, useQueryFn } from '../../src/index';

type Todo = { id: number; name: string };

/** A controllable async function, resolved from the test body. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

describe('useQueryFn', () => {
	it('loads on mount, destructures reactively, iterates data in @for', async () => {
		const first = deferred<Todo[]>();
		const listTodos = vi.fn((): Promise<Todo[]> => first.promise);

		function Todos() @{
			const { data, loading } = useQueryFn(listTodos);

			<div>
				<p id="state">{loading.value ? 'loading' : 'done'}</p>
				<ul>
					@for (const todo of data; key todo.id) {
						<li>{todo.name}</li>
					}
				</ul>
			</div>
		}

		render_into_dom(Todos);
		flushSync();

		expect(listTodos).toHaveBeenCalledTimes(1);
		expect(container.querySelector('#state')?.textContent).toBe('loading');
		expect(container.querySelectorAll('li')).toHaveLength(0);

		first.resolve([
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' },
		]);
		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('#state')?.textContent).toBe('done');
		});

		const items = [...container.querySelectorAll('li')].map((li) => li.textContent);

		expect(items).toEqual(['one', 'two']);
	});

	it('passes arguments through, typed, and refetch() re-runs', async () => {
		const calls: string[] = [];
		const greet = vi.fn(async (name: string) => {
			calls.push(name);

			return `hi ${name}`;
		});

		let refetch!: (...args: [string] | []) => Promise<string | undefined>;

		function Greeting() @{
			const greeting = useQueryFn(greet, 'ada');

			refetch = greeting.refetch as never;

			<p>{greeting.data.value ?? ''}</p>
		}

		render_into_dom(Greeting);
		flushSync();

		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('hi ada');
		});

		// No arguments — the original ones are reused.
		await refetch();
		flushSync();
		expect(calls).toEqual(['ada', 'ada']);

		// New arguments override, and the value comes back too.
		expect(await refetch('grace')).toBe('hi grace');
		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('hi grace');
		});
	});

	it('captures a rejection in error and clears it on refetch', async () => {
		let shouldFail = true;
		const flaky = vi.fn(async () => {
			if (shouldFail) throw new Error('offline');

			return 'recovered';
		});

		let refetch!: () => Promise<string | undefined>;

		function Flaky() @{
			const { data, error, refetch: again } = useQueryFn(flaky);

			refetch = again;

			<p>{error.value instanceof Error ? error.value.message : (data.value ?? '')}</p>
		}

		render_into_dom(Flaky);

		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('offline');
		});

		shouldFail = false;
		await refetch();
		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('recovered');
		});
	});

	it('a superseded call never overwrites the newer result', async () => {
		const slow = deferred<string>();
		const fast = deferred<string>();
		let call = 0;
		const fn = vi.fn(() => (++call === 1 ? slow.promise : fast.promise));

		let refetch!: () => Promise<string | undefined>;

		function Race() @{
			const { data, refetch: again } = useQueryFn(fn);

			refetch = again;

			<p>{data.value ?? ''}</p>
		}

		render_into_dom(Race);
		flushSync();

		const second = refetch();

		fast.resolve('newer');
		await second;
		slow.resolve('stale');
		await slow.promise;
		flushSync();

		expect(container.querySelector('p')?.textContent).toBe('newer');
	});
});

describe('useMutateFn', () => {
	it('runs nothing until mutate(), then tracks loading, data and reset', async () => {
		const gate = deferred<string>();
		const save = vi.fn((name: string) => {
			void name;

			return gate.promise;
		});

		let mutate!: (name: string) => Promise<string | undefined>;
		let reset!: () => void;

		function Save() @{
			const mutation = useMutateFn(save);

			mutate = mutation.mutate;
			reset = mutation.reset;

			<p>{mutation.loading.value ? 'saving' : (mutation.data.value ?? 'idle')}</p>
		}

		render_into_dom(Save);
		flushSync();

		expect(save).not.toHaveBeenCalled();
		expect(container.querySelector('p')?.textContent).toBe('idle');

		const done = mutate('milk');

		flushSync();
		expect(container.querySelector('p')?.textContent).toBe('saving');

		gate.resolve('saved');
		expect(await done).toBe('saved');
		flushSync();
		expect(container.querySelector('p')?.textContent).toBe('saved');

		reset();
		flushSync();
		expect(container.querySelector('p')?.textContent).toBe('idle');
	});

	it('mutate never rejects: the failure lands in error, the promise in undefined', async () => {
		const explode = vi.fn(async () => {
			throw new Error('nope');
		});

		let mutate!: () => Promise<never | undefined>;

		function Boom() @{
			const { mutate: run, error } = useMutateFn(explode);

			mutate = run;

			<p>{error.value instanceof Error ? error.value.message : 'fine'}</p>
		}

		render_into_dom(Boom);
		flushSync();

		expect(container.querySelector('p')?.textContent).toBe('fine');

		// A bare onClick={() => mutate()} must not leak an unhandled rejection.
		expect(await mutate()).toBeUndefined();
		flushSync();
		expect(container.querySelector('p')?.textContent).toBe('nope');
	});
});
