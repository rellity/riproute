import type { NavigateOptions, RouterLocation } from '../types/index';

/**
 * Origin used to parse relative URLs. It never leaks into a `RouterLocation`,
 * which only ever exposes `pathname` / `search` / `hash`.
 */
const PARSE_ORIGIN = 'http://ripple-router.invalid';

/**
 * Normalizes a pathname: guarantees a leading slash, collapses repeated
 * slashes and drops the trailing slash (except for the root).
 */
export function normalizePathname(pathname: string | undefined | null): string {
	if (!pathname) return '/';

	let next = pathname.startsWith('/') ? pathname : `/${pathname}`;

	next = next.replace(/\/{2,}/g, '/');

	if (next.length > 1 && next.endsWith('/')) {
		next = next.slice(0, -1);
	}

	return next;
}

/**
 * Normalizes a base path. `'/'`, `''` and `undefined` all mean "no base".
 */
export function normalizeBase(base: string | undefined | null): string {
	if (!base) return '';

	const normalized = normalizePathname(base);

	return normalized === '/' ? '' : normalized;
}

/**
 * Removes the router base from a pathname. Pathnames outside of the base are
 * returned untouched so they simply fail to match any route.
 */
export function stripBase(pathname: string, base: string): string {
	if (!base) return normalizePathname(pathname);

	const normalized = normalizePathname(pathname);

	if (normalized === base) return '/';

	if (normalized.startsWith(`${base}/`)) {
		return normalizePathname(normalized.slice(base.length));
	}

	return normalized;
}

/**
 * Prefixes a router-relative path with the router base.
 */
export function withBase(path: string, base: string): string {
	if (!base) return path;
	if (isExternalUrl(path)) return path;
	if (path.startsWith(`${base}/`) || path === base) return path;

	const [pathname, rest] = splitPathname(path);

	return `${base}${normalizePathname(pathname)}${rest}`;
}

/**
 * Splits `'/a/b?x=1#y'` into `['/a/b', '?x=1#y']`.
 */
function splitPathname(path: string): [string, string] {
	const index = path.search(/[?#]/);

	return index === -1 ? [path, ''] : [path.slice(0, index), path.slice(index)];
}

export function isExternalUrl(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/**
 * Parses any absolute-or-relative URL into a `RouterLocation`.
 */
export function parseLocation(url: string, state: unknown = null): RouterLocation {
	const parsed = new URL(url || '/', PARSE_ORIGIN);
	const pathname = normalizePathname(parsed.pathname);
	const search = parsed.search;
	const hash = parsed.hash;

	return {
		pathname,
		search,
		hash,
		href: `${pathname}${search}${hash}`,
		state,
	};
}

/**
 * Builds the href a navigation should push onto the history stack.
 */
export function buildHref(path: string, options: NavigateOptions = {}): string {
	const base = parseLocation(path);

	let search = base.search;

	if (options.searchParams !== undefined) {
		const params = new URLSearchParams(options.searchParams as never).toString();
		search = params ? `?${params}` : '';
	}

	let hash = base.hash;

	if (options.hash !== undefined) {
		hash = options.hash
			? options.hash.startsWith('#')
				? options.hash
				: `#${options.hash}`
			: '';
	}

	return `${base.pathname}${search}${hash}`;
}
