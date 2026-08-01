import { flushSync, track } from 'ripple';
import { describe, expect, it, vi } from 'vitest';

import { Link, Outlet, Redirect, Router, defineRoutes, navigateTo } from '../../src/index';
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

const routes = defineRoutes([
	{ path: '/', element: Home },
	{ path: '/about', element: About },
	{ path: '/users/:id', element: User },
]);

function Shell() @{
	<div>
		<nav>
			<Link href="/" activeClass="active" exact>{'Home'}</Link>
			<Link href="/about" activeClass="active">{'About'}</Link>
			<Link href="/users/42">{'User'}</Link>
			<Link href="https://example.com">{'External'}</Link>
		</nav>
		<main>
			<Outlet />
		</main>
	</div>
}

function App() @{
	<Router routes={routes} root={Shell} />
}

function click(selector: string, init: MouseEventInit = {}) {
	const link = container.querySelector(selector) as HTMLAnchorElement;

	link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

	flushSync();
}

describe('client routing', () => {
	it('renders the route for the current url', () => {
		window.history.replaceState(null, '', '/about');

		render_into_dom(App);
		flushSync();

		expect(container.querySelector('h1')?.textContent).toBe('About');
	});

	it('navigates when a link is clicked', () => {
		render_into_dom(App);
		flushSync();

		expect(container.querySelector('h1')?.textContent).toBe('Home');

		click('a[href="/about"]');

		expect(window.location.pathname).toBe('/about');
		expect(container.querySelector('h1')?.textContent).toBe('About');
	});

	it('renders the page inside the root layout', () => {
		render_into_dom(App);
		flushSync();

		expect(container.querySelector('main > h1')?.textContent).toBe('Home');
	});

	it('responds to back and forward navigation', async () => {
		render_into_dom(App);
		flushSync();

		click('a[href="/about"]');
		expect(container.querySelector('h1')?.textContent).toBe('About');

		window.history.back();

		await vi.waitFor(() => {
			flushSync();
			expect(container.querySelector('h1')?.textContent).toBe('Home');
		});
	});

	it('navigates programmatically, with search params', () => {
		render_into_dom(App);
		flushSync();

		navigateTo('/users/9', { searchParams: { tab: 'x' } });
		flushSync();

		expect(container.querySelector('h1')?.textContent).toBe('User 9');
		expect(window.location.search).toBe('?tab=x');
	});

	it('leaves external links and modified clicks to the browser', () => {
		render_into_dom(App);
		flushSync();

		const external = container.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
		const event = new MouseEvent('click', { bubbles: true, cancelable: true });

		external.dispatchEvent(event);
		flushSync();
		expect(event.defaultPrevented).toBe(false);

		click('a[href="/about"]', { metaKey: true });
		expect(window.location.pathname).toBe('/');
	});

	it('tracks the active link', () => {
		render_into_dom(App);
		flushSync();

		expect(container.querySelector('a[href="/"]')?.getAttribute('class')).toBe('active');

		click('a[href="/about"]');

		expect(container.querySelector('a[href="/"]')?.getAttribute('class')).toBeNull();
		expect(container.querySelector('a[href="/about"]')?.getAttribute('class')).toBe('active');
	});

	it('redirects with <Redirect>', () => {
		function Legacy() @{
			<Redirect to="/about" />
		}

		function RedirectApp() @{
			<Router routes={[...routes, { path: '/old', element: Legacy }]} />
		}

		window.history.replaceState(null, '', '/old');

		render_into_dom(RedirectApp);
		flushSync();

		expect(window.location.pathname).toBe('/about');
		expect(container.querySelector('h1')?.textContent).toBe('About');
	});

	it('resolves links and routes against a base path', () => {
		function BaseApp() @{
			<Router base="/app" routes={routes} root={Shell} />
		}

		window.history.replaceState(null, '', '/app');

		render_into_dom(BaseApp);
		flushSync();

		expect(container.querySelector('h1')?.textContent).toBe('Home');
		expect(container.querySelector('a[href="/app/about"]')).not.toBeNull();

		click('a[href="/app/about"]');

		expect(window.location.pathname).toBe('/app/about');
		expect(container.querySelector('h1')?.textContent).toBe('About');
	});

	it('ignores history with the static prop', () => {
		function StaticApp() @{
			<Router url="/about" routes={routes} static />
		}

		window.history.replaceState(null, '', '/');

		render_into_dom(StaticApp);
		flushSync();

		expect(container.querySelector('h1')?.textContent).toBe('About');
	});

	it('re-renders the page when only params change', () => {
		render_into_dom(App);
		flushSync();

		navigateTo('/users/1');
		flushSync();
		expect(container.querySelector('h1')?.textContent).toBe('User 1');

		navigateTo('/users/2');
		flushSync();
		expect(container.querySelector('h1')?.textContent).toBe('User 2');
	});

	it('keeps a route interactive after navigating to it', () => {
		function Counter() @{
			let count = track(0);
			<button onClick={() => count.value++}>{count.value}</button>
		}

		function CounterApp() @{
			<Router routes={[...routes, { path: '/count', element: Counter }]} root={Shell} />
		}

		render_into_dom(CounterApp);
		flushSync();

		navigateTo('/count');
		flushSync();

		const button = container.querySelector('button') as HTMLButtonElement;
		button.click();
		flushSync();

		expect(button.textContent).toBe('1');
	});
});
