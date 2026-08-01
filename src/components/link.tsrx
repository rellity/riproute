import { track } from 'ripple';

import { RouterContext } from '../contexts/router-context';
import type { LinkProps } from '../types/index';
import { isExternalUrl, withBase } from '../utils/location';
import { isPathActive } from '../utils/match-routes';
import navigateTo from '../utils/navigate-to';
import { parseLocation } from '../utils/location';

/**
 * Link component. Renders an `<a>`, forwarding every extra prop to it, and
 * intercepts plain left-clicks for client-side navigation.
 *
 * Modified clicks (ctrl/cmd/shift/alt), non-primary buttons, `target`,
 * `download` and external URLs all fall through to the browser.
 *
 * @param props.href - Target path or absolute URL.
 * @param props.replace - Replace the current history entry.
 * @param props.state - History state to associate with the entry.
 * @param props.scroll - Scroll after navigating. Defaults to `true`.
 * @param props.activeClass - Class appended while the link is active.
 * @param props.exact - Only mark the link active on an exact pathname match.
 */
export function Link({
	children,
	href,
	replace,
	state,
	scroll,
	activeClass,
	exact,
	onClick,
	// Taken out of `rest` on purpose. Left in, `class` would appear both in the
	// spread and in the explicit attribute below, and Ripple's server runtime
	// writes both — a duplicate attribute in the SSR markup.
	class: classProp,
	...rest
}: LinkProps) @{
	// May be `undefined`: a `<Link>` outside a `<Router>` still renders a
	// perfectly good anchor, it just cannot be "active" or use a base path.
	const router = RouterContext.get();
	const external = isExternalUrl(href);
	const target = external ? href : withBase(href, router?.base ?? '');

	const active = track(() => {
		if (external || router === undefined || activeClass === undefined) return false;

		return isPathActive(
			router.location.value.pathname,
			parseLocation(target).pathname,
			exact === true
		);
	});

	const className = track(() => {
		if (!active.value) return classProp;

		return classProp ? `${classProp} ${activeClass}` : activeClass;
	});

	const handleClick = (event: MouseEvent) => {
		onClick?.(event);

		if (event.defaultPrevented) return;
		if (external) return;
		// Only plain left-clicks: everything else means "open somewhere else".
		if (event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (rest.target !== undefined && rest.target !== null && rest.target !== '_self') return;
		if (rest.download !== undefined && rest.download !== false) return;

		event.preventDefault();

		navigateTo(target, { replace, state, scroll });
	};

	<a
		{...rest}
		href={target}
		class={className.value}
		aria-current={active.value ? 'page' : undefined}
		onClick={handleClick}
	>
		{children}
	</a>
}
