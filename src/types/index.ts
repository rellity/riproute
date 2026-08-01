import type { Component, Tracked } from 'ripple';
import type { ExtractPathParams } from './route';

/** A parsed, base-relative location. */
export type RouterLocation = {
	/** Normalized pathname, always with a leading slash and no trailing slash. */
	pathname: string;
	/** Query string including the leading `?`, or an empty string. */
	search: string;
	/** Hash including the leading `#`, or an empty string. */
	hash: string;
	/** `pathname + search + hash`. */
	href: string;
	/** The `history.state` associated with this entry. */
	state: unknown;
};

export type RouteSegment =
	| { type: 'static'; name: string }
	| { type: 'param'; name: string }
	| { type: 'splat'; name: string };

/**
 * A route, as data.
 *
 * riproute has no `<Route>` component. Routes are always a table — generated
 * from `src/routes` by the Vite plugin, or written by hand with
 * `defineRoutes()`. That is not just a style preference: the matched route has
 * to render *before* anything else in `<Router>`, and a `<Route>` child could
 * only register itself after that point. See `Router.tsrx`.
 */
export type RouteDefinition = {
	/** URL pattern: `/about`, `/users/:id`, `/files/*rest` or `**`. */
	path: string;
	/** Component rendered when the pattern matches. */
	element: Component;
};

export type RouteMatch = {
	/** The normalized route pattern that matched. */
	path: string;
	/** The component registered for that pattern. */
	element: Component;
	/** Params extracted from the pathname. */
	params: Record<string, string>;
};

export type NavigateOptions = {
	/** Replace the current history entry instead of pushing a new one. */
	replace?: boolean;
	/** Replaces the query string of the target path. */
	searchParams?: Record<string, string> | URLSearchParams | string;
	/** Replaces the hash of the target path. Leading `#` optional. */
	hash?: string;
	/** History state to associate with the entry. */
	state?: unknown;
	/** Scroll after navigating. Defaults to `true`. */
	scroll?: boolean;
};

/** The value provided by `<Router>` and read by `useRouter()`. */
export type RouterState = {
	/** The router base path, or `''` when the router is mounted at the root. */
	base: string;
	/** The route table, normalized. */
	routes: Map<string, Component>;
	/** Rendered when nothing matches; beats a `'**'` route. */
	fallback?: Component;
	/** The current base-relative location. */
	location: Tracked<RouterLocation>;
	/** The best match for the current location, or `null`. */
	match: Tracked<RouteMatch | null>;
	/** Params of the current match. */
	params: Tracked<Record<string, string>>;
	/** Query string of the current location, parsed. */
	searchParams: Tracked<URLSearchParams>;
	/** The document title, or `undefined` while unmanaged. */
	title: Tracked<string | undefined>;
	/** The title `&title` expands to. */
	baseTitle: string;
	/** Claim the document title for the currently matched route. */
	setTitle: (text: string) => void;
	/** Navigate, applying the router base to `to`. */
	navigate: (to: string, options?: NavigateOptions) => void;
};

export type RouterProps = {
	/** The route table. */
	routes: readonly RouteDefinition[];
	/**
	 * Layout wrapping every route — the `__root` route in file mode. It decides
	 * where the page goes by rendering `<Outlet />`. Without one, the matched
	 * route is rendered directly.
	 */
	root?: Component;
	/**
	 * The location to render. Required during SSR; in the browser
	 * `window.location` takes over once the router mounts.
	 */
	url?: string;
	/** Request params from the SSR handler; the location is recovered from these. */
	params?: Record<string, string>;
	/** Mount the router under a path prefix, e.g. `/app`. */
	base?: string;
	/** Rendered when no route matches. Takes precedence over a `'**'` route. */
	fallback?: Component;
	/** The default document title, and what `&title` expands to. */
	title?: string;
	/** Never read from or write to `window.history`. Useful for tests. */
	static?: boolean;
};

export type RouteComponentProps<T extends string = string> = {
	params: ExtractPathParams<T>;
	searchParams?: Record<string, string>;
};

export type LinkProps = {
	/** Target path or absolute URL. */
	href: string;
	children?: unknown;
	/** Replace the current history entry instead of pushing a new one. */
	replace?: boolean;
	/** History state to associate with the entry. */
	state?: unknown;
	/** Scroll after navigating. Defaults to `true`. */
	scroll?: boolean;
	/** Class appended while the link matches the current location. */
	activeClass?: string;
	/** Only treat the link as active on an exact pathname match. */
	exact?: boolean;
	onClick?: (event: MouseEvent) => void;
} & Record<string, any>;

export type RedirectProps = {
	/** Path to redirect to. */
	to: string;
	/** Replace the current history entry. Defaults to `true`. */
	replace?: boolean;
};

export type TitleMode = 'replace' | 'append';

export type TitleProps = {
	/** The title text. `&title` is replaced with the router's base title. */
	text: string;
	/** Append the base title when `text` contains no `&title`. */
	append?: boolean;
	/** Explicitly request the default (replace) behaviour. */
	replace?: boolean;
	/** Joins text and base title in `append` mode. Defaults to `' | '`. */
	separator?: string;
};
