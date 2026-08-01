import { PassThrough, Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';

/**
 * Response compression for the Node adapter.
 *
 * Implemented here rather than left to a reverse proxy because `node dist/server`
 * is supposed to be deployable as-is — an HTML document compresses roughly 5:1,
 * and on a small host nothing else is going to do it.
 */

/** Types worth compressing. Images, fonts and video are already compressed. */
const COMPRESSIBLE =
	/^(text\/|application\/(json|javascript|xml|wasm|manifest\+json|rss\+xml)|image\/svg\+xml)/;

/** Below this, gzip overhead eats the saving. */
const MIN_SIZE = 1024;

export type Encoding = 'br' | 'gzip' | null;

/** Picks the strongest encoding the client accepts. */
export function negotiateEncoding(acceptEncoding: string | null): Encoding {
	if (acceptEncoding === null) return null;

	const accepted = acceptEncoding.toLowerCase();

	if (/\bbr\b(?!;q=0)/.test(accepted)) return 'br';
	if (/\bgzip\b(?!;q=0)/.test(accepted)) return 'gzip';

	return null;
}

/** Whether a response is worth running through a compressor at all. */
export function shouldCompress(headers: Headers, size: number | null): boolean {
	if (headers.has('content-encoding')) return false;
	if (headers.has('content-range')) return false;
	if (!COMPRESSIBLE.test(headers.get('content-type') ?? '')) return false;

	// An unknown size is a stream, and a stream through this server is HTML —
	// compress it. A known small size is not worth the header.
	return size === null || size >= MIN_SIZE;
}

/**
 * Creates the compressor stream for an encoding.
 *
 * Brotli quality 4 rather than the default 11: the default is a *storage*
 * setting, an order of magnitude slower for a few percent — at request time it
 * would cost more latency than the bytes save.
 */
export function createCompressor(encoding: Exclude<Encoding, null>): Transform {
	return encoding === 'br'
		? zlib.createBrotliCompress({
				params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
			})
		: zlib.createGzip({ level: 6 });
}

/** Runs a web `ReadableStream` through a compressor, back to a web stream. */
export function compressStream(
	body: ReadableStream<Uint8Array>,
	encoding: Exclude<Encoding, null>
): ReadableStream<Uint8Array> {
	const compressor = createCompressor(encoding);
	const output = new PassThrough();

	Readable.fromWeb(body as never)
		.pipe(compressor)
		.pipe(output);

	return Readable.toWeb(output) as ReadableStream<Uint8Array>;
}
