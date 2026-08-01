import { describe, expect, it } from 'vitest';

import { resolveTitle } from '../../src/utils/title';

describe('resolveTitle', () => {
	it('uses the text as written by default', () => {
		expect(resolveTitle('docs', 'Site')).toBe('docs');
	});

	it('substitutes &title with the base title', () => {
		expect(resolveTitle('home | &title', 'Site')).toBe('home | Site');
	});

	it('substitutes every occurrence', () => {
		expect(resolveTitle('&title — home — &title', 'Site')).toBe('Site — home — Site');
	});

	it('substitutes in append mode too, without appending twice', () => {
		expect(resolveTitle('home | &title', 'Site', { mode: 'append' })).toBe('home | Site');
	});

	it('appends the base title when there is no token', () => {
		expect(resolveTitle('home', 'Site', { mode: 'append' })).toBe('home | Site');
	});

	it('honours a custom separator when appending', () => {
		expect(resolveTitle('home', 'Site', { mode: 'append', separator: ' · ' })).toBe(
			'home · Site'
		);
	});

	it('ignores the separator when the token places the base title', () => {
		expect(resolveTitle('home — &title', 'Site', { mode: 'append', separator: ' · ' })).toBe(
			'home — Site'
		);
	});

	it('appends nothing when the base title is empty', () => {
		expect(resolveTitle('home', '', { mode: 'append' })).toBe('home');
	});

	it('drops the dangling separator when the token has no base title to expand to', () => {
		expect(resolveTitle('home | &title', '')).toBe('home');
		expect(resolveTitle('&title | home', '')).toBe('home');
	});

	it('trims surrounding whitespace', () => {
		expect(resolveTitle('  docs  ', 'Site')).toBe('docs');
		expect(resolveTitle('  home | &title  ', 'Site')).toBe('home | Site');
	});

	it('trims the base title', () => {
		expect(resolveTitle('home | &title', '  Site  ')).toBe('home | Site');
	});
});
