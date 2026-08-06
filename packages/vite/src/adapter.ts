import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { RiprouteAdapter } from '@riproute/adapter-kit';

/**
 * Finding the adapter.
 *
 * The plugin does not know what targets exist. It looks for `@riproute/*`
 * adapter packages the app has installed, imports the `./adapter` descriptor
 * from the one it finds, and asks that for the server entry — so a new target
 * is a new package, never a new branch in here.
 *
 * Nitro stays special: it is not a riproute adapter but a whole build system
 * that takes over, and it is selected by its own Vite plugin being present.
 */

/** Adapter packages riproute knows to look for, most specific first. */
const KNOWN = ['@riproute/cloudflare', '@riproute/bun', '@riproute/node'] as const;

export type AdapterSelection = {
	adapter: RiprouteAdapter;
	/** The package it came from, for error messages. */
	from: string;
};

/**
 * Which adapter packages the app has taken a dependency on.
 *
 * Read from the app's own `package.json`, not from what happens to be
 * resolvable: in a workspace the root `node_modules` can hoist every adapter
 * into view, and "it is reachable" is not the same as "the app chose it". The
 * declaration is the choice. Resolution is still required, so a declared but
 * uninstalled adapter is reported as missing rather than silently used.
 */
export function installedAdapters(root: string): string[] {
	const require = createRequire(path.join(root, 'noop.js'));

	let declared: Set<string>;

	try {
		const manifest = JSON.parse(
			readFileSync(path.join(root, 'package.json'), 'utf-8')
		) as Record<string, Record<string, string> | undefined>;

		declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.devDependencies ?? {}),
		]);
	} catch {
		// No manifest to read (a fixture, an inline build): fall back to
		// whatever resolves, which is the best signal left.
		declared = new Set(KNOWN);
	}

	return KNOWN.filter((name) => {
		if (!declared.has(name)) return false;

		try {
			require.resolve(`${name}/package.json`);

			return true;
		} catch {
			return false;
		}
	});
}

/**
 * Resolves the adapter for this build, from what the app installed.
 *
 * There is no `adapter` option: the dependency *is* the choice. Exactly one
 * adapter package is required — zero means the app never picked a target, and
 * more than one is ambiguous rather than a default worth guessing at.
 */
export async function resolveAdapterPackage(root: string): Promise<AdapterSelection> {
	const found = installedAdapters(root);

	if (found.length === 1) {
		return { adapter: await importAdapter(root, found[0]), from: found[0] };
	}

	if (found.length === 0) {
		throw new Error(
			'[riproute] No adapter installed. Add the package for your target — ' +
				`${KNOWN.join(', ')} — or add nitro() from 'nitro/vite' to \`plugins\`.`
		);
	}

	throw new Error(
		`[riproute] Several adapters are installed (${found.join(', ')}), so the ` +
			'target is ambiguous. Keep only the one you deploy to.'
	);
}

async function importAdapter(root: string, specifier: string): Promise<RiprouteAdapter> {
	const require = createRequire(path.join(root, 'noop.js'));

	let resolved: string;

	try {
		resolved = require.resolve(`${specifier}/adapter`);
	} catch {
		throw new Error(
			`[riproute] Could not load the adapter "${specifier}". Install it, or ` +
				'check that it exports an `./adapter` entry.'
		);
	}

	const module = (await import(pathToUrl(resolved))) as {
		default?: RiprouteAdapter;
		adapter?: RiprouteAdapter;
	};
	const adapter = module.default ?? module.adapter;

	if (adapter === undefined || typeof adapter.entry !== 'function') {
		throw new Error(
			`[riproute] "${specifier}/adapter" does not export a riproute adapter. ` +
				'It should `export default defineAdapter({ ... })`.'
		);
	}

	return adapter;
}

function pathToUrl(file: string): string {
	return file.startsWith('file:') ? file : `file://${file.replace(/\\/g, '/')}`;
}
