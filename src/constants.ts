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
 * One fixed POST path for every function: the body says which function to
 * run, so riproute never has to negotiate URL space with the app's routes.
 */
export const RPC_PATH = '/_riproute/rpc';
