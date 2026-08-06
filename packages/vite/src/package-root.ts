import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Rewrites a path to posix separators.
 *
 * Vite module ids use `/` on every OS while Node's `path` module answers in
 * the platform's separator, so on Windows an id-vs-path `startsWith` silently
 * never matches. Every comparison in the plugin goes through this first.
 */
export function normalizeId(value: string): string {
	return value.replace(/\\/g, '/');
}

/**
 * Absolute path of the riproute package, posix-normalized.
 *
 * Resolved from this module's own location — `dist/vite/index.js` once built,
 * `src/vite/package-root.ts` under vitest — so both work.
 */
export const PACKAGE_ROOT = normalizeId(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
);

/** riproute's shipped runtime source, and only that. */
const SOURCE_ROOT = `${PACKAGE_ROOT}/src/`;

/**
 * Whether `file` is part of riproute's own runtime.
 *
 * Both the title rewrite and the server-import guard exempt these from rules
 * written for app code: riproute has no business rewriting its own components,
 * and `src/server/` would otherwise match the server-only convention it defines.
 *
 * Scoped to `src/` rather than the package root on purpose. `example/` lives
 * inside this repository, and exempting the whole package would quietly turn
 * every rule off for the app we test them with.
 */
export function isRiprouteSource(file: string): boolean {
	return normalizeId(path.resolve(file)).startsWith(SOURCE_ROOT);
}

/**
 * Whether a Vite environment is a browser build.
 *
 * The single source of truth for "is this the client graph?", shared by the
 * server-import guard and the server-fn swap so the two can never disagree —
 * a divergence there is what would let the guard permit a `*.server.ts` import
 * that the swap then declines to replace, bundling the real module. Keyed on
 * `consumer`, which is Vite's own semantic for a browser-consumed build,
 * rather than the environment's name, which a custom setup may rename.
 */
export function isClientEnvironment(
	environment: { config?: { consumer?: string } } | undefined
): boolean {
	return environment?.config?.consumer === 'client';
}
