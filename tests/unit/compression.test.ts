import { describe, expect, it } from 'vitest';

import {
	compressStream,
	negotiateEncoding,
	shouldCompress,
} from '../../src/adapter-node/compression';

describe('negotiateEncoding', () => {
	it('prefers brotli, falls back to gzip', () => {
		expect(negotiateEncoding('gzip, deflate, br')).toBe('br');
		expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
		expect(negotiateEncoding('identity')).toBeNull();
		expect(negotiateEncoding(null)).toBeNull();
	});

	it('respects q=0', () => {
		expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip');
		expect(negotiateEncoding('br;q=0.0, gzip')).toBe('gzip');
		expect(negotiateEncoding('br;q=0, gzip;q=0')).toBeNull();
	});

	it('accepts a down-weighted encoding (q between 0 and 1)', () => {
		// The old lookahead read `br;q=0.5` as a refusal — it is an acceptance.
		expect(negotiateEncoding('br;q=0.5')).toBe('br');
		expect(negotiateEncoding('gzip;q=0.7')).toBe('gzip');
		expect(negotiateEncoding('br;q=0.001, gzip;q=0.9')).toBe('br');
	});

	it('honours a wildcard', () => {
		expect(negotiateEncoding('*')).toBe('br');
		expect(negotiateEncoding('br;q=0, *')).toBe('gzip');
	});
});

describe('shouldCompress', () => {
	const html = new Headers({ 'content-type': 'text/html; charset=utf-8' });

	it('compresses large text, skips small text', () => {
		expect(shouldCompress(html, 50_000)).toBe(true);
		expect(shouldCompress(html, 100)).toBe(false);
	});

	it('compresses streams of unknown size', () => {
		expect(shouldCompress(html, null)).toBe(true);
	});

	it('skips already-compressed formats', () => {
		expect(shouldCompress(new Headers({ 'content-type': 'image/png' }), 50_000)).toBe(false);
		expect(shouldCompress(new Headers({ 'content-type': 'font/woff2' }), 50_000)).toBe(false);
	});

	it('never double-compresses', () => {
		const headers = new Headers({
			'content-type': 'text/html',
			'content-encoding': 'gzip',
		});

		expect(shouldCompress(headers, 50_000)).toBe(false);
	});

	it('leaves range responses alone', () => {
		const headers = new Headers({
			'content-type': 'text/html',
			'content-range': 'bytes 0-99/1000',
		});

		expect(shouldCompress(headers, 50_000)).toBe(false);
	});

	it('honours Cache-Control: no-transform (BREACH opt-out)', () => {
		const headers = new Headers({
			'content-type': 'text/html',
			'cache-control': 'private, no-transform',
		});

		expect(shouldCompress(headers, 50_000)).toBe(false);
	});
});

describe('compressStream teardown', () => {
	/** A source that counts how often it was pulled and whether it was cancelled. */
	function countingSource() {
		const state = { pulls: 0, cancelled: false };
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				state.pulls++;
				controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
			},
			cancel() {
				state.cancelled = true;
			},
		});

		return { state, stream };
	}

	it('stops the source when the consumer cancels', async () => {
		const { state, stream } = countingSource();
		const reader = compressStream(stream, 'gzip').getReader();

		await reader.read();

		const atCancel = state.pulls;

		await reader.cancel();
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Without cancel propagation the producer ran forever — one aborted
		// request pinned a CPU core for the life of the process.
		expect(state.pulls).toBeLessThanOrEqual(atCancel + 2);
		expect(state.cancelled).toBe(true);
	});

	it('surfaces a source error instead of hanging the response open', async () => {
		const boom = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('partial'));
			},
			pull(controller) {
				controller.error(new Error('SOURCE-BLEW-UP'));
			},
		});

		const reader = compressStream(boom, 'gzip').getReader();

		const outcome = await Promise.race([
			(async () => {
				try {
					for (;;) {
						const { done } = await reader.read();

						if (done) return 'closed';
					}
				} catch {
					return 'errored';
				}
			})(),
			new Promise((resolve) => setTimeout(() => resolve('hung'), 2000)),
		]);

		expect(outcome).toBe('errored');
	});

	it('still compresses, and the bytes round-trip', async () => {
		const text = 'hello '.repeat(500);
		const body = new Response(text).body as ReadableStream<Uint8Array>;
		const compressed = await new Response(compressStream(body, 'gzip')).arrayBuffer();

		expect(compressed.byteLength).toBeLessThan(text.length / 5);

		const round = await new Response(
			new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
		).text();

		expect(round).toBe(text);
	});
});
