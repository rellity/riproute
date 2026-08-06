import { describe, expect, it, vi } from 'vitest';

import { createFetchHandler } from '../../src/adapter-workerd/index';

const ok = (body = 'page') =>
	new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('createFetchHandler', () => {
	it('renders through the handler, needing no env or ctx', async () => {
		const fetch = createFetchHandler(async () => ok());
		const response = await fetch(new Request('http://app.test/'));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('page');
	});

	it('tries the ASSETS binding for file-looking paths only', async () => {
		const assets = vi.fn(async () => new Response('asset', { status: 200 }));
		const handler = vi.fn(async () => ok());
		const fetch = createFetchHandler(handler);

		const asset = await fetch(new Request('http://app.test/assets/app-abc.js'), {
			ASSETS: { fetch: assets },
		});

		expect(await asset.text()).toBe('asset');
		expect(handler).not.toHaveBeenCalled();

		// A page must not spend a subrequest on the assets binding.
		const page = await fetch(new Request('http://app.test/users/42'), {
			ASSETS: { fetch: assets },
		});

		expect(await page.text()).toBe('page');
		expect(assets).toHaveBeenCalledTimes(1);
	});

	it('falls through to the router when the binding 404s', async () => {
		const assets = { fetch: async () => new Response('nope', { status: 404 }) };
		const fetch = createFetchHandler(async () => ok('rendered 404 page'));

		const response = await fetch(new Request('http://app.test/missing.js'), { ASSETS: assets });

		expect(await response.text()).toBe('rendered 404 page');
	});

	it('can be told to ignore the binding entirely', async () => {
		const assets = vi.fn(async () => new Response('asset'));
		const fetch = createFetchHandler(async () => ok(), { assets: false });

		await fetch(new Request('http://app.test/assets/app-abc.js'), {
			ASSETS: { fetch: assets },
		});

		expect(assets).not.toHaveBeenCalled();
	});

	it('refuses a host outside allowedHosts with a 400', async () => {
		const fetch = createFetchHandler(async () => ok(), { allowedHosts: ['app.test'] });

		expect((await fetch(new Request('http://app.test/'))).status).toBe(200);
		expect((await fetch(new Request('http://evil.test/'))).status).toBe(400);
	});

	it('turns a thrown handler into a 500 without leaking the error', async () => {
		const fetch = createFetchHandler(async () => {
			throw new Error('DB_PASSWORD=hunter2');
		});

		const response = await fetch(new Request('http://app.test/'));
		const body = await response.text();

		expect(response.status).toBe(500);
		expect(body).not.toContain('hunter2');
	});

	it('survives an onError that itself throws', async () => {
		const fetch = createFetchHandler(
			async () => {
				throw new Error('boom');
			},
			{
				onError: () => {
					throw new Error('onError blew up');
				},
			}
		);

		const response = await fetch(new Request('http://app.test/'));

		expect(response.status).toBe(500);
		expect(await response.text()).toBe('Internal Server Error');
	});
});
