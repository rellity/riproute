import path from 'node:path';

import { filePathToRoutePath } from './route-scan';

/**
 * Route scaffolding, the way TanStack Start does it: create an empty file
 * under the routes directory while the dev server is running, and a working
 * template appears in it — named for its route, typed for its params, ready to
 * edit.
 *
 * Only ever applied to an *empty* file. A populated file arriving in the
 * watcher is someone's real work — a git checkout, a paste, an editor that
 * saved before the watcher fired — and writing over it would be vandalism.
 */

/** Only `.tsrx` files get a component template. */
export function isScaffoldable(file: string): boolean {
	return path.extname(file) === '.tsrx';
}

/**
 * Builds the template for a new route file, or `null` when the file means
 * something no template fits (a `_`-hidden helper).
 */
export function scaffoldRoute(file: string, routesDir: string): string | null {
	if (!isScaffoldable(file)) return null;

	const relative = path.relative(routesDir, file);

	// Outside the routes dir, or reaching back out of it — not a route.
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;

	const base = path.basename(relative, '.tsrx');

	if (base === '__root') return rootTemplate();

	const routePath = filePathToRoutePath(relative);

	if (routePath === null) return null;
	if (routePath === '**') return notFoundTemplate();

	return routeTemplate(routePath);
}

/** `/posts/:id` → `PostsId`; `/` → `Home`. */
export function componentName(routePath: string): string {
	const words = routePath
		.split('/')
		.flatMap((segment) => segment.replace(/^[:*]/, '').split(/[^a-zA-Z0-9]+/))
		.filter((word) => word !== '');

	if (words.length === 0) return 'Home';

	const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');

	// An identifier cannot start with a digit, and a route like `/404` would.
	return /^[0-9]/.test(name) ? `Page${name}` : name;
}

function routeTemplate(routePath: string): string {
	const name = componentName(routePath);
	const params = routePath
		.split('/')
		.filter((segment) => segment.startsWith(':') || segment.startsWith('*'))
		.map((segment) =>
			segment.startsWith('*') ? segment.slice(1) || 'splat' : segment.slice(1)
		);

	const lines: string[] = [];

	if (params.length > 0) {
		lines.push(
			"import type { RouteComponentProps } from '@riproute/router';",
			'',
			`export default function ${name}(props: RouteComponentProps<'${routePath}'>) @{`,
			'\t<div>',
			`\t\t<title extend>{'${humanize(routePath)}'}</title>`,
			'',
			`\t\t<h1>{\`${humanize(routePath)}: \${props.params.${params[0]}}\`}</h1>`,
			'\t</div>',
			'}'
		);
	} else {
		lines.push(
			`export default function ${name}() @{`,
			'\t<div>',
			`\t\t<title extend>{'${humanize(routePath)}'}</title>`,
			'',
			`\t\t<h1>{'${humanize(routePath)}'}</h1>`,
			'\t</div>',
			'}'
		);
	}

	return `${lines.join('\n')}\n`;
}

function rootTemplate(): string {
	return [
		"import type { Children } from 'ripple';",
		"import { Outlet } from '@riproute/router';",
		'',
		'/** The base document. `{props.children}` is where the app goes. */',
		'export function shell(props: { children?: Children }) @{',
		'\t<>',
		'\t\t<head>',
		'\t\t\t<meta charset="utf-8" />',
		'\t\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />',
		"\t\t\t<title>{'My app'}</title>",
		'\t\t</head>',
		'',
		'\t\t<html lang="en">',
		'\t\t\t<body>{props.children}</body>',
		'\t\t</html>',
		'\t</>',
		'}',
		'',
		'/** The layout every route renders inside. */',
		'export default function RootLayout() @{',
		'\t<main>',
		'\t\t<Outlet />',
		'\t</main>',
		'}',
		'',
	].join('\n');
}

function notFoundTemplate(): string {
	return [
		"import { Link, useLocation } from '@riproute/router';",
		'',
		'export default function NotFound() @{',
		'\tconst location = useLocation();',
		'',
		'\t<div>',
		"\t\t<title>{'404 — not found'}</title>",
		'',
		"\t\t<h1>{'404'}</h1>",
		'\t\t<p>{`No route matched ${location.value.pathname}.`}</p>',
		'\t\t<Link href="/">{\'← Home\'}</Link>',
		'\t</div>',
		'}',
		'',
	].join('\n');
}

/** `/posts/:id` → `posts id`; `/` → `home`. */
function humanize(routePath: string): string {
	const words = routePath
		.split('/')
		.map((segment) => segment.replace(/^[:*]/, ''))
		.filter((segment) => segment !== '');

	return words.length === 0 ? 'home' : words.join(' ');
}
