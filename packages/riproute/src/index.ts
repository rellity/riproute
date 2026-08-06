/**
 * The riproute framework package.
 *
 * Re-exports the client API from `@riproute/router` so an app has one import
 * for routing, and adds the server halves on subpaths: `riproute/server` for
 * the SSR handler and server functions, `riproute/server-only` for the marker.
 */
export * from '@riproute/router';
