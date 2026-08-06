import { IS_BROWSER } from '../env';
import type { NavigateOptions } from '../types/index';
import { applyHistoryChange, notifyLocationChange } from './history';
import { buildHref } from './location';

let warned = false;

/**
 * Navigates to a path.
 *
 * Safe to call during SSR, where it is a no-op: there is no history stack to
 * push onto. Server-side redirects belong in a route middleware — see
 * `redirect()` in `ripple-router/server`.
 *
 * @param path - The path to navigate to.
 * @param options - The options to navigate with.
 * @param options.replace - Replace the current history entry instead of pushing.
 * @param options.searchParams - Search params to navigate with.
 * @param options.hash - Hash to navigate with.
 * @param options.state - History state to associate with the entry.
 * @param options.scroll - Scroll after navigating (default `true`).
 */
export default function navigateTo(path: string, options: NavigateOptions = {}): void {
	if (!IS_BROWSER) {
		if (!warned) {
			warned = true;
			console.warn(
				'[ripple-router] navigateTo() was called during SSR and ignored. ' +
					'Use a redirect response from a server route or middleware instead.'
			);
		}
		return;
	}

	const href = buildHref(path, options);

	applyHistoryChange(href, options);
	notifyLocationChange();

	if (options.scroll === false) return;

	const hash_index = href.indexOf('#');

	if (hash_index !== -1 && hash_index < href.length - 1) {
		const target = document.getElementById(decodeURIComponent(href.slice(hash_index + 1)));

		if (target) {
			target.scrollIntoView();
			return;
		}
	}

	window.scrollTo(0, 0);
}
