import type { TitleMode } from '../types/index';

/** Token replaced with the router's base title. */
export const TITLE_TOKEN = '&title';

export const DEFAULT_TITLE_SEPARATOR = ' | ';

/**
 * Resolves the document title a `<Title>` asks for.
 *
 * - `&title` anywhere in the text is replaced with the base title.
 * - In `append` mode, a text with no `&title` gets the base title appended
 *   after the separator. `replace` — the default — uses the text as written.
 * - An empty base title collapses cleanly: no dangling separators.
 */
export function resolveTitle(
	text: string,
	base: string,
	options: { mode?: TitleMode; separator?: string } = {}
): string {
	const separator = options.separator ?? DEFAULT_TITLE_SEPARATOR;
	const trimmed_base = base.trim();

	if (text.includes(TITLE_TOKEN)) {
		const substituted = text.split(TITLE_TOKEN).join(trimmed_base);

		// `'Home | &title'` with no base would leave `'Home |'`, so drop the
		// separator that was only there to join the two halves.
		return trimmed_base === '' ? trimSeparator(substituted, separator) : substituted.trim();
	}

	if (options.mode === 'append' && trimmed_base !== '') {
		return `${text.trim()}${separator}${trimmed_base}`;
	}

	return text.trim();
}

function trimSeparator(value: string, separator: string): string {
	const trimmed_separator = separator.trim();
	let next = value.trim();

	if (trimmed_separator === '') return next;

	while (next.endsWith(trimmed_separator)) {
		next = next.slice(0, -trimmed_separator.length).trim();
	}

	while (next.startsWith(trimmed_separator)) {
		next = next.slice(trimmed_separator.length).trim();
	}

	return next;
}
