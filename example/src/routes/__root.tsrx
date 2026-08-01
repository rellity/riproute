import { Link, Outlet } from 'riproute';

/**
 * The layout every route renders inside.
 *
 * `__root` is discovered by the plugin and handed to `<Router root={...}>`; it
 * decides where the page goes by placing `<Outlet />`.
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
