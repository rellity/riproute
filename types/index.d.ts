/**
 * Public type surface for `riproute`.
 *
 * Hand-written because the components live in `.tsrx` files, which TypeScript
 * cannot resolve. Pointing the `types` condition at `src/index.ts` would give
 * every consumer `TS2307: Cannot find module './components/router.tsrx'` and no
 * completions at all. Nothing below names a `.tsrx` module; the runtime entry
 * is still `src/index.ts`, which the Vite plugin compiles.
 *
 * Keep in sync with `src/index.ts`.
 */
import type { Component } from 'ripple';
import type { LinkProps, RedirectProps, RouterProps, TitleProps } from '../src/types/index';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Owns the current location and renders the matched route. Takes no children. */
export declare function Router(props: RouterProps): void;

/**
 * Wraps `<Router>` in a props-less component, which is what Ripple's `render()`
 * needs on the server. Used by both generated entries.
 */
export declare function createRouterApp(props: RouterProps): Component;

/** Renders the route matching the current location. Placed by a root layout. */
export declare function Outlet(props: { fallback?: Component }): void;

/** An `<a>` that intercepts plain left-clicks for client-side navigation. */
export declare function Link(props: LinkProps): void;

/** Navigates to `to` once rendered. Client-side only. */
export declare function Redirect(props: RedirectProps): void;

/** The built-in fallback rendered when nothing matches. */
export declare function NotFound(): void;

/**
 * Claims the document title for the route it renders in.
 *
 * Written as a literal `<title append>{'home | &title'}</title>` in a route —
 * the Vite plugin rewrites that into this. Usable directly if you need to build
 * the text somewhere the rewrite cannot see.
 */
export declare function Title(props: TitleProps): void;

// ---------------------------------------------------------------------------
// Navigation, hooks and primitives
// ---------------------------------------------------------------------------

export { default as navigateTo } from '../src/utils/navigate-to';
export { defineRoutes } from '../src/utils/define-routes';

export { RouterContext, requireRouter } from '../src/contexts/router-context';

export {
	useLocation,
	useMatch,
	useNavigate,
	useParams,
	useRouter,
	useSearchParams,
} from '../src/hooks/index';

export { LOCATION_PARAM, SERVER_FN_PREFIX, SPLAT_PARAM, SYMBOLS } from '../src/constants';
export { IS_BROWSER } from '../src/env';
export { createServerFnStub } from '../src/server-fn-client';

export {
	compileRoutePath,
	isPathActive,
	matchCompiledRoutePath,
	matchRoutes,
	normalizeRoutePath,
} from '../src/utils/match-routes';
export type { CompiledRoutePath } from '../src/utils/match-routes';

export {
	buildHref,
	isExternalUrl,
	normalizeBase,
	normalizePathname,
	parseLocation,
	stripBase,
	withBase,
} from '../src/utils/location';

export {
	notifyLocationChange,
	readBrowserLocation,
	subscribeToLocation,
} from '../src/utils/history';

export { DEFAULT_TITLE_SEPARATOR, TITLE_TOKEN, resolveTitle } from '../src/utils/title';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
	LinkProps,
	NavigateOptions,
	RedirectProps,
	RouteComponentProps,
	RouteDefinition,
	RouteMatch,
	RouteSegment,
	RouterLocation,
	RouterProps,
	RouterState,
	TitleMode,
	TitleProps,
} from '../src/types/index';
export type { ExtractPathParams } from '../src/types/route';
export type { PathFragment } from '../src/types/internal';
