import { IS_BROWSER } from '../env';
import type { RouterLocation } from '../types/index';
import { parseLocation } from './location';

type Listener = () => void;

const listeners = new Set<Listener>();

let popstate_attached = false;

function emit(): void {
	// Copy first: a listener may unsubscribe itself while we iterate.
	for (const listener of [...listeners]) listener();
}

/**
 * Subscribes to browser history changes (back/forward plus every navigation
 * performed through `navigateTo`).
 *
 * A single `popstate` listener is shared by every `<Router>` instance.
 *
 * @returns An unsubscribe function.
 */
export function subscribeToLocation(listener: Listener): () => void {
	listeners.add(listener);

	if (IS_BROWSER && !popstate_attached) {
		popstate_attached = true;
		window.addEventListener('popstate', emit);
	}

	return () => {
		listeners.delete(listener);
	};
}

/**
 * Tells every mounted `<Router>` to re-read the current location.
 */
export function notifyLocationChange(): void {
	emit();
}

/**
 * Reads the current browser location. Returns the root location on the server,
 * where it is never used — `<Router>` is given its location explicitly there.
 */
export function readBrowserLocation(): RouterLocation {
	if (!IS_BROWSER) return parseLocation('/');

	const { pathname, search, hash } = window.location;

	return parseLocation(`${pathname}${search}${hash}`, window.history.state);
}

/**
 * Pushes (or replaces) a history entry. No-op outside the browser.
 */
export function applyHistoryChange(
	href: string,
	options: { replace?: boolean; state?: unknown } = {}
): void {
	if (!IS_BROWSER) return;

	const state = options.state ?? null;

	if (options.replace) {
		window.history.replaceState(state, '', href);
	} else {
		window.history.pushState(state, '', href);
	}
}
