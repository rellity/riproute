import { Transform } from 'node:stream';
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

	// Parse the q-values rather than pattern-match: a naive `(?!;q=0)` lookahead
	// reads `br;q=0.5` (accepted, down-weighted) as `q=0` (refused) and drops
	// compression for a client that actually wanted it.
	const weights = new Map<string, number>();

	for (const part of acceptEncoding.toLowerCase().split(',')) {
		const [token, ...params] = part.trim().split(';');
		const name = token.trim();

		if (name === '') continue;

		let weight = 1;

		for (const param of params) {
			const match = /^\s*q=([0-9.]+)\s*$/.exec(param);

			if (match !== null) weight = Number(match[1]);
		}

		weights.set(name, weight);
	}

	const wildcard = weights.get('*') ?? 0;
	const br = weights.get('br') ?? wildcard;
	const gzip = weights.get('gzip') ?? wildcard;

	if (br > 0) return 'br';
	if (gzip > 0) return 'gzip';

	return null;
}

/** Whether a response is worth running through a compressor at all. */
export function shouldCompress(headers: Headers, size: number | null): boolean {
	if (headers.has('content-encoding')) return false;
	if (headers.has('content-range')) return false;
	// A response that mixes secrets with reflected input (a page carrying a CSRF
	// token, say) can opt out to sidestep BREACH: `Cache-Control: no-transform`
	// is the standard signal, and honouring it costs nothing.
	if (/\bno-transform\b/.test(headers.get('cache-control') ?? '')) return false;
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

/**
 * Runs a web `ReadableStream` through a compressor, back to a web stream.
 *
 * `pipeline`, not `.pipe()`, and an explicit `cancel` that reaches all the way
 * back to `body`. Both halves are load-bearing:
 *
 * - `.pipe()` does not forward errors, so a source that failed mid-response
 *   left `output` neither ended nor errored — the client saw a `200` that
 *   truncated and never terminated.
 * - Cancelling the returned stream (which is what a runtime does when the
 *   client disconnects) did not tear down the compressor or the source, so the
 *   app's producer kept being pulled forever. One aborted request pinned a CPU
 *   core permanently; a handful exhausted the host.
 */
export function compressStream(
	body: ReadableStream<Uint8Array>,
	encoding: Exclude<Encoding, null>
): ReadableStream<Uint8Array> {
	const compressor = createCompressor(encoding);
	const reader = body.getReader();

	// `settled` gates every controller call: enqueuing or closing after the
	// stream has closed, errored or been cancelled throws `ERR_INVALID_STATE`
	// on top of whatever actually went wrong.
	let settled = false;

	// The source is pumped by hand rather than through `Readable.fromWeb`:
	// Bun's implementation of it lets an error from the source escape as an
	// uncaught exception even with `error` handlers attached (verified against
	// plain node:stream APIs on Bun 1.3.11), and doing it here keeps the error
	// and cancellation paths identical on both runtimes.
	void (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();

				if (settled) return;

				if (done) {
					compressor.end();
					return;
				}

				if (!compressor.write(value)) await drained(compressor);

				if (settled) return;
			}
		} catch (error) {
			// A source that failed mid-response has to surface on the compressed
			// stream — otherwise the consumer waits on a response that never ends.
			compressor.destroy(error instanceof Error ? error : new Error(String(error)));
		}
	})();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			compressor.on('data', (chunk: Buffer) => {
				if (settled) return;

				controller.enqueue(new Uint8Array(chunk));

				// Respect the consumer's backpressure instead of buffering the
				// whole compressed response in memory.
				if ((controller.desiredSize ?? 1) <= 0) compressor.pause();
			});

			compressor.on('end', () => {
				if (settled) return;

				settled = true;
				controller.close();
			});

			compressor.on('error', (error: Error) => {
				if (settled) return;

				settled = true;
				controller.error(error);
			});
		},

		pull() {
			compressor.resume();
		},

		cancel(reason) {
			// The client is gone. Without this the source kept being pulled
			// forever: one aborted request pinned a CPU core permanently.
			settled = true;
			compressor.destroy();

			return reader.cancel(reason);
		},
	});
}

/** Resolves on `drain`, or as soon as the stream is finished with either way. */
function drained(stream: Transform): Promise<void> {
	return new Promise((resolve) => {
		const done = (): void => {
			stream.off('drain', done);
			stream.off('close', done);
			stream.off('error', done);
			resolve();
		};

		stream.once('drain', done);
		stream.once('close', done);
		stream.once('error', done);
	});
}

/**
 * Compresses a response when the client, the content type and the size all say
 * it is worth it. A no-op when nothing is gained, returning the response as-is.
 */
export function maybeCompress(request: Request, response: Response): Response {
	if (response.body === null || response.status === 204 || response.status === 304) {
		return response;
	}

	const encoding = negotiateEncoding(request.headers.get('accept-encoding'));

	if (encoding === null) return response;

	const headers = new Headers(response.headers);
	const length = headers.get('content-length');

	if (!shouldCompress(headers, length === null ? null : Number(length))) return response;

	// The compressed size is unknowable up front, so the response streams.
	headers.delete('content-length');
	headers.set('content-encoding', encoding);
	appendVary(headers, 'accept-encoding');

	return new Response(compressStream(response.body, encoding), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function appendVary(headers: Headers, value: string): void {
	const existing = headers.get('vary');

	if (existing === null) {
		headers.set('vary', value);
		return;
	}

	const parts = existing
		.toLowerCase()
		.split(',')
		.map((part) => part.trim());

	if (parts.includes('*') || parts.includes(value)) return;

	headers.set('vary', `${existing}, ${value}`);
}
