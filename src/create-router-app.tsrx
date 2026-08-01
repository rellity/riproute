import type { Component } from 'ripple';

import { Router } from './components/router.tsrx';
import type { RouterProps } from './types/index';

/**
 * Wraps `<Router>` in a props-less component.
 *
 * Ripple's `render()` calls the root component with no props at all, so an SSR
 * entry cannot pass the request URL down — it has to close over it. The client
 * entry uses the same helper so both sides render an identical tree; hydration
 * compares structure, and an extra wrapper on one side only would desync it.
 */
export function createRouterApp(props: RouterProps): Component {
	function RouterApp() @{
		<Router
			routes={props.routes}
			root={props.root}
			url={props.url}
			params={props.params}
			base={props.base}
			fallback={props.fallback}
			title={props.title}
			static={props.static}
			onTitle={props.onTitle}
		/>
	}

	return RouterApp;
}
