import { effect } from 'ripple';

import { requireRouter } from '../contexts/router-context';
import type { RedirectProps } from '../types/index';

/**
 * Redirect component. Navigates to `to` once it is rendered.
 *
 * This is a client-side redirect — Ripple's server runtime does not run
 * effects, so nothing happens during SSR. Use `redirect()` from
 * `ripple-router/server` in a middleware to redirect before rendering.
 *
 * @param props.to - Path to redirect to.
 * @param props.replace - Replace the current history entry. Defaults to `true`.
 */
export function Redirect(props: RedirectProps) @{
	const router = requireRouter('<Redirect>');

	effect(() => {
		router.navigate(props.to, { replace: props.replace ?? true });
	});

	// See `<Route>`: rendering nothing at all desyncs hydration.
	<template></template>
}
