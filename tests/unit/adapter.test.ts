import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';

import {
	createServer,
	sendWebResponse,
	serveStatic,
	toWebRequest,
} from '../../src/adapter-node/index';

/** A minimal stand-in for `IncomingMessage`. */
function fakeRequest(
	overrides: Partial<{
		url: string;
		method: string;
		headers: Record<string, string | string[]>;
		encrypted: boolean;
		body: string;
	}> = {}
) {
	const readable = Readable.from(
		overrides.body === undefined ? [] : [Buffer.from(overrides.body)]
	);

	return Object.assign(readable, {
		url: overrides.url ?? '/',
		method: overrides.method ?? 'GET',
		headers: { host: 'app.test', ...overrides.headers },
		socket: { encrypted: overrides.encrypted ?? false },
	}) as never;
}

/** A minimal stand-in for `ServerResponse` that records what was written. */
function fakeResponse() {
	const record = {
		headers: new Map<string, unknown>(),
		chunks: [] as Buffer[],
		ended: false,
	};

	const res = Object.assign(new EventEmitter(), {
		statusCode: 0,
		statusMessage: '',
		setHeader(key: string, value: unknown) {
			record.headers.set(key, value);
		},
		write(chunk: Uint8Array) {
			record.chunks.push(Buffer.from(chunk));
			return true;
		},
		end() {
			record.ended = true;
		},
		destroy() {
			record.ended = true;
		},
	});

	return { record, res: res as never, status: () => res.statusCode };
}

describe('toWebRequest', () => {
	it('builds the URL from the host header', () => {
		const request = toWebRequest(fakeRequest({ url: '/users/1?tab=x' }));

		expect(request.url).toBe('http://app.test/users/1?tab=x');
		expect(request.method).toBe('GET');
	});

	it('ignores forwarded headers unless told to trust them', () => {
		const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.test' };

		expect(toWebRequest(fakeRequest({ headers })).url).toBe('http://app.test/');
		expect(toWebRequest(fakeRequest({ headers }), { trustProxy: true }).url).toBe(
			'https://evil.test/'
		);
	});

	it('takes the first hop of a comma-joined forwarded header', () => {
		const request = toWebRequest(
			fakeRequest({ headers: { 'x-forwarded-host': 'a.test, b.test' } }),
			{ trustProxy: true }
		);

		expect(new URL(request.url).host).toBe('a.test');
	});

	it('streams a request body', async () => {
		const request = toWebRequest(fakeRequest({ method: 'POST', body: '{"a":1}', headers: {} }));

		expect(await request.text()).toBe('{"a":1}');
	});
});

describe('sendWebResponse', () => {
	it('writes status, headers and body', async () => {
		const { record, res, status } = fakeResponse();

		await sendWebResponse(res, new Response('hello', { status: 201, headers: { 'x-a': '1' } }));

		expect(status()).toBe(201);
		expect(record.headers.get('x-a')).toBe('1');
		expect(Buffer.concat(record.chunks).toString()).toBe('hello');
		expect(record.ended).toBe(true);
	});

	it('keeps multiple set-cookie headers apart', async () => {
		const { record, res } = fakeResponse();
		const headers = new Headers();

		headers.append('set-cookie', 'a=1; Path=/');
		headers.append('set-cookie', 'b=2; Path=/');

		await sendWebResponse(res, new Response('x', { headers }));

		// `Headers` joins duplicates with a comma, which silently merges two
		// cookies into one broken value — the adapter must not.
		expect(record.headers.get('set-cookie')).toEqual(['a=1; Path=/', 'b=2; Path=/']);
	});

	it('handles a bodyless response', async () => {
		const { record, res, status } = fakeResponse();

		await sendWebResponse(res, new Response(null, { status: 304 }));

		expect(status()).toBe(304);
		expect(record.chunks).toHaveLength(0);
		expect(record.ended).toBe(true);
	});
});

describe('serveStatic', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-static-'));

	fs.mkdirSync(path.join(dir, 'assets'));
	fs.writeFileSync(path.join(dir, 'assets/app-abc123.js'), 'console.log(1);');
	fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *');
	fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

	const serve = serveStatic(dir, { immutable: ['assets'] });

	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('serves a file with the right type', async () => {
		const response = await serve(new Request('http://t/robots.txt'));

		expect(response?.status).toBe(200);
		expect(response?.headers.get('content-type')).toContain('text/plain');
		expect(await response?.text()).toBe('User-agent: *');
	});

	it('marks hashed assets immutable, but not the rest', async () => {
		const asset = await serve(new Request('http://t/assets/app-abc123.js'));
		const robots = await serve(new Request('http://t/robots.txt'));

		expect(asset?.headers.get('cache-control')).toContain('immutable');
		expect(robots?.headers.get('cache-control')).not.toContain('immutable');
	});

	it('answers 304 on a matching etag', async () => {
		const first = await serve(new Request('http://t/robots.txt'));
		const etag = first?.headers.get('etag') as string;

		const second = await serve(
			new Request('http://t/robots.txt', { headers: { 'if-none-match': etag } })
		);

		expect(second?.status).toBe(304);
	});

	it('misses fall through to the router', async () => {
		expect(await serve(new Request('http://t/none.txt'))).toBeUndefined();
	});

	it('never serves the document itself — that is rendered', async () => {
		expect(await serve(new Request('http://t/'))).toBeUndefined();
		expect(await serve(new Request('http://t/index.html'))).toBeUndefined();
	});

	it('refuses path traversal', async () => {
		expect(await serve(new Request('http://t/..%2f..%2fetc%2fpasswd'))).toBeUndefined();
		expect(await serve(new Request('http://t/assets/%2e%2e/robots.txt'))).toBeDefined();
	});

	it('only answers GET and HEAD', async () => {
		expect(await serve(new Request('http://t/robots.txt', { method: 'POST' }))).toBeUndefined();
	});
});

describe('createServer', () => {
	it('serves a handler over real HTTP, compressed when asked', async () => {
		const big = 'riproute '.repeat(1000);
		const server = createServer(
			() => new Response(big, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
			{ gracefulShutdown: false }
		);

		const { port } = await server.listen({ port: 0, host: '127.0.0.1' });

		try {
			const plain = await fetch(`http://127.0.0.1:${port}/`);

			expect(await plain.text()).toBe(big);

			// `fetch` decompresses transparently; ask node:http for the raw bytes.
			const raw = await new Promise<{ encoding: string | undefined; size: number }>(
				(resolve, reject) => {
					http.get(
						{ port, path: '/', headers: { 'accept-encoding': 'gzip' } },
						(response) => {
							let size = 0;

							response.on('data', (chunk: Buffer) => (size += chunk.length));
							response.on('end', () =>
								resolve({ encoding: response.headers['content-encoding'], size })
							);
						}
					).on('error', reject);
				}
			);

			expect(raw.encoding).toBe('gzip');
			expect(raw.size).toBeLessThan(big.length / 5);
		} finally {
			await server.close();
		}
	});

	it('turns a thrown handler into a 500', async () => {
		const server = createServer(
			() => {
				throw new Error('boom');
			},
			{
				gracefulShutdown: false,
				onError: () => new Response('custom error', { status: 500 }),
			}
		);

		const { port } = await server.listen({ port: 0, host: '127.0.0.1' });

		try {
			const response = await fetch(`http://127.0.0.1:${port}/`);

			expect(response.status).toBe(500);
			expect(await response.text()).toBe('custom error');
		} finally {
			await server.close();
		}
	});
});
