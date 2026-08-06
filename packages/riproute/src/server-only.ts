/**
 * Marks the importing module as server-only.
 *
 * ```ts
 * import '@riproute/riproute/server-only';
 *
 * export const db = connect(process.env.DATABASE_URL);
 * ```
 *
 * The marker is transitive, which is the point: anything that imports a marked
 * module drags this import into the same graph. If that graph is the browser
 * bundle, riproute's Vite plugin fails the build and prints the chain that got
 * there — so a route accidentally importing a database client is caught at
 * build time rather than shipped.
 *
 * The throw below is the backstop for what static analysis cannot see: a
 * dynamic `import()`, or a bundler other than Vite. Reaching it means the guard
 * was bypassed, not that it failed.
 *
 * Named after the `server-only` package the React ecosystem settled on, and it
 * works the same way — but with a real error message instead of a resolution
 * failure.
 */
import { IS_BROWSER } from './env';

if (IS_BROWSER) {
	throw new Error(
		'[riproute] A module marked with `import "@riproute/riproute/server-only"` was evaluated ' +
			'in the browser. Something imported it into client code — split the ' +
			'browser-safe part into its own module, or load the data on the server and ' +
			'pass it to the route as props.'
	);
}
