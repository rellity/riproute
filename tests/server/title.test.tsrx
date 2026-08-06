import { describe, expect, it } from 'vitest';

import { Outlet, defineRoutes } from '../../packages/router/src/index';
import type { RouteComponentProps } from '../../packages/router/src/index';
import { createHandler } from '../../packages/riproute/src/server/index';

const TEMPLATE =
	'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

function Home() @{
	<div>
		<title extend>{'Home'}</title>
		<h1>{'Home'}</h1>
	</div>
}

function Docs() @{
	<div>
		<title replace>{'docs'}</title>
		<h1>{'Docs'}</h1>
	</div>
}

function Plain() @{
	<div>
		<title>{'plain'}</title>
	</div>
}

function Token() @{
	<div>
		<title>{'home | &title'}</title>
	</div>
}

function Separator() @{
	<div>
		<title extend separator=" · ">{'sep'}</title>
	</div>
}

function Escaped() @{
	<div>
		<title>{'Tom & Jerry <3'}</title>
	</div>
}

function Untitled() @{
	<h1>{'nothing claimed'}</h1>
}

function User(props: RouteComponentProps<'/users/:id'>) @{
	<div>
		<title>{`User ${props.params.id}`}</title>
	</div>
}

const routes = defineRoutes([
	{ path: '/', element: Home },
	{ path: '/docs', element: Docs },
	{ path: '/plain', element: Plain },
	{ path: '/token', element: Token },
	{ path: '/separator', element: Separator },
	{ path: '/escaped', element: Escaped },
	{ path: '/untitled', element: Untitled },
	{ path: '/users/:id', element: User },
]);

/** Renders a URL through the real handler. */
async function renderUrl(url: string, title?: string) {
	const handler = createHandler({ routes, title, template: TEMPLATE });

	return (await handler(new Request(`http://test${url}`))).text();
}

async function titleOf(url: string, title?: string) {
	const match = (await renderUrl(url, title)).match(/<title>([^<]*)<\/title>/);

	return match === null ? null : match[1];
}

describe('literal <title>', () => {
	it('extends the base title', async () => {
		expect(await titleOf('/', 'Site')).toBe('Home | Site');
	});

	it('replaces with the keyword', async () => {
		expect(await titleOf('/docs', 'Site')).toBe('docs');
	});

	it('replaces by default, with no keyword', async () => {
		expect(await titleOf('/plain', 'Site')).toBe('plain');
	});

	it('expands &title without needing extend', async () => {
		expect(await titleOf('/token', 'Site')).toBe('home | Site');
	});

	it('drops the dangling separator when there is no base title', async () => {
		expect(await titleOf('/token')).toBe('home');
	});

	it('honours a custom separator', async () => {
		expect(await titleOf('/separator', 'Site')).toBe('sep · Site');
	});

	it('builds the title from route params', async () => {
		expect(await titleOf('/users/42', 'Site')).toBe('User 42');
	});

	it('falls back to the base title when a route claims nothing', async () => {
		expect(await titleOf('/untitled', 'Site')).toBe('Site');
	});

	it('emits no <title> when there is nothing to say', async () => {
		expect(await titleOf('/untitled')).toBeNull();
	});

	it('escapes the title', async () => {
		expect(await renderUrl('/escaped', 'Site')).toContain(
			'<title>Tom &amp; Jerry &lt;3</title>'
		);
	});

	it('emits exactly one <title>, and none in the body', async () => {
		const html = await renderUrl('/', 'Site');

		expect(html.match(/<title>/g)).toHaveLength(1);
		expect(html.slice(html.indexOf('<body'))).not.toContain('<title');
	});

	it('claims the title from inside a root layout', async () => {
		function Shell() @{
			<main>
				<Outlet />
			</main>
		}

		const handler = createHandler({ routes, root: Shell, title: 'Site', template: TEMPLATE });
		const html = await (await handler(new Request('http://test/docs'))).text();

		expect(html).toContain('<title>docs</title>');
		expect(html).toContain('<h1>Docs</h1>');
	});
});
