import { Context } from 'ripple';
import type { RouterState } from '../types/index';

/**
 * Router context.
 *
 * The default is `undefined` on purpose: a shared mutable default would be
 * reused across every SSR request in the same process, leaking one request's
 * routes into the next. `<Router>` always installs a fresh state.
 */
export const RouterContext = new Context<RouterState | undefined>(undefined);

/**
 * Reads the enclosing router state, throwing a helpful error when the calling
 * component is not rendered inside a `<Router>`.
 */
export function requireRouter(caller: string): RouterState {
	const router = RouterContext.get();

	if (router === undefined) {
		throw new Error(`[riproute] ${caller} must be rendered inside a <Router>.`);
	}

	return router;
}
