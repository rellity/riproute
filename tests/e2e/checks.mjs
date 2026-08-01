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
		executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
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
	check('title comes from the router', (await page.title()) === 'riproute');

	const before = loads;

	await page.click('a[href="/users/42"]');
	await page.waitForSelector('h1:has-text("User 42")', { timeout: 5000 });
	check('param route renders on navigate', true);
	check('navigation is client-side', loads === before, `full loads: ${loads - before}`);

	await page.click('a[href="/files/a/b/c"]');
	await page.waitForSelector('h1:has-text("Files: a/b/c")', { timeout: 5000 });
	check('splat route renders on navigate', true);

	await page.click('a[href="/nope"]');
	await page.waitForSelector('h1:has-text("Nothing here")', { timeout: 5000 });
	check('catch-all route renders on navigate', true);

	await page.goBack();
	await page.waitForSelector('h1:has-text("Files: a/b/c")', { timeout: 5000 });
	check('back button restores the previous route', true);

	check(
		'active link tracks the location',
		(await page.getAttribute('a[href="/files/a/b/c"]', 'class')) === 'active'
	);

	await browser.close();

	return failures;
}
