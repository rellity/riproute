/**
 * HTML template handling for the SSR handler.
 *
 * riproute never hands the document to Vite's HTML pipeline — `appType` is
 * `'custom'`, so `index.html` is a template we own and fill in ourselves. That
 * is deliberate: it is the same decision that lets the dev middleware install
 * *after* Vite's own, which is what keeps `/@vite/client` from being swallowed
 * by a root catch-all route.
 */

export const HEAD_MARKER = '<!--riproute-head-->';
export const BODY_MARKER = '<!--riproute-body-->';

export type PageTemplate = {
	/** Everything before the head content. */
	before: string;
	/** Between the head content and the body content. */
	between: string;
	/** Everything after the body content. */
	after: string;
};

const ROOT_OPEN = /<div\b[^>]*\bid=["']?root["']?[^>]*>/i;

/**
 * Splits a document into the three pieces the renderer fills.
 *
 * Explicit markers win. Without them the head content goes just before
 * `</head>` and the body content into `<div id="root">`, so a plain Vite
 * `index.html` works untouched.
 */
export function splitTemplate(html: string, rootId = 'root'): PageTemplate {
	const headIndex = html.indexOf(HEAD_MARKER);
	const bodyIndex = html.indexOf(BODY_MARKER);

	if (headIndex !== -1 && bodyIndex !== -1 && headIndex < bodyIndex) {
		return {
			before: html.slice(0, headIndex),
			between: html.slice(headIndex + HEAD_MARKER.length, bodyIndex),
			after: html.slice(bodyIndex + BODY_MARKER.length),
		};
	}

	const headSplit = splitAt(html, /<\/head\s*>/i, 'before');

	if (headSplit === null) {
		throw new Error('[riproute] The HTML template needs a <head> element.');
	}

	const rootPattern =
		rootId === 'root'
			? ROOT_OPEN
			: new RegExp(`<div\\b[^>]*\\bid=["']?${escapeRegExp(rootId)}["']?[^>]*>`, 'i');
	const bodySplit = splitAt(headSplit[1], rootPattern, 'after');

	if (bodySplit === null) {
		throw new Error(
			`[riproute] The HTML template needs a mount point: <div id="${rootId}"></div>, ` +
				`or a ${BODY_MARKER} marker.`
		);
	}

	return { before: headSplit[0], between: bodySplit[0], after: bodySplit[1] };
}

/**
 * Splits `input` around the first match of `pattern`, keeping the matched text
 * on the requested side.
 */
function splitAt(
	input: string,
	pattern: RegExp,
	keep: 'before' | 'after'
): [string, string] | null {
	const match = pattern.exec(input);

	if (match === null) return null;

	const start = match.index;
	const end = start + match[0].length;

	return keep === 'before'
		? [input.slice(0, start), input.slice(start)]
		: [input.slice(0, end), input.slice(end)];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Assembles the final document. */
export function fillTemplate(template: PageTemplate, head: string, body: string): string {
	return template.before + head + template.between + body + template.after;
}

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}
