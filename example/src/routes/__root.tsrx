import type { Children } from 'ripple';
import { Link, Outlet } from 'riproute';

/**
 * The base document. `shell` replaces `index.html` — the root route owns the
 * whole page, and `{props.children}` is where the app goes. Server-only; the
 * browser hydrates the content at the slot, never the document around it.
 *
 * Ripple treats `<head>` as its own block and re-parents the contents, so it
 * sits beside `<html>`; riproute reassembles the document. The `<title>` here
 * is the base title `&title` expands to.
 */
export function shell(props: { children?: Children }) @{
	<>
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>{'riproute'}</title>
		</head>

		<html lang="en">
			<body>{props.children}</body>
		</html>
	</>
}

/**
 * The layout every route renders inside; it decides where the page goes by
 * placing `<Outlet />`.
 */
export default function RootLayout() @{
	<div class="app">
		<nav>
			<Link href="/" activeClass="active" exact>{'Home'}</Link>
			<Link href="/about" activeClass="active">{'About'}</Link>
			<Link href="/users/42" activeClass="active">{'User 42'}</Link>
			<Link href="/files/a/b/c" activeClass="active">{'Files'}</Link>
			<Link href="/nope">{'Missing'}</Link>
		</nav>

		<main>
			<Outlet />
		</main>
	</div>
}
