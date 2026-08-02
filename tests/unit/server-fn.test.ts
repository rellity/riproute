import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServerFnStub } from '../../src/server-fn-client';
import {
	createServerFnDispatch,
	getRequestEvent,
	serverFn,
	withRequestEvent,
} from '../../src/server/server-fn';
import {
	collectServerFnExports,
	generateServerFnProxyModule,
	isServerFnFile,
	serverFnId,
} from '../../src/vite/server-fn';

const FILE = '/app/src/lib/todos.server.ts';

describe('collectServerFnExports', () => {
	const collect = (source: string) => collectServerFnExports(source, FILE);

	it('finds serverFn exports, and only those', async () => {
		const source = [
			"import { serverFn } from 'riproute/server';",
			'',
			'export const addTodo = serverFn(async (text: string) => text);',
			'export const listTodos = serverFn(async () => []);',
			"export const secret = 'nope';",
			'export function helper() { return 1; }',
			'const local = serverFn(async () => 0);',
		].join('\n');

		expect(await collect(source)).toEqual(['addTodo', 'listTodos']);
	});

	it('follows an import alias and ignores lookalike callees', async () => {
		const aliased = [
			"import { serverFn as fn } from 'riproute/server';",
			'export const a = fn(async () => 1);',
		].join('\n');

		expect(await collect(aliased)).toEqual(['a']);

		const impostor = [
			"import { serverFn } from 'somewhere-else';",
			'export const a = serverFn(async () => 1);',
		].join('\n');

		expect(await collect(impostor)).toEqual([]);
	});

	it('handles a default export and a file with no marker at all', async () => {
		const withDefault = [
			"import { serverFn } from 'riproute/server';",
			'export default serverFn(async () => 1);',
		].join('\n');

		expect(await collect(withDefault)).toEqual(['default']);
		expect(await collect('export const db = { query() {} };\n')).toEqual([]);
	});
});

describe('generateServerFnProxyModule', () => {
	it('emits one stub per export against the wire id', () => {
		const code = generateServerFnProxyModule(FILE, '/app', ['addTodo', 'default']);

		expect(code).toContain("import { createServerFnStub } from 'riproute';");
		expect(code).toContain(
			'export const addTodo = createServerFnStub("src/lib/todos.server.ts#addTodo");'
		);
		expect(code).toContain(
			'export default createServerFnStub("src/lib/todos.server.ts#default");'
		);
	});

	it('builds posix ids on any OS', () => {
		expect(serverFnId(path.join('/app', 'src', 'a.server.ts'), '/app', 'x')).toBe(
			'src/a.server.ts#x'
		);
	});
});

describe('isServerFnFile', () => {
	it.each([
		['src/lib/todos.server.ts', true],
		['src/hooks.server.ts', true],
		['src/db.server.mjs', true],
		['src/routes/index.tsrx', false],
		['src/server/db.ts', false],
	])('%s -> %s', (file, expected) => {
		expect(isServerFnFile(file)).toBe(expected);
	});
});

describe('createServerFnDispatch', () => {
	const add = serverFn(async (a: number, b: number) => a + b);
	const whoami = serverFn(async () => new URL(getRequestEvent().request.url).pathname);
	const boom = serverFn(async () => {
		throw new Error('kaput');
	});
	const unmarked = async () => 'leaked';

	const dispatch = createServerFnDispatch({
		'src/lib/math.server.ts': async () => ({ add, boom, whoami, unmarked }),
	});

	const call = (body: unknown, init: RequestInit = {}) =>
		dispatch(
			new Request('http://test/_riproute/rpc', {
				method: 'POST',
				body: JSON.stringify(body),
				...init,
			})
		);

	it('lets every other path through untouched', async () => {
		expect(await dispatch(new Request('http://test/about'))).toBeUndefined();
	});

	it('runs a marked function and returns its result', async () => {
		const response = await call({ id: 'src/lib/math.server.ts#add', args: [2, 3] });

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ ok: true, result: 5 });
	});

	it('opens the request context around the call', async () => {
		const response = await call({ id: 'src/lib/math.server.ts#whoami', args: [] });

		expect(await response?.json()).toEqual({ ok: true, result: '/_riproute/rpc' });
	});

	it('refuses unknown ids, unknown exports and unmarked functions alike', async () => {
		for (const id of [
			'src/lib/nope.server.ts#add',
			'src/lib/math.server.ts#nope',
			'src/lib/math.server.ts#unmarked',
			'no-separator',
		]) {
			const response = await call({ id, args: [] });

			expect(response?.status).toBe(404);
			expect(((await response?.json()) as { error: string }).error).toContain(
				'Unknown server function'
			);
		}
	});

	it('turns a thrown error into a 500 envelope', async () => {
		const response = await call({ id: 'src/lib/math.server.ts#boom', args: [] });

		expect(response?.status).toBe(500);
		expect(await response?.json()).toEqual({ ok: false, error: 'kaput' });
	});

	it('rejects non-POST and malformed bodies', async () => {
		const get = await dispatch(new Request('http://test/_riproute/rpc'));

		expect(get?.status).toBe(405);

		expect((await call('not json at all'))?.status).toBe(400);
		expect((await call({ id: 42, args: [] }))?.status).toBe(400);
		expect((await call({ id: 'x#y', args: 'no' }))?.status).toBe(400);
	});
});

describe('getRequestEvent', () => {
	it('throws outside a request, works inside one', () => {
		expect(() => getRequestEvent()).toThrow(/outside a request/);

		const request = new Request('http://test/page');

		expect(withRequestEvent(request, () => getRequestEvent().request)).toBe(request);
	});
});

describe('createServerFnStub', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('posts the call and unwraps the result', async () => {
		const fetch = vi.fn(async () => Response.json({ ok: true, result: 5 }));

		vi.stubGlobal('fetch', fetch);

		const stub = createServerFnStub('src/lib/math.server.ts#add');

		expect(await stub(2, 3)).toBe(5);
		expect(fetch).toHaveBeenCalledWith('/_riproute/rpc', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 'src/lib/math.server.ts#add', args: [2, 3] }),
		});
	});

	it('rethrows the server error message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ ok: false, error: 'kaput' }, { status: 500 }))
		);

		await expect(createServerFnStub('a#b')()).rejects.toThrow('kaput');
	});

	it('survives a non-JSON answer with the status in the message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
		);

		await expect(createServerFnStub('a#b')()).rejects.toThrow(/502/);
	});
});
