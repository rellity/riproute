export { Router } from './components/router.tsrx';
export { createRouterApp } from './create-router-app.tsrx';
export { Outlet } from './components/outlet.tsrx';
export { Link } from './components/link.tsrx';
export { Redirect } from './components/redirect.tsrx';
export { NotFound } from './components/not-found.tsrx';
export { Title } from './components/title.tsrx';

export { default as navigateTo } from './utils/navigate-to';
export { defineRoutes } from './utils/define-routes';

export { RouterContext, requireRouter } from './contexts/router-context';

export {
	useLocation,
	useMatch,
	useNavigate,
	useParams,
	useRouter,
	useSearchParams,
} from './hooks/index';
export { useMutateFn, useQueryFn } from './hooks/use-fn';
export type {
	FnCallbacks,
	FnData,
	UseMutateFnOptions,
	UseMutateFnResult,
	UseQueryFnOptions,
	UseQueryFnResult,
} from './hooks/use-fn';

export { LOCATION_PARAM, SERVER_FN_PREFIX, SPLAT_PARAM, SYMBOLS } from './constants';
export { IS_BROWSER } from './env';
export { createServerFnStub } from './server-fn-client';

// Routing primitives — pure, and safe to import on the server.
export {
	compileRoutePath,
	isPathActive,
	matchCompiledRoutePath,
	matchRoutes,
	normalizeRoutePath,
} from './utils/match-routes';
export type { CompiledRoutePath } from './utils/match-routes';
export {
	buildHref,
	isExternalUrl,
	isSafeHref,
	normalizeBase,
	normalizePathname,
	parseLocation,
	stripBase,
	withBase,
} from './utils/location';
export { notifyLocationChange, readBrowserLocation, subscribeToLocation } from './utils/history';
export { DEFAULT_TITLE_SEPARATOR, TITLE_TOKEN, resolveTitle } from './utils/title';

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
} from './types/index';
export type { ExtractPathParams } from './types/route';
export type { PathFragment } from './types/internal';
