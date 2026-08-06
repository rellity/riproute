export const SYMBOLS = {
	CATCH_ALL: '**',
} as const;

/**
 * Key used to hand the fully-qualified request location to `<Router>` during
 * SSR. The `routerLocation()` middleware exported from `ripple-router/server`
 * writes it onto the render route's `params`, and `<Router params={...}>`
 * reads it back out.
 */
export const LOCATION_PARAM = '__ripple_router_location';

/**
 * Name of the splat param used by the catch-all render route created by
 * `createRouterRoutes()`.
 */
export const SPLAT_PARAM = '__ripple_router_rest';

/**
 * The endpoint server-function calls go through.
 *
 * This is the wire protocol: the client stub here, the server dispatch and the
 * dev middleware all have to agree on it. It lives in this package because
 * this is the lowest one all three can reach — the built packages inline it at
 * build time, and the source-shipped ones import it as ordinary source.
 */
export const SERVER_FN_PREFIX = '/__riproute/serverfn/';
