import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { componentName, isScaffoldable, scaffoldRoute } from '../../packages/vite/src/scaffold';

const ROUTES = path.resolve('/app/src/routes');
const at = (...parts: string[]) => path.join(ROUTES, ...parts);

describe('componentName', () => {
	it.each([
		['/', 'Home'],
		['/about', 'About'],
		['/posts', 'Posts'],
		['/posts/:id', 'PostsId'],
		['/files/*splat', 'FilesSplat'],
		['/user-settings', 'UserSettings'],
		['/404', 'Page404'],
	])('%s -> %s', (route, name) => {
		expect(componentName(route)).toBe(name);
	});
});

describe('scaffoldRoute', () => {
	it('scaffolds a static route', () => {
		const template = scaffoldRoute(at('about.tsrx'), ROUTES);

		expect(template).toContain('export default function About() @{');
		expect(template).toContain("<title extend>{'about'}</title>");
		expect(template).toContain('<div>');
	});

	it('scaffolds an index route', () => {
		const template = scaffoldRoute(at('index.tsrx'), ROUTES);

		expect(template).toContain('export default function Home() @{');
		expect(template).toContain("{'home'}");
	});

	it('scaffolds a param route with typed props', () => {
		const template = scaffoldRoute(at('posts', '$id.tsrx'), ROUTES);

		expect(template).toContain("RouteComponentProps<'/posts/:id'>");
		expect(template).toContain('props.params.id');
	});

	it('scaffolds a splat route', () => {
		const template = scaffoldRoute(at('docs', '$.tsrx'), ROUTES);

		expect(template).toContain("RouteComponentProps<'/docs/*splat'>");
		expect(template).toContain('props.params.splat');
	});

	it('scaffolds the root with a shell and a layout', () => {
		const template = scaffoldRoute(at('__root.tsrx'), ROUTES);

		expect(template).toContain('export function shell(');
		expect(template).toContain('{props.children}');
		expect(template).toContain('export default function RootLayout() @{');
		expect(template).toContain('<Outlet />');
	});

	it('scaffolds the catch-all', () => {
		const template = scaffoldRoute(at('__not-found.tsrx'), ROUTES);

		expect(template).toContain('export default function NotFound() @{');
		expect(template).toContain("{'404'}");
	});

	it('leaves hidden helpers and non-tsrx files alone', () => {
		expect(scaffoldRoute(at('_helper.tsrx'), ROUTES)).toBeNull();
		expect(scaffoldRoute(at('data.server.ts'), ROUTES)).toBeNull();
		expect(isScaffoldable(at('notes.md'))).toBe(false);
	});

	it('ignores files outside the routes directory', () => {
		expect(scaffoldRoute('/app/src/components/nav.tsrx', ROUTES)).toBeNull();
	});
});
