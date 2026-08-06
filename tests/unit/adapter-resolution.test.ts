import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { installedAdapters, resolveAdapterPackage } from '../../packages/vite/src/adapter';

const roots: string[] = [];

/** An app root with the named adapter packages "installed" in node_modules. */
function appWith(...adapters: string[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-app-'));

	roots.push(root);
	// Declared *and* installed: the declaration is what makes it the app's
	// choice, and resolution is what makes it usable.
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({
			name: 'app',
			dependencies: Object.fromEntries(adapters.map((a) => [`@riproute/${a}`, '*'])),
		})
	);

	for (const name of adapters) {
		const dir = path.join(root, 'node_modules', '@riproute', name);

		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'package.json'),
			JSON.stringify({
				name: `@riproute/${name}`,
				version: '0.0.0',
				type: 'module',
				exports: {
					'./package.json': './package.json',
					'./adapter': './adapter.js',
				},
			})
		);
		fs.writeFileSync(
			path.join(dir, 'adapter.js'),
			`export default { name: ${JSON.stringify(name)}, runtimePackage: "@riproute/${name}", entry: () => "// ${name}" };\n`
		);
	}

	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('adapter autodetection', () => {
	it('finds the installed adapter without any configuration', async () => {
		const selection = await resolveAdapterPackage(appWith('node'));

		expect(selection.from).toBe('@riproute/node');
		expect(selection.adapter.name).toBe('node');
		expect(selection.adapter.entry({} as never)).toBe('// node');
	});

	it('works the same for any target', async () => {
		expect((await resolveAdapterPackage(appWith('cloudflare'))).adapter.name).toBe(
			'cloudflare'
		);
		expect((await resolveAdapterPackage(appWith('bun'))).adapter.name).toBe('bun');
	});

	it('ignores an adapter that is resolvable but never declared', () => {
		const root = appWith('node');

		// A workspace root can hoist every adapter into view; only the app's own
		// package.json says which one it deploys to.
		const hoisted = path.join(root, 'node_modules', '@riproute', 'bun');

		fs.mkdirSync(hoisted, { recursive: true });
		fs.writeFileSync(
			path.join(hoisted, 'package.json'),
			JSON.stringify({
				name: '@riproute/bun',
				version: '0',
				exports: { './package.json': './package.json' },
			})
		);

		expect(installedAdapters(root)).toEqual(['@riproute/node']);
	});

	it('lists what is installed', () => {
		expect(installedAdapters(appWith('node', 'bun')).sort()).toEqual([
			'@riproute/bun',
			'@riproute/node',
		]);
		expect(installedAdapters(appWith())).toEqual([]);
	});

	it('refuses to guess when none is installed', async () => {
		await expect(resolveAdapterPackage(appWith())).rejects.toThrow(/No adapter installed/);
	});

	it('refuses to guess when several are installed', async () => {
		await expect(resolveAdapterPackage(appWith('node', 'cloudflare'))).rejects.toThrow(
			/ambiguous/
		);
	});

	it('rejects a package whose adapter export is not one', async () => {
		const root = appWith('node');

		fs.writeFileSync(
			path.join(root, 'node_modules', '@riproute', 'node', 'adapter.js'),
			'export default { nope: true };\n'
		);

		await expect(resolveAdapterPackage(root)).rejects.toThrow(
			/does not export a riproute adapter/
		);
	});
});
