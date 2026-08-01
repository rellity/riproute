import { parse } from 'ripple/compiler';
import type { Plugin } from 'vite';

import { isRiprouteSource } from './package-root';

/**
 * Rewrites literal `<title>` elements into title claims.
 *
 * riproute renders exactly one `<title>`, from router state, so a `<title>`
 * written inside a route is a *claim* on that element rather than markup of its
 * own. This transform turns
 *
 * ```tsrx
 * <title append>{'home | &title'}</title>
 * ```
 *
 * into `<RiprouteTitle text={'home | &title'} append />`, which calls
 * `router.setTitle()` and renders nothing but an inert anchor.
 *
 * Every literal `<title>` is rewritten, not just the ones carrying a keyword —
 * `replace` is the default, so `<title>{'docs'}</title>` is a claim too, and
 * leaving it as raw markup would put a second `<title>` in the document.
 *
 * `<svg><title>` is exempt: that one is an accessibility label, not a document
 * title. So is riproute's own source, which has no business rewriting itself.
 */

const IMPORTED_NAME = 'Title';
const LOCAL_NAME = 'RiprouteTitle';

/** Nodes whose contents are never source we want to walk into. */
const SKIPPED_KEYS = new Set([
	'loc',
	'parent',
	'metadata',
	'range',
	'leadingComments',
	'trailingComments',
]);

type Node = Record<string, any>;

const TSRX = /\.tsrx(\?|$)/;

/**
 * Runs the rewrite ahead of the Ripple compiler.
 *
 * `enforce: 'pre'` is what guarantees the ordering: `@ripple-ts/vite-plugin`
 * compiles `.tsrx` from a plugin with no `enforce`, so every `pre` plugin —
 * including this one — has already had its turn on the source.
 */
export function titleRewritePlugin(): Plugin {
	return {
		name: 'riproute:title',
		enforce: 'pre',

		async transform(code, id) {
			const file = id.split('?')[0];

			if (!TSRX.test(id) || isRiprouteSource(file)) return null;

			const rewritten = await rewriteTitles(code, file);

			// Line numbers are preserved by construction, so the compiler's own
			// map still lines up and there is nothing to emit here.
			return rewritten === code ? null : { code: rewritten, map: null };
		},
	};
}

export async function rewriteTitles(source: string, filename: string): Promise<string> {
	// Cheap gate: `parse()` is not free, and almost no file has a <title>.
	if (!source.includes('<title')) return source;

	const ast = (await parse(source, filename)) as Node;
	const elements = collectTitles(ast);

	if (elements.length === 0) return source;

	const local = uniqueLocalName(source);

	// Back to front, so the offsets of the elements still to come stay valid.
	let output = source;

	for (const element of elements.sort((a, b) => b.start - a.start)) {
		const original = source.slice(element.start, element.end);
		const replacement = buildElement(source, element, local, filename);

		// Titles are often written across several lines. Pad the replacement
		// back out so every line below keeps its number and the source map the
		// Ripple compiler produces still points at the right place.
		const padding = '\n'.repeat(countNewlines(original) - countNewlines(replacement));

		output = output.slice(0, element.start) + replacement + padding + output.slice(element.end);
	}

	// No trailing newline: prepending a whole line would shift every line below
	// it, which is exactly what the padding above is there to avoid.
	return `import { ${IMPORTED_NAME} as ${local} } from 'riproute';${output}`;
}

/** Finds every `<title>` that is not inside an `<svg>`. */
function collectTitles(root: Node): Node[] {
	const found: Node[] = [];
	const seen = new WeakSet<Node>();

	const walk = (node: unknown, inSvg: boolean): void => {
		if (node === null || typeof node !== 'object') return;

		if (Array.isArray(node)) {
			for (const item of node) walk(item, inSvg);
			return;
		}

		const current = node as Node;

		if (seen.has(current)) return;

		seen.add(current);

		if (current.type === 'JSXElement') {
			const name = elementName(current);

			if (name === 'svg') inSvg = true;
			else if (name === 'title' && !inSvg) found.push(current);
		}

		for (const key of Object.keys(current)) {
			if (SKIPPED_KEYS.has(key)) continue;

			walk(current[key], inSvg);
		}
	};

	walk(root, false);

	return found;
}

function elementName(element: Node): string | null {
	const name = element.openingElement?.name;

	return name?.type === 'JSXIdentifier' ? (name.name as string) : null;
}

/**
 * Picks an import name that cannot collide with anything already in the file.
 *
 * A plain substring test is deliberate: it catches the identifier wherever it
 * appears, including in a string or a comment. Being wrong here costs one
 * unnecessary suffix; being right costs a mystery redeclaration error.
 */
function uniqueLocalName(source: string): string {
	if (!source.includes(LOCAL_NAME)) return LOCAL_NAME;

	let suffix = 1;

	while (source.includes(`${LOCAL_NAME}${suffix}`)) suffix++;

	return `${LOCAL_NAME}${suffix}`;
}

function buildElement(source: string, element: Node, local: string, filename: string): string {
	const text = buildText(source, element, filename);

	// Attributes pass through as written, so `append`, `replace`, `separator`
	// in either spelling, and anything added later all keep working.
	const attributes = (element.openingElement.attributes as Node[])
		.map((attribute) => source.slice(attribute.start, attribute.end))
		.join(' ');

	return `<${local} text={${text}}${attributes === '' ? '' : ` ${attributes}`} />`;
}

/** Turns the element's children into a single string expression. */
function buildText(source: string, element: Node, filename: string): string {
	const children = (element.children as Node[]).filter(isContent);

	const empty = (): never => {
		throw new Error(
			`[riproute] ${filename}:${element.loc?.start?.line ?? '?'} — <title> needs content. ` +
				`Write <title>{'Page name'}</title>.`
		);
	};

	if (children.length === 0) empty();

	if (children.length === 1) {
		const only = children[0];

		if (only.type !== 'JSXText')
			return source.slice(only.expression.start, only.expression.end);

		const text = normalizeText(only.value as string);

		// `<title>   </title>` survives the whitespace rule as a single space and
		// would quietly claim nothing at all.
		return text === '' ? empty() : JSON.stringify(text);
	}

	// Mixed text and expressions — a template literal is the one form that
	// joins them without inventing precedence. Interior whitespace is collapsed
	// but not trimmed: the space in `User {id} — profile` is content, and only
	// the padding at the very ends of the element is decoration.
	const parts = children.map((child, index) =>
		child.type === 'JSXText'
			? escapeTemplate(
					collapse(child.value as string, index === 0, index === children.length - 1)
				)
			: `\${${source.slice(child.expression.start, child.expression.end)}}`
	);

	return `\`${parts.join('')}\``;
}

/**
 * Whether a child carries content, by JSX's own whitespace rule.
 *
 * Whitespace that spans a line break is indentation and disappears; whitespace
 * within a line is a real space. So the gap in `User {id} — profile` survives,
 * while the newline and tabs around a `{'…'}` on its own line do not.
 */
function isContent(child: Node): boolean {
	if (child.type === 'JSXText') {
		const value = child.value as string;

		return value.trim() !== '' || !value.includes('\n');
	}

	if (child.type !== 'JSXExpressionContainer') return false;

	return child.expression?.type !== 'JSXEmptyExpression';
}

/** JSX collapses runs of whitespace, including the newlines around indentation. */
function normalizeText(value: string): string {
	return collapse(value, true, true);
}

function collapse(value: string, trimStart: boolean, trimEnd: boolean): string {
	let next = value.replace(/\s+/g, ' ');

	if (trimStart) next = next.replace(/^ /, '');
	if (trimEnd) next = next.replace(/ $/, '');

	return next;
}

/**
 * Escapes text for a template literal.
 *
 * Only backslashes and backticks need it. `${` cannot occur in a single text
 * part — JSX would have read the `{` as an expression container — so a `$`
 * ending a text part is genuinely a literal `$` sitting before an
 * interpolation, which is what a template literal already means.
 */
function escapeTemplate(value: string): string {
	return value.replace(/[\\`]/g, '\\$&');
}

function countNewlines(value: string): number {
	let count = 0;

	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) === 10) count++;
	}

	return count;
}
