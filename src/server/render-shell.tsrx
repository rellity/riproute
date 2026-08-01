import type { Component } from 'ripple';
import { getCss, render } from 'ripple/server';

import { BODY_MARKER, HEAD_MARKER } from './html';

/**
 * Text the shell's `{props.children}` renders to, replaced with the body
 * marker once the document is assembled. A text sentinel rather than a real
 * element because it needs no cleanup: it *becomes* the marker.
 */
const SLOT = 'riproute-body-slot-e5b2c1';

/**
 * Renders a root route's `shell` export into an HTML document.
 *
 * The shell is the base document — `<head>`, `<html>`, `<body>` — written as a
 * component instead of an `index.html`, the way a TanStack Start root route
 * owns its document. It renders once into a template string, and from there
 * everything downstream treats it exactly like a static `index.html`.
 *
 * The app goes wherever the shell put `{props.children}`. No `id="root"` is
 * needed: riproute owns both sides of the transform, so the slot's position is
 * the mount point, marker-exact.
 *
 * The shell is server-only by construction. The browser hydrates the content
 * at the slot, never the document around it, so the shell can hold whatever
 * only a server can compute.
 */
export async function renderShell(shell: Component): Promise<string> {
	// A local alias, because a lowercase `shell` is not a valid JSX component
	// name — and the slot is passed as a *text* child on purpose: in Ripple
	// 0.3.118 a component child inside `children` renders empty on the server,
	// while a text child comes through.
	const Shell = shell;

	function Document() @{
		<Shell>
			{SLOT}
		</Shell>
	}

	const { head, body, css } = await render(Document as never);

	// The shell becomes a *template* — the app is rendered into it afterwards —
	// so Ripple's hydration markers have no meaning here and would desync the
	// client's cursor if they shipped. The app's own markup keeps its markers.
	const markup = stripMarkers(body).replace(SLOT, BODY_MARKER);

	if (!markup.includes(BODY_MARKER)) {
		throw new Error(
			'[riproute] The root route’s `shell` must render `{props.children}` — that is ' +
				'where the app goes.'
		);
	}

	// Ripple redirects a `<head>` block's output into a separate buffer, so the
	// rendered document has a hole where the head belongs. Put it back, with the
	// head marker so the handler knows where its own head content lands.
	const styles = css.size === 0 ? '' : `<style data-ripple-ssr>${getCss(css)}</style>`;
	const document = insertHead(markup, stripMarkers(head) + styles + HEAD_MARKER);

	return document.startsWith('<!') ? document : `<!doctype html>\n${document}`;
}

function stripMarkers(html: string): string {
	return html.replace(/<!--\[!?-->|<!--\]-->|<!--[0-9a-f]{8}-->/g, '');
}

/** Puts the head content back inside the `<html>` element it came from. */
function insertHead(document: string, head: string): string {
	// An existing `</head>` means the shell wrote a literal head the compiler
	// did not redirect; append to it rather than opening a second one.
	const closing = document.indexOf('</head>');

	if (closing !== -1) return document.slice(0, closing) + head + document.slice(closing);

	const open = /<html\b[^>]*>/i.exec(document);

	if (open === null) {
		throw new Error('[riproute] The root route’s `shell` must render an <html> element.');
	}

	const at = open.index + open[0].length;

	return `${document.slice(0, at)}<head>${head}</head>${document.slice(at)}`;
}
