import type { Component } from 'ripple';
import { track } from 'ripple';

import { SYMBOLS } from '../constants';
import { requireRouter } from '../contexts/router-context';
import { NotFound } from './not-found.tsrx';

/**
 * Renders the route matching the current location.
 *
 * A root layout decides where the page goes by placing this; without a root
 * layout `<Router>` renders it directly.
 *
 * The single-item keyed `@for` looks redundant and is not. Ripple 0.3.118's
 * server runtime emits no hydration markers around a dynamic component —
 * `dynamic_element` writes the component's output and nothing else — while the
 * client's `composite()` expects a comment anchor to insert before. Hydration
 * adopts the SSR markup happily, but leaves that anchor pointing at the first
 * *real* node of the route. The first navigation destroys that node along with
 * the rest of the branch, the insertion point goes with it, and the outlet is
 * silently empty from then on: no error, no warning, no hydration mismatch.
 *
 * A `@for` block does emit markers on both sides, and keying it on the matched
 * component makes a route change destroy the old branch and build a new one
 * between anchors that outlive it. Ripple's own hydration suite covers keyed
 * reordering after hydrate, so this rides on a tested path.
 */
export function Outlet(props: { fallback?: Component }) @{
	const router = requireRouter('<Outlet>');

	const element = track<Component>(() => {
		const matched = router.match.value;

		if (matched !== null) return matched.element;

		return (
			props.fallback ?? router.fallback ?? router.routes.get(SYMBOLS.CATCH_ALL) ?? NotFound
		);
	});

	const params = track(() => router.match.value?.params ?? {});
	const searchParams = track(() => Object.fromEntries(router.searchParams.value.entries()));

	// Keyed on the component: a param-only change (`/users/1` → `/users/2`)
	// keeps the branch and updates props, an actual route change replaces it.
	const matched = track(() => [element.value]);

	@for (const route of matched.value; key route) {
		<{route} params={params.value} searchParams={searchParams.value} />
	}
}
