import type { Tracked } from 'ripple';

import { requireRouter } from '../contexts/router-context';
import type { NavigateOptions, RouteMatch, RouterLocation, RouterState } from '../types/index';

/**
 * Reads the enclosing router.
 *
 * Like every context read in Ripple, these must be called during a component's
 * setup — not inside an event handler or an effect callback.
 */
export function useRouter(): RouterState {
	return requireRouter('useRouter()');
}

/** The current location, as a tracked value. */
export function useLocation(): Tracked<RouterLocation> {
	return requireRouter('useLocation()').location;
}

/** Params of the currently matched route, as a tracked value. */
export function useParams(): Tracked<Record<string, string>> {
	return requireRouter('useParams()').params;
}

/** The current query string, parsed, as a tracked value. */
export function useSearchParams(): Tracked<URLSearchParams> {
	return requireRouter('useSearchParams()').searchParams;
}

/** The current route match, as a tracked value. */
export function useMatch(): Tracked<RouteMatch | null> {
	return requireRouter('useMatch()').match;
}

/**
 * A navigate function bound to the enclosing router, so paths are resolved
 * against its base.
 */
export function useNavigate(): (to: string, options?: NavigateOptions) => void {
	return requireRouter('useNavigate()').navigate;
}
