import type { Component } from 'ripple';
import { SYMBOLS } from '../constants';
import type { RouteMatch, RouteSegment } from '../types/index';
import { normalizePathname } from './location';

const WEIGHT_STATIC = 3;
const WEIGHT_PARAM = 2;
const WEIGHT_SPLAT = 1;

export type CompiledRoutePath = {
	/** The normalized route pattern. */
	path: string;
	segments: RouteSegment[];
	/**
	 * Higher wins. Earlier segments dominate later ones, so `/users/new`
	 * outranks `/users/:id`, which in turn outranks `/users/*rest`.
	 */
	score: number;
};

/**
 * Normalizes a route pattern. The catch-all sentinel (`'**'`) is left as-is so
 * it can keep acting as the "no route matched" fallback.
 */
export function normalizeRoutePath(path: string): string {
	return path === SYMBOLS.CATCH_ALL ? path : normalizePathname(path);
}

/**
 * Compiles a route pattern into segments plus a specificity score.
 *
 * Supported syntax:
 * - static segments — `/about`
 * - named params — `/users/:id`
 * - splats — `/files/*` or `/files/*rest` (matches the remainder, possibly empty)
 */
export function compileRoutePath(path: string): CompiledRoutePath {
	const normalized = normalizeRoutePath(path);
	const raw = normalized === '/' ? [] : normalized.slice(1).split('/');
	const segments: RouteSegment[] = [];

	let score = 1;

	for (const value of raw) {
		if (value.startsWith(':')) {
			segments.push({ type: 'param', name: value.slice(1) });
			score = score * 4 + WEIGHT_PARAM;
		} else if (value.startsWith('*')) {
			segments.push({ type: 'splat', name: value.slice(1) || '*' });
			score = score * 4 + WEIGHT_SPLAT;
		} else {
			segments.push({ type: 'static', name: value });
			score = score * 4 + WEIGHT_STATIC;
		}
	}

	return { path: normalized, segments, score };
}

/**
 * Matches a compiled pattern against a pathname.
 *
 * @returns The extracted params, or `null` when the pattern does not match.
 */
export function matchCompiledRoutePath(
	route: CompiledRoutePath,
	pathname: string
): Record<string, string> | null {
	const normalized = normalizePathname(pathname);
	const parts = normalized === '/' ? [] : normalized.slice(1).split('/');
	const params: Record<string, string> = {};
	const { segments } = route;

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];

		if (segment.type === 'splat') {
			// A splat only makes sense as the final segment; anything after it
			// can never be reached, so treat the pattern as non-matching.
			if (i !== segments.length - 1) return null;

			params[segment.name] = parts
				.slice(i)
				.map((part) => safeDecode(part))
				.join('/');

			return params;
		}

		const part = parts[i];

		if (part === undefined) return null;

		if (segment.type === 'param') {
			params[segment.name] = safeDecode(part);
			continue;
		}

		if (segment.name !== part) return null;
	}

	return parts.length === segments.length ? params : null;
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * Finds the most specific route for a pathname.
 *
 * The catch-all sentinel (`'**'`) is never returned here — `<Renderer>` falls
 * back to it only once every real route has failed to match.
 */
export function matchRoutes(routes: Map<string, Component>, pathname: string): RouteMatch | null {
	let best: RouteMatch | null = null;
	let bestScore = -1;

	for (const [path, element] of routes) {
		if (path === SYMBOLS.CATCH_ALL) continue;

		const compiled = compileRoutePath(path);
		const params = matchCompiledRoutePath(compiled, pathname);

		if (params === null) continue;

		if (compiled.score > bestScore) {
			bestScore = compiled.score;
			best = { path: compiled.path, element, params };
		}
	}

	return best;
}

/**
 * Whether a pathname is (or is nested under) a link target. Used by `<Link>`
 * to decide when to apply its active class.
 */
export function isPathActive(current: string, target: string, exact = false): boolean {
	const a = normalizePathname(current);
	const b = normalizePathname(target);

	if (a === b) return true;
	if (exact || b === '/') return false;

	return a.startsWith(`${b}/`);
}
