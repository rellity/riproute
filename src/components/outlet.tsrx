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

	<{element} params={params.value} searchParams={searchParams.value} />
}
