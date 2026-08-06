/**
 * Packs every published package into a release tarball.
 *
 * riproute is not on npm, so a release *is* the registry: the tarballs are
 * attached to a GitHub release and installed by URL. That only works if the
 * packages can find each other, and `workspace:*` cannot survive the trip — it
 * resolves against a workspace the installing app does not have. `pnpm pack`
 * rewrites it to a bare version (`0.1.0`), which is worse than useless here:
 * npm would go looking for that version on a registry that has never heard of
 * `@riproute/*`.
 *
 * So each intra-repo dependency is rewritten to the URL of the tarball it
 * refers to, and the whole graph resolves from the release alone —
 * `npm i <url-of-riproute>` pulls the router down behind it, with no token, no
 * registry and no workspace.
 *
 * Private packages are skipped. The adapter kit is one: it is bundled into
 * every package that uses it, so it has no business being installable.
 *
 * The rewrite happens to a copy of `package.json` that is restored afterwards,
 * so `workspace:*` stays in the tree — it is what makes the local checkout link
 * to itself instead of downloading its own published past.
 *
 * Usage:
 *   node scripts/pack-release.mjs --tag v0.1.0 --out dist-release
 *   node scripts/pack-release.mjs --tag v0.1.0 --out dist-release --base http://localhost:8080
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'rellity/riproute';

function arg(name, fallback = null) {
	const index = process.argv.indexOf(`--${name}`);

	return index === -1 ? fallback : process.argv[index + 1];
}

const tag = arg('tag');

if (tag === null) {
	console.error('usage: node scripts/pack-release.mjs --tag <tag> [--out dir] [--base url]');
	process.exit(1);
}

const outDir = path.resolve(root, arg('out', 'dist-release'));
const base = arg('base', `https://github.com/${REPO}/releases/download/${tag}`);

/**
 * The tarball name `npm pack` gives a package.
 *
 * Scoped names lose the `@` and the slash becomes a dash, so `@riproute/router`
 * at 0.1.0 is `riproute-router-0.1.0.tgz`.
 */
function tarballName(name, version) {
	return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

/** Every workspace package that is meant to be installed by an app. */
function publishablePackages() {
	const dir = path.join(root, 'packages');

	return fs
		.readdirSync(dir)
		.map((entry) => path.join(dir, entry))
		.filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
		.map((dir) => ({
			dir,
			manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')),
		}))
		.filter(({ manifest }) => manifest.private !== true);
}

const packages = publishablePackages();

/**
 * A tag that disagrees with the versions produces a release full of dead
 * links: the URLs are built from the tag, the filenames from `version`. Catch
 * it here rather than in an app's install log a week later.
 */
if (/^v\d/.test(tag)) {
	const expected = tag.slice(1);
	const wrong = packages.filter(({ manifest }) => manifest.version !== expected);

	if (wrong.length > 0) {
		console.error(
			`tag ${tag} expects version ${expected}, but ` +
				wrong.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(', ')
		);
		process.exit(1);
	}
}

const urls = new Map(
	packages.map(({ manifest }) => [
		manifest.name,
		`${base}/${tarballName(manifest.name, manifest.version)}`,
	])
);

/**
 * Points every installable `workspace:` dependency at its release tarball.
 *
 * `devDependencies` are dropped rather than rewritten. An installer never
 * reads them, and the internal ones — the adapter kit above all — name
 * packages that are deliberately not in the release; leaving a `workspace:*`
 * range in a published manifest would just be a dangling reference to a
 * workspace nobody else has.
 */
function rewriteDeps(manifest) {
	let changed = false;
	const next = { ...manifest };

	for (const field of ['dependencies', 'optionalDependencies']) {
		const deps = manifest[field];

		if (deps === undefined) continue;

		const rewritten = { ...deps };

		for (const [name, range] of Object.entries(deps)) {
			if (!String(range).startsWith('workspace:')) continue;

			const url = urls.get(name);

			if (url === undefined) {
				throw new Error(
					`${manifest.name} depends on ${name} with ${range}, but ${name} is not released. ` +
						`Either publish ${name} or bundle it and move it to devDependencies.`
				);
			}

			rewritten[name] = url;
			changed = true;
		}

		next[field] = rewritten;
	}

	const dev = manifest.devDependencies;

	if (dev !== undefined) {
		const kept = Object.fromEntries(
			Object.entries(dev).filter(([, range]) => !String(range).startsWith('workspace:'))
		);

		if (Object.keys(kept).length !== Object.keys(dev).length) {
			next.devDependencies = kept;
			changed = true;
		}
	}

	return changed ? next : null;
}

fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(outDir)) {
	if (file.endsWith('.tgz')) fs.rmSync(path.join(outDir, file));
}

for (const { dir, manifest } of packages) {
	const manifestPath = path.join(dir, 'package.json');
	const original = fs.readFileSync(manifestPath, 'utf8');
	const rewritten = rewriteDeps(manifest);

	try {
		if (rewritten !== null) {
			fs.writeFileSync(manifestPath, `${JSON.stringify(rewritten, null, '\t')}\n`);
		}

		// `npm pack`, not `pnpm pack`: pnpm rewrites `workspace:` itself, to a
		// bare version, and would undo the URL this script just wrote.
		execFileSync('npm', ['pack', '--loglevel', 'error', '--pack-destination', outDir], {
			cwd: dir,
			stdio: ['ignore', 'ignore', 'inherit'],
		});
	} finally {
		fs.writeFileSync(manifestPath, original);
	}

	console.log(`packed ${manifest.name}@${manifest.version}`);
}

console.log(
	`\n${packages.length} tarballs in ${path.relative(root, outDir)}, resolving against ${base}`
);
