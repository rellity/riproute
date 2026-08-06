import { describe, expect, it } from 'vitest';

import { normalizeWebRequest } from '../../packages/adapter-kit/src/web';

describe('normalizeWebRequest', () => {
	const at = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

	it('returns the request unchanged when there is nothing to rewrite', () => {
		const request = at('http://app.test/users/1?tab=x');

		expect(normalizeWebRequest(request)).toBe(request);
	});

	it('ignores forwarded headers unless told to trust them', () => {
		const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.test' };

		expect(normalizeWebRequest(at('http://app.test/', headers)).url).toBe('http://app.test/');
		expect(normalizeWebRequest(at('http://app.test/', headers), { trustProxy: true }).url).toBe(
			'https://evil.test/'
		);
	});

	it('takes the first hop of a comma-joined forwarded host', () => {
		const request = at('http://app.test/', { 'x-forwarded-host': 'a.test, b.test' });

		expect(new URL(normalizeWebRequest(request, { trustProxy: true }).url).host).toBe('a.test');
	});

	it('refuses a host outside allowedHosts', () => {
		expect(
			normalizeWebRequest(at('http://app.test/'), { allowedHosts: ['app.test'] }).url
		).toBe('http://app.test/');
		expect(() =>
			normalizeWebRequest(at('http://evil.test/'), { allowedHosts: ['app.test'] })
		).toThrow(/Refused Host/);
	});

	it('does not carry the internal port onto a forwarded host', () => {
		// The WHATWG `host` setter only replaces the port when the new value has
		// one, so mutating left `:3000` behind and every absolute link the app
		// derived (redirects, reset mails, OAuth callbacks) pointed at it.
		const request = at('http://127.0.0.1:3000/reset?tok=1', {
			'x-forwarded-host': 'app.example.com',
			'x-forwarded-proto': 'https',
		});

		expect(normalizeWebRequest(request, { trustProxy: true }).url).toBe(
			'https://app.example.com/reset?tok=1'
		);
	});

	it('keeps an explicit port on the forwarded host', () => {
		const request = at('http://127.0.0.1:3000/x', {
			'x-forwarded-host': 'app.example.com:8443',
		});

		expect(new URL(normalizeWebRequest(request, { trustProxy: true }).url).host).toBe(
			'app.example.com:8443'
		);
	});
});
