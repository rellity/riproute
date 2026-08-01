import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const MIME: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.webmanifest': 'application/manifest+json',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

export type ServeStaticOptions = {
	/**
	 * Directories whose contents carry a content hash in the file name and can
	 * therefore be cached forever.
	 */
	immutable?: string[];
	/** `Cache-Control` for everything else. */
	cacheControl?: string;
};

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves files from `dir`.
 *
 * Shaped as an `onRequest` hook, so it composes with the SSR handler instead of
 * wrapping it: the first thing that produces a `Response` wins, and a miss
 * falls through to routing.
 */
export function serveStatic(
	dir: string,
	options: ServeStaticOptions = {}
): (request: Request) => Promise<Response | undefined> {
	const root = path.resolve(dir);
	const immutable = (options.immutable ?? []).map((entry) => `/${trim(entry)}/`);
	const cacheControl = options.cacheControl ?? 'public, max-age=0, must-revalidate';

	return async function serve(request) {
		if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;

		const pathname = decodeUrlPath(new URL(request.url).pathname);

		if (pathname === null) return undefined;

		// The document itself is rendered, never served from disk — otherwise
		// the shell would win over every route.
		if (pathname === '/' || pathname.endsWith('/index.html')) return undefined;

		const file = path.join(root, pathname);

		// `path.join` normalises `..`, so this catches traversal after the fact.
		if (file !== root && !file.startsWith(root + path.sep)) return undefined;

		let stats: fs.Stats;

		try {
			stats = await fsp.stat(file);
		} catch {
			return undefined;
		}

		if (!stats.isFile()) return undefined;

		const etag = `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`;
		const headers = new Headers({
			'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
			'content-length': String(stats.size),
			'cache-control': immutable.some((prefix) => pathname.startsWith(prefix))
				? IMMUTABLE
				: cacheControl,
			etag,
			'last-modified': stats.mtime.toUTCString(),
		});

		if (request.headers.get('if-none-match') === etag) {
			return new Response(null, { status: 304, headers });
		}

		if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

		const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;

		return new Response(stream, { status: 200, headers });
	};
}

function decodeUrlPath(pathname: string): string | null {
	try {
		const decoded = decodeURIComponent(pathname);

		return decoded.includes('\0') ? null : decoded;
	} catch {
		return null;
	}
}

function trim(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}
