import { chromium } from 'playwright';

/**
 * Browser checks run against a live riproute server.
 *
 * These exist because every SSR bug this project has hit was invisible to unit
 * tests: hydration silently falls back to a client mount, and a broken outlet
 * anchor leaves the page blank on the *second* render, not the first. Only a
 * real browser against a real server catches either.
 */
export async function runChecks(baseUrl, label) {
	const browser = await chromium.launch({
		...(process.env.CHROMIUM_PATH === undefined
			? {}
			: { executablePath: process.env.CHROMIUM_PATH }),
	});
	const page = await browser.newPage();

	const messages = [];

	// Warnings, not just errors: Ripple reports a failed hydration with
	// `console.warn`, which is exactly the signal these checks are here for.
	page.on('console', (message) => {
		if (message.type() === 'log' || message.type() === 'debug') return;

		messages.push(`${message.type()}: ${message.text().split('\n')[0]}`);
	});
	page.on('pageerror', (error) => messages.push(`pageerror: ${String(error).split('\n')[0]}`));

	let loads = 0;
	page.on('load', () => loads++);

	const failures = [];
	const check = (name, ok, detail = '') => {
		process.stdout.write(`  ${ok ? '✔' : `✘`} ${name}${!ok && detail ? ` — ${detail}` : ''}\n`);

		if (!ok) failures.push(name);
	};

	console.log(`\n${label} (${baseUrl})`);

	await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });

	const noise = messages.filter((message) => !message.includes('favicon.ico'));

	check(
		'hydrates without falling back to mount',
		!noise.some((m) => m.includes('Hydration failed')),
		noise.join(' | ')
	);
	check('no page errors', !noise.some((m) => m.startsWith('pageerror')), noise.join(' | '));

	// Tag the server's node. If hydration adopted the markup the same element
	// object survives; a fallback mount would have thrown it away.
	await page.evaluate(() => document.querySelector('main h1')?.setAttribute('data-ssr', '1'));

	await page.click('main button');
	await page.waitForTimeout(150);

	check(
		'server-rendered markup is interactive',
		(await page.textContent('main button')) === 'count: 1'
	);
	check(
		'ssr nodes adopted, not replaced',
		await page.evaluate(() => !!document.querySelector('main h1[data-ssr]'))
	);

	check('exactly one <title>', (await page.locator('title').count()) === 1);
	// The home page claims `home` with `append`; the base comes from the
	// shell's own <head>, not from vite.config.ts.
	check('hydrated page claims its title', (await page.title()) === 'home | riproute');

	// The regression this file exists for: a state update on the hydrated page
	// must not duplicate the layout (Ripple 0.3.118 does exactly that when a
	// tracked write lands during/around hydration, or a route has a fragment
	// root).
	check('no layout duplication after update', (await page.locator('main').count()) === 1);

	const before = loads;

	await page.click('a[href="/users/42"]');
	await page.waitForSelector('h1:has-text("User 42")', { timeout: 5000 });
	check('param route renders on navigate', true);
	check('navigation is client-side', loads === before, `full loads: ${loads - before}`);
	check('<title replace> takes over', (await page.title()) === 'User 42');

	await page.click('a[href="/files/a/b/c"]');
	await page.waitForSelector('h1:has-text("Files: a/b/c")', { timeout: 5000 });
	check('splat route renders on navigate', true);
	check('a bare <title> replaces too', (await page.title()) === 'Files');

	await page.click('a[href="/about"]');
	await page.waitForSelector('h1:has-text("About")', { timeout: 5000 });
	check('&title expands on the client', (await page.title()) === 'About | riproute');
	check('still exactly one <title>', (await page.locator('title').count()) === 1);

	await page.click('a[href="/nope"]');
	await page.waitForSelector('h1:has-text("Nothing here")', { timeout: 5000 });
	check('catch-all route renders on navigate', true);
	check('title falls back when a route claims none', (await page.title()) === 'riproute');

	await page.goBack();
	await page.waitForSelector('h1:has-text("About")', { timeout: 5000 });
	check('back button restores the previous route', true);
	check('still one layout after the round trip', (await page.locator('main').count()) === 1);

	await page.goForward();
	await page.waitForSelector('h1:has-text("Nothing here")', { timeout: 5000 });
	await page.goBack();
	await page.waitForSelector('h1:has-text("About")', { timeout: 5000 });

	check(
		'active link tracks the location',
		(await page.getAttribute('a[href="/about"]', 'class')) === 'active'
	);

	const rpcMessages = messages.length;

	await page.goto(`${baseUrl}/rpc`, { waitUntil: 'networkidle' });
	await page.click('button:has-text("Call greet()")');
	await page.waitForFunction(
		() => (document.getElementById('rpc-reply')?.textContent ?? '') !== '',
		undefined,
		{ timeout: 5000 }
	);
	// Each function gets its own endpoint: /__riproute/serverfn/<hash>.
	const rpcReply = (await page.textContent('#rpc-reply')) ?? '';

	check(
		'server function round-trips',
		/^Hello, riproute! via \/__riproute\/serverfn\/[0-9a-f]{16}$/.test(rpcReply),
		rpcReply
	);

	// The load-on-mount pattern from the docs: useQueryFn() calling a server
	// function once hydrated. Also proves the reactive writes it makes do not
	// desync hydration.
	await page.waitForFunction(
		() => document.getElementById('rpc-auto')?.textContent === 'Hello, effect!',
		undefined,
		{ timeout: 5000 }
	);
	check('server function loads on mount via useQueryFn', true);

	// useQueryFn data: @for over the destructured data ref, filled in when the
	// array lands.
	await page.waitForFunction(
		() => document.querySelectorAll('#rpc-todos li').length === 3,
		undefined,
		{ timeout: 5000 }
	);
	check(
		'useQueryFn data iterates the loaded array in @for',
		(await page.textContent('#rpc-todos li:first-child')) === 'write a route'
	);
	check(
		'rpc page hydrates clean',
		!messages
			.slice(rpcMessages)
			.some((m) => m.includes('Hydration failed') || m.startsWith('pageerror')),
		messages.slice(rpcMessages).join(' | ')
	);

	await browser.close();

	return failures;
}
