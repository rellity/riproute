import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The release is the distribution channel, so what the tarballs claim about
 * each other is load-bearing: a wrong dependency range does not fail here, it
 * fails in a stranger's install log. These assertions read the real tarballs
 * the real script produces.
 */

const root = path.resolve(__dirname, '../..');
const BASE = 'https://example.test/download/v0.1.0';

let outDir: string;
let files: string[];

/** The `package.json` inside a packed tarball. */
function manifestOf(tarball: string): Record<string, any> {
	const json = execFileSync(
		'tar',
		['-xzOf', path.join(outDir, tarball), 'package/package.json'],
		{
			encoding: 'utf8',
		}
	);

	return JSON.parse(json);
}

/** Every workspace manifest, keyed by path, as it looked before packing. */
function readManifests(): Map<string, string> {
	const dir = path.join(root, 'packages');

	return new Map(
		fs
			.readdirSync(dir)
			.map((entry) => path.join(dir, entry, 'package.json'))
			.filter((file) => fs.existsSync(file))
			.map((file) => [file, fs.readFileSync(file, 'utf8')])
	);
}

let before: Map<string, string>;

beforeAll(() => {
	outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-release-'));
	before = readManifests();

	execFileSync(
		'node',
		['scripts/pack-release.mjs', '--tag', 'v0.1.0', '--out', outDir, '--base', BASE],
		{ cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
	);

	files = fs.readdirSync(outDir).filter((file) => file.endsWith('.tgz'));
}, 120_000);

afterAll(() => {
	fs.rmSync(outDir, { recursive: true, force: true });
});

describe('release tarballs', () => {
	it('packs every public package and no private one', () => {
		expect(files.sort()).toEqual([
			'riproute-bun-0.1.0.tgz',
			'riproute-cloudflare-0.1.0.tgz',
			'riproute-node-0.1.0.tgz',
			'riproute-riproute-0.1.0.tgz',
			'riproute-router-0.1.0.tgz',
			'riproute-vite-0.1.0.tgz',
		]);

		// The adapter kit is bundled into its consumers, so shipping it as an
		// installable package would invite an app to depend on a contract that
		// is deliberately internal.
		expect(files).not.toContain('riproute-adapter-kit-0.1.0.tgz');
	});

	it('points intra-repo dependencies at sibling tarballs, so one URL pulls the rest', () => {
		expect(manifestOf('riproute-riproute-0.1.0.tgz').dependencies).toEqual({
			'@riproute/router': `${BASE}/riproute-router-0.1.0.tgz`,
		});
	});

	it('leaves no workspace: range in anything it publishes', () => {
		for (const file of files) {
			const manifest = manifestOf(file);
			const ranges = [
				...Object.values(manifest.dependencies ?? {}),
				...Object.values(manifest.devDependencies ?? {}),
				...Object.values(manifest.optionalDependencies ?? {}),
				...Object.values(manifest.peerDependencies ?? {}),
			];

			expect(ranges.filter((range) => String(range).startsWith('workspace:'))).toEqual([]);
		}
	});

	it('never publishes a dependency on the unreleased adapter kit', () => {
		for (const file of files) {
			const manifest = manifestOf(file);

			// devDependencies are ignored by installers, but a *dependency* on it
			// would make every install fail on a 404.
			expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@riproute/adapter-kit');
		}
	});

	it('restores the working tree, so the workspace still links to itself', () => {
		// The script edits each manifest in place to bake the URLs in. If it ever
		// failed to put them back, `workspace:*` would be gone and the next
		// `pnpm install` would fetch riproute's own published past from a URL
		// instead of linking the checkout.
		expect(readManifests()).toEqual(before);
	});

	it('refuses a tag that disagrees with the packages it is packing', () => {
		expect(() =>
			execFileSync('node', ['scripts/pack-release.mjs', '--tag', 'v9.9.9', '--out', outDir], {
				cwd: root,
				stdio: ['ignore', 'ignore', 'pipe'],
			})
		).toThrow();
	});
});
