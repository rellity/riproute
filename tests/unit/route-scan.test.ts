import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { filePathToRoutePath, scanRoutes } from '../../packages/vite/src/route-scan';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Materialises a routes directory from a `path -> contents` map. */
function routesDir(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-'));

	dirs.push(dir);

	for (const [file, contents] of Object.entries(files)) {
		const full = path.join(dir, file);

		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, contents);
	}

	return dir;
}

describe('filePathToRoutePath', () => {
	it.each([
		['index.tsrx', '/'],
		['about.tsrx', '/about'],
		['posts/index.tsrx', '/posts'],
		['posts/$id.tsrx', '/posts/:id'],
		['posts.$id.tsrx', '/posts/:id'],
		['posts/$id/edit.tsrx', '/posts/:id/edit'],
		['posts.$id.edit.tsrx', '/posts/:id/edit'],
		['files/$.tsrx', '/files/*splat'],
		['__not-found.tsrx', '**'],
		['__404.tsrx', '**'],
	])('%s -> %s', (file, expected) => {
		expect(filePathToRoutePath(file)).toBe(expected);
	});

	it('ignores the root layout and single-underscore files', () => {
		expect(filePathToRoutePath('__root.tsrx')).toBeNull();
		expect(filePathToRoutePath('_helper.tsrx')).toBeNull();
		expect(filePathToRoutePath('_lib/thing.tsrx')).toBeNull();
	});
});

describe('scanRoutes', () => {
	it('builds a table and picks up the root layout', () => {
		const dir = routesDir({
			'__root.tsrx': '',
			'index.tsrx': '',
			'about.tsrx': '',
			'users.$id.tsrx': '',
			'files/$.tsrx': '',
			'_helpers.ts': '',
			'about.test.tsrx': '',
		});

		const { routes, root } = scanRoutes(dir);

		expect(root).toBe(path.join(dir, '__root.tsrx'));
		expect(routes.map((route) => route.path).sort()).toEqual([
			'/',
			'/about',
			'/files/*splat',
			'/users/:id',
		]);
	});

	it('is not an error for a project with no routes directory', () => {
		expect(scanRoutes(path.join(os.tmpdir(), 'riproute-does-not-exist'))).toEqual({
			routes: [],
			root: null,
		});
	});

	it('names both files when two map to the same route', () => {
		const dir = routesDir({ 'posts/$id.tsrx': '', 'posts.$id.tsrx': '' });

		expect(() => scanRoutes(dir)).toThrow(/Two files map to the route "\/posts\/:id"/);
	});
});
