import { effect, track } from 'ripple';

import { requireRouter } from '../contexts/router-context';
import { IS_BROWSER } from '../env';
import type { TitleProps } from '../types/index';
import { resolveTitle } from '../utils/title';

/**
 * Sets the document title for the route it is rendered in.
 *
 * Not part of the public API — author `<title append>{'home | &title'}</title>`
 * inside a `<head>` block and the Vite plugin rewrites it into this.
 */
export function Title(props: TitleProps) @{
	const router = requireRouter('<title>');

	const resolved = track(() =>
		resolveTitle(props.text, router.baseTitle, {
			mode: props.append === true && props.replace !== true ? 'append' : 'replace',
			separator: props.separator,
		})
	);

	// The route component this title belongs to, captured once.
	const owner = router.match.value?.element ?? null;

	// Effects never run on the server, so SSR needs the claim staked here.
	if (!IS_BROWSER) {
		router.setTitle(resolved.value);
	}

	// Reading `match` makes this re-run on navigation, which is when the guard
	// has to fire: a component on its way out has its deriveds re-evaluated
	// against the incoming route's params, and must not stamp a stale title.
	effect(() => {
		const text = resolved.value;

		if ((router.match.value?.element ?? null) !== owner) return;

		router.setTitle(text);
	});

	// A component that renders nothing emits no SSR output while the client
	// still expects an anchor node, desyncing hydration. An inert <template>
	// is the cheapest node both sides agree on.
	<template></template>
}
