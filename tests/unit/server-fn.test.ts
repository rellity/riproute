import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServerFnStub } from '../../packages/router/src/server-fn-client';
import { isClientEnvironment } from '../../packages/vite/src/package-root';
import { serverFnClientPlugin } from '../../packages/vite/src/server-fn';
import {
	createServerFnDispatch,
	getRequestEvent,
	serverFn,
	ServerFnError,
	withRequestEvent,
} from '../../packages/riproute/src/server/server-fn';
import {
	collectServerFnExports,
	generateServerFnProxyModule,
	isServerFnFile,
	serverFnHash,
} from '../../packages/vite/src/server-fn';

const FILE = '/app/src/lib/todos.server.ts';

describe('collectServerFnExports', () => {
	const collect = (source: string) => collectServerFnExports(source, FILE);

	it('finds serverFn exports, and only those', async () => {
		const source = [
			"import { serverFn } from '@riproute/riproute/server';",
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
			"import { serverFn as fn } from '@riproute/riproute/server';",
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
			"import { serverFn } from '@riproute/riproute/server';",
			'export default serverFn(async () => 1);',
		].join('\n');

		expect(await collect(withDefault)).toEqual(['default']);
		expect(await collect('export const db = { query() {} };\n')).toEqual([]);
	});

	it('finds the builder chain form', async () => {
		const source = [
			"import { serverFn } from '@riproute/riproute/server';",
			'',
			'export const addTodo = serverFn()',
			'\t.middleware([(event, next) => next()])',
			'\t.handler(async (text: string) => text);',
			'',
			'export const bare = serverFn().handler(async () => 1);',
			'export default serverFn().handler(async () => 2);',
			"export const other = fetch('/x').then((r) => r);",
		].join('\n');

		expect(await collect(source)).toEqual(['addTodo', 'bare', 'default']);
	});
});

describe('generateServerFnProxyModule', () => {
	it('emits one stub per export against the endpoint hash, path nowhere in sight', () => {
		const code = generateServerFnProxyModule(FILE, '/app', ['addTodo', 'default']);
		const addTodoHash = serverFnHash(FILE, '/app', 'addTodo');
		const defaultHash = serverFnHash(FILE, '/app', 'default');

		expect(code).toContain("import { createServerFnStub } from '@riproute/router';");
		expect(code).toContain(
			`export const addTodo = createServerFnStub("${addTodoHash}", "addTodo");`
		);
		expect(code).toContain(`export default createServerFnStub("${defaultHash}", "default");`);
		// The whole point of hashing: the app's file layout stays server-side.
		expect(code).not.toContain('todos.server.ts');
	});

	it('hashes identically from either OS path flavour, distinctly per name', () => {
		const posix = serverFnHash('/app/src/a.server.ts', '/app', 'x');

		expect(serverFnHash(path.join('/app', 'src', 'a.server.ts'), '/app', 'x')).toBe(posix);
		expect(posix).toMatch(/^[0-9a-f]{16}$/);
		expect(serverFnHash('/app/src/a.server.ts', '/app', 'y')).not.toBe(posix);
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

describe('client-environment gating', () => {
	it('keys on consumer, not the environment name', () => {
		expect(isClientEnvironment({ config: { consumer: 'client' } })).toBe(true);
		// A renamed environment that is a server build must not read as client.
		expect(isClientEnvironment({ name: 'client', config: { consumer: 'server' } })).toBe(false);
		expect(isClientEnvironment(undefined)).toBe(false);
	});

	it('the load-swap fires only for a client consumer, matching the guard', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-serverfn-'));
		const file = path.join(dir, 'x.server.ts');

		fs.writeFileSync(
			file,
			"import { serverFn } from '@riproute/riproute/server';\nexport const a = serverFn(async () => 1);\n"
		);

		const plugin = serverFnClientPlugin() as never as {
			configResolved: (config: { root: string }) => void;
			load: (this: unknown, id: string) => Promise<{ code: string } | null>;
		};

		plugin.configResolved({ root: dir });

		try {
			// Client consumer → the real module is swapped for a stub.
			const client = await plugin.load.call(
				{ environment: { config: { consumer: 'client' } } },
				file
			);

			expect(client?.code).toContain('createServerFnStub');

			// A server-consumer environment (even if it were named "client") never
			// swaps — the same predicate the guard now uses, so the two cannot
			// disagree and leave the real module in a client graph.
			const server = await plugin.load.call(
				{ environment: { name: 'client', config: { consumer: 'server' } } },
				file
			);

			expect(server).toBeNull();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('createServerFnDispatch', () => {
	const add = serverFn(async (a: number, b: number) => a + b);
	const whoami = serverFn(async () => new URL(getRequestEvent().request.url).pathname);
	const boom = serverFn(async () => {
		throw new Error('kaput');
	});
	const unmarked = async () => 'leaked';

	const module = async () => ({ add, boom, whoami, unmarked });
	const dispatch = createServerFnDispatch({
		addhash: { name: 'add', load: module },
		boomhash: { name: 'boom', load: module },
		whoamihash: { name: 'whoami', load: module },
		unmarkedhash: { name: 'unmarked', load: module },
		gonehash: { name: 'gone', load: module },
	});

	const call = (hash: string, body: unknown, init: RequestInit = {}) =>
		dispatch(
			new Request(`http://test/__riproute/serverfn/${hash}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				...init,
			})
		);

	it('lets every other path through untouched', async () => {
		expect(await dispatch(new Request('http://test/about'))).toBeUndefined();
		expect(await dispatch(new Request('http://test/__riproute/other'))).toBeUndefined();
	});

	it('refuses a cross-origin call (CSRF): no application/json, no run', async () => {
		let ran = false;
		const guarded = createServerFnDispatch({
			h: { name: 'fn', load: async () => ({ fn: serverFn(async () => (ran = true)) }) },
		});
		const at = (init: RequestInit) =>
			guarded(new Request('http://test/__riproute/serverfn/h', { method: 'POST', ...init }));

		// A cross-origin form/fetch can only send a CORS-safelisted content type;
		// none of these is application/json, so all are refused before the body
		// is even read — and the function never runs.
		for (const ct of [
			'text/plain',
			'application/x-www-form-urlencoded',
			'multipart/form-data',
		]) {
			const res = await at({ headers: { 'content-type': ct }, body: '{"args":[]}' });

			expect(res?.status).toBe(415);
		}

		// Missing content type entirely — still refused.
		expect((await at({ body: '{"args":[]}' }))?.status).toBe(415);

		// A browser that tells us the call is cross-site is refused even with the
		// right content type.
		const crossSite = await at({
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
			body: '{"args":[]}',
		});

		expect(crossSite?.status).toBe(403);
		expect(ran).toBe(false);

		// The legitimate same-origin stub sends application/json and goes through.
		const ok = await at({
			headers: { 'content-type': 'application/json; charset=utf-8' },
			body: '{"args":[]}',
		});

		expect(ok?.status).toBe(200);
		expect(ran).toBe(true);
	});

	it('runs a marked function and returns its result', async () => {
		const response = await call('addhash', { args: [2, 3] });

		expect(response?.status).toBe(200);
		expect(await response?.json()).toEqual({ ok: true, result: 5 });
	});

	it('opens the request context around the call', async () => {
		const response = await call('whoamihash', { args: [] });

		expect(await response?.json()).toEqual({
			ok: true,
			result: '/__riproute/serverfn/whoamihash',
		});
	});

	it('refuses unknown hashes, missing exports and unmarked functions alike', async () => {
		for (const hash of ['nosuchhash', 'gonehash', 'unmarkedhash', '']) {
			const response = await call(hash, { args: [] });

			expect(response?.status).toBe(404);
			expect(((await response?.json()) as { error: string }).error).toBe(
				'Unknown server function.'
			);
		}
	});

	it('hides a bare throw behind a generic 500, never leaking the message', async () => {
		const response = await call('boomhash', { args: [] });

		expect(response?.status).toBe(500);
		// `boom` throws `new Error('kaput')`; the real message stays server-side.
		expect(await response?.json()).toEqual({ ok: false, error: 'Server function failed.' });
	});

	it('surfaces a ServerFnError message and status to the client', async () => {
		const denied = serverFn(async () => {
			throw new ServerFnError('not allowed', { status: 403 });
		});
		const guarded = createServerFnDispatch({
			h: { name: 'fn', load: async () => ({ fn: denied }) },
		});

		const response = await guarded(
			new Request('http://test/__riproute/serverfn/h', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ args: [] }),
			})
		);

		expect(response?.status).toBe(403);
		expect(await response?.json()).toEqual({ ok: false, error: 'not allowed' });
	});

	it('resolves the target before reading the body, so unknown hashes cost nothing', async () => {
		const dispatchSpy = createServerFnDispatch({
			real: { name: 'fn', load: async () => ({ fn: serverFn(async () => 'ok') }) },
		});

		const unknown = new Request('http://test/__riproute/serverfn/nosuch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ args: [] }),
		});
		const known = new Request('http://test/__riproute/serverfn/real', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ args: [] }),
		});

		expect((await dispatchSpy(unknown))?.status).toBe(404);
		// The 404 came back without ever touching the body.
		expect(unknown.bodyUsed).toBe(false);

		// A real call does read it, so the check above is meaningful.
		expect((await dispatchSpy(known))?.status).toBe(200);
		expect(known.bodyUsed).toBe(true);
	});

	it('refuses a body past the size limit with 413', async () => {
		const tiny = createServerFnDispatch(
			{ real: { name: 'fn', load: async () => ({ fn: serverFn(async () => 'ok') }) } },
			undefined,
			{ maxBodyBytes: 8 }
		);

		const response = await tiny(
			new Request('http://test/__riproute/serverfn/real', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ args: ['0123456789'] }),
			})
		);

		expect(response?.status).toBe(413);
	});

	it('answers a prototype-chain key as a clean 404, not a 500', async () => {
		for (const hash of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			const response = await call(hash, { args: [] });

			expect(response?.status).toBe(404);
			expect(await response?.json()).toEqual({
				ok: false,
				error: 'Unknown server function.',
			});
		}
	});

	it('rejects non-POST and malformed bodies', async () => {
		const get = await dispatch(new Request('http://test/__riproute/serverfn/addhash'));

		expect(get?.status).toBe(405);

		expect((await call('addhash', 'not json at all'))?.status).toBe(400);
		expect((await call('addhash', { args: 'no' }))?.status).toBe(400);
		expect((await call('addhash', {}))?.status).toBe(400);
	});
});

describe('getRequestEvent', () => {
	it('throws outside a request, works inside one', () => {
		expect(() => getRequestEvent()).toThrow(/outside a request/);

		const request = new Request('http://test/page');

		expect(withRequestEvent(request, () => getRequestEvent().request)).toBe(request);
	});

	it('reuses the open context for the same request, so locals survive nesting', () => {
		const request = new Request('http://test/page');

		// The handler opens the context and a hook writes to locals; the dispatch
		// then wraps the call in withRequestEvent again — the server function must
		// still see what the hook wrote, not a fresh empty locals.
		const seen = withRequestEvent(request, () => {
			getRequestEvent().locals.user = 'ada';

			return withRequestEvent(request, () => getRequestEvent().locals.user);
		});

		expect(seen).toBe('ada');

		// A different request never shares another's context.
		const other = withRequestEvent(request, () => {
			getRequestEvent().locals.user = 'grace';

			return withRequestEvent(
				new Request('http://test/other'),
				() => getRequestEvent().locals.user
			);
		});

		expect(other).toBeUndefined();
	});
});

describe('serverFn builder', () => {
	const request = new Request('http://test/_riproute/rpc');
	const inRequest = <T>(run: () => T) => withRequestEvent(request, run);

	it('runs middleware in order, around the handler', async () => {
		const order: string[] = [];

		const fn = serverFn()
			.middleware([
				async (_event, next) => {
					order.push('a:before');

					const result = await next();

					order.push('a:after');

					return result;
				},
				(_event, next) => {
					order.push('b');

					return next();
				},
			])
			.handler(async (value: number) => {
				order.push('handler');

				return value * 2;
			});

		expect(await inRequest(() => fn(21))).toBe(42);
		expect(order).toEqual(['a:before', 'b', 'handler', 'a:after']);
	});

	it('passes locals from middleware to the handler', async () => {
		const fn = serverFn()
			.middleware([
				(event, next) => {
					event.locals.user = 'ada';

					return next();
				},
			])
			.handler(async () => getRequestEvent().locals.user);

		expect(await inRequest(() => fn())).toBe('ada');
	});

	it('short-circuits when middleware never calls next', async () => {
		let ran = false;

		const fn = serverFn()
			.middleware([() => 'blocked'])
			.handler(async () => {
				ran = true;

				return 'handled';
			});

		expect(await inRequest(() => fn())).toBe('blocked');
		expect(ran).toBe(false);
	});

	it('a middleware throw fails the call', async () => {
		const fn = serverFn()
			.middleware([
				() => {
					throw new Error('unauthorized');
				},
			])
			.handler(async () => 'never');

		await expect(inRequest(() => fn())).rejects.toThrow('unauthorized');
	});

	it('calling next twice is an error', async () => {
		const fn = serverFn()
			.middleware([
				async (_event, next) => {
					await next();

					return next();
				},
			])
			.handler(async () => 1);

		await expect(inRequest(() => fn())).rejects.toThrow(/next\(\) was called twice/);
	});

	it('the builder result is dispatchable like the shorthand', async () => {
		const fn = serverFn()
			.middleware([
				(event, next) => {
					event.locals.suffix = '!';

					return next();
				},
			])
			.handler(async (name: string) => `hi ${name}${getRequestEvent().locals.suffix}`);

		const dispatch = createServerFnDispatch({
			fnhash: { name: 'fn', load: async () => ({ fn }) },
		});

		const response = await dispatch(
			new Request('http://test/__riproute/serverfn/fnhash', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ args: ['ada'] }),
			})
		);

		expect(await response?.json()).toEqual({ ok: true, result: 'hi ada!' });
	});
});

describe('createServerFnStub', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('posts to the function endpoint and unwraps the result', async () => {
		const fetch = vi.fn(async () => Response.json({ ok: true, result: 5 }));

		vi.stubGlobal('fetch', fetch);

		const stub = createServerFnStub('abc123', 'add');

		expect(await stub(2, 3)).toBe(5);
		expect(fetch).toHaveBeenCalledWith('/__riproute/serverfn/abc123', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ args: [2, 3] }),
		});
	});

	it('rethrows the server error message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ ok: false, error: 'kaput' }, { status: 500 }))
		);

		await expect(createServerFnStub('abc123', 'add')()).rejects.toThrow('kaput');
	});

	it('names the function and status when the answer is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
		);

		await expect(createServerFnStub('abc123', 'add')()).rejects.toThrow(/add\(\).*502/);
	});
});
