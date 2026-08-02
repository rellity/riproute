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
 * The URL prefix server-function calls go through.
 *
 * Each function gets its own endpoint — `/__riproute/serverfn/<hash>` — with
 * the hash derived from the function's file and export name at build time.
 * Distinct URLs keep calls tellable-apart in the network tab, and the hash
 * keeps the app's file layout out of the client bundle.
 */
export const SERVER_FN_PREFIX = '/__riproute/serverfn/';
