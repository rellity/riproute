import { render } from 'ripple/server';
import { describe, expect, it } from 'vitest';

import { Outlet, Router, defineRoutes } from '../../src/index';
import type { RouteComponentProps } from '../../src/index';

function Home() @{
	<h1>{'Home'}</h1>
}

function About() @{
	<h1>{'About'}</h1>
}

function User(props: RouteComponentProps<'/users/:id'>) @{
	<h1>{`User ${props.params.id}`}</h1>
}

function Missing() @{
	<h1>{'Custom 404'}</h1>
}

const routes = defineRoutes([
	{ path: '/', element: Home },
	{ path: '/about', element: About },
	{ path: '/users/:id', element: User },
]);

describe('SSR', () => {
	it('renders the route matching the url', async () => {
		function App() @{
			<Router url="/about" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<h1>About</h1>');
	});

	it('renders the index route', async () => {
		function App() @{
			<Router url="/" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<h1>Home</h1>');
	});

	it('passes params to the matched component', async () => {
		function App() @{
			<Router url="/users/42" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<h1>User 42</h1>');
	});

	it('ignores the query string when matching', async () => {
		function App() @{
			<Router url="/users/7?tab=posts" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<h1>User 7</h1>');
	});

	it('renders the built-in not-found component when nothing matches', async () => {
		function App() @{
			<Router url="/nope" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<div>Not found</div>');
	});

	it('renders a "**" route when nothing matches', async () => {
		function App() @{
			<Router url="/nope" routes={[...routes, { path: '**', element: Missing }]} />
		}

		expect(await render_to_string(App)).toBe('<h1>Custom 404</h1>');
	});

	it('prefers the fallback prop over a "**" route', async () => {
		function App() @{
			<Router
				url="/nope"
				routes={[...routes, { path: '**', element: Missing }]}
				fallback={About}
			/>
		}

		expect(await render_to_string(App)).toBe('<h1>About</h1>');
	});

	it('honours a base path', async () => {
		function App() @{
			<Router url="/app/about" base="/app" routes={routes} />
		}

		expect(await render_to_string(App)).toBe('<h1>About</h1>');
	});

	it('renders the page inside a root layout via <Outlet>', async () => {
		function RootLayout() @{
			<div class="shell">
				<nav>{'nav'}</nav>
				<main>
					<Outlet />
				</main>
			</div>
		}

		function App() @{
			<Router url="/about" routes={routes} root={RootLayout} />
		}

		expect(await render_to_string(App)).toBe(
			'<div class="shell"><nav>nav</nav><main><h1>About</h1></main></div>'
		);
	});

	it('does not leak routes between renders', async () => {
		function First() @{
			<Router url="/about" routes={routes} />
		}

		function Second() @{
			<Router url="/about" routes={[{ path: '/', element: Home }]} />
		}

		expect(await render_to_string(First)).toBe('<h1>About</h1>');
		expect(await render_to_string(Second)).toBe('<div>Not found</div>');
	});

	// The `<title>` itself is written by the SSR handler, not by a component —
	// see `tests/server/title.test.tsrx`. Ripple's `<head>` block only defers
	// its contents when it sits in the component handed to `render()`, which is
	// one level above `<Router>`, so a title claimed by a route would have been
	// flushed before the route ever made it. The router reports the title
	// outwards instead.
	it('writes nothing into the head itself', async () => {
		function App() @{
			<Router url="/" routes={routes} title="Sample" />
		}

		const { head } = await render(App as never);

		expect(head.replace(/<!--[^>]*-->/g, '')).toBe('');
	});

	it('reports the title through onTitle', async () => {
		const seen: (string | undefined)[] = [];

		function App() @{
			<Router url="/" routes={routes} title="Sample" onTitle={(t) => seen.push(t)} />
		}

		await render(App as never);

		expect(seen).toEqual(['Sample']);
	});
});
