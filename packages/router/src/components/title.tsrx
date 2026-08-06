import { track, untrack } from 'ripple';

import { requireRouter } from '../contexts/router-context';
import type { TitleProps } from '../types/index';
import { resolveTitle } from '../utils/title';

/**
 * Claims the document title for the route it renders in.
 *
 * Not usually written by hand — author `<title append>{'home | &title'}</title>`
 * in a route and the Vite plugin rewrites it into this.
 *
 * The claim rides on the anchor's *attribute expression*, not `effect()`.
 * That is load-bearing: registering an effect from a hydrated route's body
 * desyncs Ripple 0.3.118's cursor, and the whole layout is silently rendered
 * again beside the markup it should have adopted — reproduced with nothing but
 * an empty effect. An attribute expression re-runs exactly when its
 * dependencies change, which is the same reactivity without creating one.
 * (`setTitle` itself is written to be safe to call mid-render: it touches no
 * tracked state — see the stamp in `router.tsrx`.)
 */
export function Title(props: TitleProps) @{
	const router = requireRouter('<title>');

	// The rewrite passes `text` through as whatever expression the author
	// wrote, so at runtime it can be a number or a nullish lookup. Coerce
	// before `resolveTitle` goes looking for `&title` inside it.
	const resolved = track(() =>
		resolveTitle(String(props.text ?? ''), router.baseTitle, {
			mode: props.append === true && props.replace !== true ? 'append' : 'replace',
			separator: props.separator,
		})
	);

	// The route this title belongs to, captured once. On navigation the
	// outgoing route's expressions re-run against the incoming params before
	// teardown, and must not stamp a stale title — so every claim re-checks
	// ownership at the moment it applies.
	const owner = untrack(() => router.match.value?.element ?? null);

	const claim = (text: string): undefined => {
		if (untrack(() => router.match.value?.element ?? null) === owner) {
			router.setTitle(text);
		}

		return undefined;
	};

	// A component that renders nothing emits no SSR output while the client
	// still expects an anchor node, desyncing hydration. An inert <template>
	// is the cheapest node both sides agree on — and its attribute expression
	// is what keeps the claim live.
	<template data-riproute-title={claim(resolved.value)}></template>
}
