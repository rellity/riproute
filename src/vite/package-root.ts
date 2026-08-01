import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the riproute package.
 *
 * Resolved from this module's own location — `dist/vite/index.js` once built,
 * `src/vite/package-root.ts` under vitest — so both work.
 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** riproute's shipped runtime source, and only that. */
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src') + path.sep;

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
	return path.resolve(file).startsWith(SOURCE_ROOT);
}
