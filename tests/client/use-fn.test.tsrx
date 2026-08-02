import { flushSync } from 'ripple';
import { describe, expect, it, vi } from 'vitest';

import { useFn } from '../../src/index';

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

describe('useFn', () => {
	it('loads on mount, exposes value and loading, iterates in @for', async () => {
		const first = deferred<Todo[]>();
		const listTodos = vi.fn((): Promise<Todo[]> => first.promise);

		function Todos() @{
			const todos = useFn(listTodos);

			<div>
				<p id="state">{todos.loading ? 'loading' : 'done'}</p>
				<ul>
					@for (const todo of todos; key todo.id) {
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

	it('passes arguments through, typed, and refresh() re-runs', async () => {
		const calls: string[] = [];
		const greet = vi.fn(async (name: string) => {
			calls.push(name);

			return `hi ${name}`;
		});

		let refresh!: (...args: [string]) => Promise<void>;

		function Greeting() @{
			const greeting = useFn(greet, 'ada');

			refresh = greeting.refresh;

			<p>{greeting.value ?? ''}</p>
		}

		render_into_dom(Greeting);
		flushSync();

		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('hi ada');
		});

		// No arguments — the original ones are reused.
		await refresh();
		flushSync();
		expect(calls).toEqual(['ada', 'ada']);

		// New arguments override.
		await refresh('grace');
		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('hi grace');
		});
	});

	it('captures a rejection in error and clears it on refresh', async () => {
		let shouldFail = true;
		const flaky = vi.fn(async () => {
			if (shouldFail) throw new Error('offline');

			return 'recovered';
		});

		let refresh!: () => Promise<void>;

		function Flaky() @{
			const state = useFn(flaky);

			refresh = state.refresh;

			<p>{state.error instanceof Error ? state.error.message : (state.value ?? '')}</p>
		}

		render_into_dom(Flaky);

		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('p')?.textContent).toBe('offline');
		});

		shouldFail = false;
		await refresh();
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

		let refresh!: () => Promise<void>;

		function Race() @{
			const state = useFn(fn);

			refresh = state.refresh;

			<p>{state.value ?? ''}</p>
		}

		render_into_dom(Race);
		flushSync();

		const second = refresh();

		fast.resolve('newer');
		await second;
		slow.resolve('stale');
		await slow.promise;
		flushSync();

		expect(container.querySelector('p')?.textContent).toBe('newer');
	});
});
