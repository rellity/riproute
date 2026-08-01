import { describe, expect, it } from 'vitest';

import { negotiateEncoding, shouldCompress } from '../../src/adapter-node/compression';

describe('negotiateEncoding', () => {
	it('prefers brotli, falls back to gzip', () => {
		expect(negotiateEncoding('gzip, deflate, br')).toBe('br');
		expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
		expect(negotiateEncoding('identity')).toBeNull();
		expect(negotiateEncoding(null)).toBeNull();
	});

	it('respects q=0', () => {
		expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip');
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
});
