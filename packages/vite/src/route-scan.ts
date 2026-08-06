import fs from 'node:fs';
import path from 'node:path';

/**
 * A route discovered on disk.
 *
 * `file` is an absolute path; the virtual route module turns it into a
 * root-relative import so Rollup accepts it as a chunk name during the client
 * build.
 */
export type DiscoveredRoute = {
	/** URL pattern in riproute syntax: `/users/:id`, `/files/*splat`, `**`. */
	path: string;
	/** Absolute path of the module that default-exports the component. */
	file: string;
};

export type DiscoveredRoutes = {
	routes: DiscoveredRoute[];
	/** The `__root` layout, if the app has one. */
	root: string | null;
};

/** Extensions a route module may use. `.tsrx` first — it is the common case. */
export const ROUTE_EXTENSIONS = ['.tsrx', '.ts', '.tsx', '.js', '.jsx'];

const IGNORED = /(^\.)|(\.(test|spec|d)\.[^.]+$)/;

/**
 * File names that mean something other than "a route at this path".
 *
 * Double underscore is the escape hatch, matching TanStack Start: `__root` is
 * the layout every route renders inside, `__not-found` is the catch-all. A
 * single leading underscore marks a file the router should ignore entirely,
 * which is how you keep helpers next to the routes that use them.
 */
const ROOT_NAMES = new Set(['__root']);
const NOT_FOUND_NAMES = new Set(['__not-found', '__notfound', '__404']);

function isRouteFile(name: string): boolean {
	return ROUTE_EXTENSIONS.includes(path.extname(name)) && !IGNORED.test(name);
}

/**
 * Turns a routes-dir-relative file path into a URL pattern.
 *
 * Both layouts are accepted, and they mean the same thing:
 *
 * - nested directories — `posts/$id.tsrx`
 * - flat, dot-separated — `posts.$id.tsrx`
 *
 * `index` collapses into its parent, `$name` becomes `:name`, and a bare `$`
 * becomes a splat.
 */
export function filePathToRoutePath(relative: string): string | null {
	const withoutExtension = relative.slice(0, -path.extname(relative).length);
	const segments: string[] = [];

	for (const part of withoutExtension.split(/[\\/]/)) {
		// A dot in a file name is a path separator, so `posts.$id` and
		// `posts/$id` produce the same route.
		for (const piece of part.split('.')) {
			if (piece === '') continue;

			// `_helpers/` and `_layout.tsrx` are invisible to the router.
			if (piece.startsWith('_') && !piece.startsWith('__')) return null;

			segments.push(piece);
		}
	}

	if (segments.length === 0) return null;

	const last = segments[segments.length - 1];

	if (ROOT_NAMES.has(last)) return null;
	if (NOT_FOUND_NAMES.has(last)) return '**';

	// `index` is the route *at* its directory, not a segment of its own.
	if (last === 'index') segments.pop();

	const url = segments
		.map((segment) => {
			if (segment === '$') return '*splat';
			if (segment.startsWith('$')) return `:${segment.slice(1)}`;

			return segment;
		})
		.join('/');

	return url === '' ? '/' : `/${url}`;
}

/** Recursively lists every route-eligible file under `dir`. */
function walk(dir: string, base = dir, out: string[] = []): string[] {
	let entries: fs.Dirent[];

	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const full = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

			walk(full, base, out);
			continue;
		}

		if (entry.isFile() && isRouteFile(entry.name)) out.push(full);
	}

	return out;
}

/**
 * Scans `routesDir` and returns the route table plus the `__root` layout.
 *
 * A missing directory is not an error: code-first apps pass their table to
 * `<Router routes={...}>` and never create one.
 */
export function scanRoutes(routesDir: string): DiscoveredRoutes {
	const files = walk(routesDir);
	const routes: DiscoveredRoute[] = [];
	const seen = new Map<string, string>();

	let root: string | null = null;

	for (const file of files) {
		const relative = path.relative(routesDir, file);
		const name = path.basename(relative, path.extname(relative));

		if (ROOT_NAMES.has(name) && path.dirname(relative) === '.') {
			root = file;
			continue;
		}

		const routePath = filePathToRoutePath(relative);

		if (routePath === null) continue;

		const existing = seen.get(routePath);

		if (existing !== undefined) {
			throw new Error(
				`[riproute] Two files map to the route "${routePath}":\n` +
					`  ${path.relative(process.cwd(), existing)}\n` +
					`  ${path.relative(process.cwd(), file)}`
			);
		}

		seen.set(routePath, file);
		routes.push({ path: routePath, file });
	}

	return { routes, root };
}
