import type { Component } from 'ripple';
import { effect, track, untrack } from 'ripple';

import { LOCATION_PARAM, SPLAT_PARAM } from '../constants';
import { RouterContext } from '../contexts/router-context';
import { IS_BROWSER } from '../env';
import type { RouteMatch, RouterLocation, RouterProps, RouterState } from '../types/index';
import { readBrowserLocation, subscribeToLocation } from '../utils/history';
import { normalizeBase, parseLocation, stripBase, withBase } from '../utils/location';
import { matchRoutes, normalizeRoutePath } from '../utils/match-routes';
import navigateTo from '../utils/navigate-to';
import { Outlet } from './outlet.tsrx';

/**
 * Works out the location `<Router>` should start from.
 *
 * Precedence: an explicit `url`, then the location the SSR handler put on
 * `params`, then `window.location`, then `/`.
 */
function resolveInitialLocation(props: RouterProps): RouterLocation {
	if (props.url !== undefined) return parseLocation(props.url);

	const params = props.params;

	if (params !== undefined) {
		const location = params[LOCATION_PARAM];

		if (typeof location === 'string' && location !== '') return parseLocation(location);

		const splat = params[SPLAT_PARAM];

		if (typeof splat === 'string') return parseLocation(`/${splat}`);
	}

	if (IS_BROWSER) return readBrowserLocation();

	return parseLocation('/');
}

/**
 * Router component.
 *
 * Renders exactly one thing: the root layout if there is one, otherwise the
 * matched route. It takes no children.
 *
 * That is a hydration requirement, not a style choice. In Ripple 0.3.118 a
 * component that renders a dynamic expression *after* `{children}` in a
 * fragment desyncs the hydration cursor, and the whole tree silently falls back
 * to a full client mount. Reproduced with no router code at all: `<>{children}
 * <Thing value={x} /></>` fails, `<><Thing value={x} />{children}</>` does not.
 * Since the matched route is exactly such a dynamic block, there is nothing for
 * it to follow — and routes come from a table rather than `<Route>` children,
 * so nothing needs to register before it renders.
 *
 * Put your layout in the root route and let it place `<Outlet />`.
 */
export function Router(props: RouterProps) @{
	const base = normalizeBase(props.base);
	const is_static = props.static === true;

	const routes = new Map<string, Component>();

	for (const route of props.routes) {
		routes.set(normalizeRoutePath(route.path), route.element);
	}

	let location = track<RouterLocation>(resolveInitialLocation(props));

	// Derived, not an effect: Ripple's server runtime makes `effect` a no-op, so
	// matching has to happen during render for SSR to produce real markup.
	const match = track(() => matchRoutes(routes, stripBase(location.value.pathname, base)));
	const params = track(() => match.value?.params ?? {});
	const searchParams = track(() => new URLSearchParams(location.value.search));

	// A title claim is stamped with the match it was made for. Ripple drops
	// writes to tracked state during teardown, so an outgoing route cannot
	// release the title on its way out — instead the stamp stops applying the
	// moment `match` produces a new object.
	let titleEntry = track<{ match: RouteMatch | null; text: string } | null>(null);

	const title = track<string | undefined>(() => {
		const entry = titleEntry.value;

		return entry !== null && entry.match === match.value ? entry.text : props.title;
	});

	const baseTitle = props.title ?? (IS_BROWSER ? document.title : '');

	const state: RouterState = {
		base,
		routes,
		fallback: props.fallback,
		location,
		match,
		params,
		searchParams,
		title,
		baseTitle,
		setTitle(text) {
			untrack(() => {
				titleEntry.value = { match: match.value, text };
			});

			// The server has no second chance: effects never run, and Ripple's
			// `<head>` block only defers when it sits in the component passed to
			// `render()` — one level up from here, where the router state does
			// not exist yet. So the title is handed straight to the SSR handler,
			// which owns the document and writes the single <title> itself.
			props.onTitle?.(text);
		},
		navigate(to, options) {
			navigateTo(withBase(to, base), options);
		},
	};

	RouterContext.set(state);

	// A route that claims nothing still gets the base title.
	props.onTitle?.(props.title);

	// In the browser the title is assigned rather than rendered: `document.title`
	// updates whichever <title> the document already has, so there is never a
	// second one and nothing to reconcile against the server's.
	effect(() => {
		const next = title.value;

		if (next !== undefined) document.title = next;
	});

	if (!is_static) {
		effect(() => {
			const sync = () => {
				const next = readBrowserLocation();

				untrack(() => {
					if (next.href !== location.value.href) location.value = next;
				});
			};

			// The URL can differ from the one that was server-rendered (a
			// redirect, a hash the browser kept), so re-sync on mount.
			sync();

			return subscribeToLocation(sync);
		});
	}

	const shell = track<Component>(() => props.root ?? Outlet);

	<{shell} />
}
