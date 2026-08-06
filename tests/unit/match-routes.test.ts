import type { Component } from 'ripple';
import { describe, expect, it } from 'vitest';

import {
	compileRoutePath,
	isPathActive,
	matchCompiledRoutePath,
	matchRoutes,
} from '../../packages/router/src/utils/match-routes';
import {
	buildHref,
	isExternalUrl,
	normalizeBase,
	normalizePathname,
	parseLocation,
	stripBase,
	withBase,
} from '../../packages/router/src/utils/location';

const noop = (() => {}) as Component;

function routes(...paths: string[]): Map<string, Component> {
	return new Map(paths.map((path) => [path, noop]));
}

describe('normalizePathname', () => {
	it('adds a leading slash', () => {
		expect(normalizePathname('about')).toBe('/about');
	});

	it('drops the trailing slash but keeps the root', () => {
		expect(normalizePathname('/about/')).toBe('/about');
		expect(normalizePathname('/')).toBe('/');
		expect(normalizePathname('')).toBe('/');
	});

	it('collapses repeated slashes', () => {
		expect(normalizePathname('//a///b')).toBe('/a/b');
	});
});

describe('parseLocation', () => {
	it('splits pathname, search and hash', () => {
		const location = parseLocation('/users/1?tab=posts#top');

		expect(location.pathname).toBe('/users/1');
		expect(location.search).toBe('?tab=posts');
		expect(location.hash).toBe('#top');
		expect(location.href).toBe('/users/1?tab=posts#top');
	});

	it('normalizes the pathname', () => {
		expect(parseLocation('users/1/').pathname).toBe('/users/1');
	});
});

describe('base paths', () => {
	it('normalizes a base', () => {
		expect(normalizeBase('/app/')).toBe('/app');
		expect(normalizeBase('/')).toBe('');
		expect(normalizeBase(undefined)).toBe('');
	});

	it('strips the base from a pathname', () => {
		expect(stripBase('/app/users', '/app')).toBe('/users');
		expect(stripBase('/app', '/app')).toBe('/');
		expect(stripBase('/other', '/app')).toBe('/other');
	});

	it('applies the base to a path', () => {
		expect(withBase('/users', '/app')).toBe('/app/users');
		expect(withBase('/users?a=1#b', '/app')).toBe('/app/users?a=1#b');
		expect(withBase('/app/users', '/app')).toBe('/app/users');
		expect(withBase('/users', '')).toBe('/users');
		expect(withBase('https://example.com', '/app')).toBe('https://example.com');
	});
});

describe('isExternalUrl', () => {
	it('detects absolute and protocol-relative URLs', () => {
		expect(isExternalUrl('https://example.com')).toBe(true);
		expect(isExternalUrl('http://example.com')).toBe(true);
		expect(isExternalUrl('//example.com')).toBe(true);
		expect(isExternalUrl('mailto:a@b.c')).toBe(true);
		expect(isExternalUrl('/about')).toBe(false);
	});
});

describe('buildHref', () => {
	it('keeps the search and hash already on the path', () => {
		expect(buildHref('/a?b=1#c')).toBe('/a?b=1#c');
	});

	it('replaces the search params', () => {
		expect(buildHref('/a?b=1', { searchParams: { c: '2' } })).toBe('/a?c=2');
		expect(buildHref('/a?b=1', { searchParams: {} })).toBe('/a');
	});

	it('replaces the hash, with or without the leading #', () => {
		expect(buildHref('/a', { hash: 'top' })).toBe('/a#top');
		expect(buildHref('/a', { hash: '#top' })).toBe('/a#top');
		expect(buildHref('/a#top', { hash: '' })).toBe('/a');
	});
});

describe('compileRoutePath', () => {
	it('classifies segments', () => {
		expect(compileRoutePath('/users/:id/*rest').segments).toEqual([
			{ type: 'static', name: 'users' },
			{ type: 'param', name: 'id' },
			{ type: 'splat', name: 'rest' },
		]);
	});

	it('names a bare splat "*"', () => {
		expect(compileRoutePath('/files/*').segments[1]).toEqual({ type: 'splat', name: '*' });
	});

	it('scores static above dynamic above splat', () => {
		expect(compileRoutePath('/users/new').score).toBeGreaterThan(
			compileRoutePath('/users/:id').score
		);
		expect(compileRoutePath('/users/:id').score).toBeGreaterThan(
			compileRoutePath('/users/*rest').score
		);
	});
});

describe('matchCompiledRoutePath', () => {
	it('matches the root', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/'), '/')).toEqual({});
	});

	it('extracts params', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/users/:id'), '/users/42')).toEqual({
			id: '42',
		});
	});

	it('decodes params', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/tags/:tag'), '/tags/a%20b')).toEqual({
			tag: 'a b',
		});
	});

	it('rejects a length mismatch', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/users/:id'), '/users')).toBeNull();
		expect(matchCompiledRoutePath(compileRoutePath('/users/:id'), '/users/1/edit')).toBeNull();
	});

	it('captures the remainder in a splat, including when empty', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/docs/*rest'), '/docs/a/b')).toEqual({
			rest: 'a/b',
		});
		expect(matchCompiledRoutePath(compileRoutePath('/docs/*rest'), '/docs')).toEqual({
			rest: '',
		});
	});

	it('ignores trailing slashes', () => {
		expect(matchCompiledRoutePath(compileRoutePath('/about/'), '/about')).toEqual({});
	});
});

describe('matchRoutes', () => {
	it('returns null when nothing matches', () => {
		expect(matchRoutes(routes('/about'), '/nope')).toBeNull();
	});

	it('prefers the most specific route regardless of declaration order', () => {
		const table = routes('/users/:id', '/users/new');

		expect(matchRoutes(table, '/users/new')?.path).toBe('/users/new');
		expect(matchRoutes(table, '/users/7')?.path).toBe('/users/:id');
	});

	it('prefers a param over a splat', () => {
		const table = routes('/files/*rest', '/files/:name');

		expect(matchRoutes(table, '/files/a')?.path).toBe('/files/:name');
		expect(matchRoutes(table, '/files/a/b')?.path).toBe('/files/*rest');
	});

	it('never returns the catch-all sentinel', () => {
		expect(matchRoutes(routes('**'), '/anything')).toBeNull();
	});
});

describe('isPathActive', () => {
	it('matches exactly', () => {
		expect(isPathActive('/a', '/a')).toBe(true);
		expect(isPathActive('/a', '/b')).toBe(false);
	});

	it('matches nested paths unless exact', () => {
		expect(isPathActive('/a/b', '/a')).toBe(true);
		expect(isPathActive('/a/b', '/a', true)).toBe(false);
	});

	it('does not treat the root as a prefix of everything', () => {
		expect(isPathActive('/a', '/')).toBe(false);
		expect(isPathActive('/', '/')).toBe(true);
	});

	it('does not match a partial segment', () => {
		expect(isPathActive('/about-us', '/about')).toBe(false);
	});
});
