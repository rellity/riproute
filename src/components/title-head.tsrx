import { requireRouter } from '../contexts/router-context';

/**
 * Emits the single `<title>` element during SSR.
 *
 * The `@if` must live *inside* the `<head>` block: Ripple defers a head block's
 * contents until the rest of the render has finished, which is what lets a
 * title set deeper in the tree land here. A conditional wrapped around the
 * block would be evaluated too early to see it.
 */
export function TitleHead() @{
	const router = requireRouter('<Router>');

	<head>
		@if (router.title.value !== undefined) {
			<title>{router.title.value}</title>
		}
	</head>
}
