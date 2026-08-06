import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'ripple/compiler';
import type { Plugin } from 'vite';

import { isClientEnvironment, normalizeId } from './package-root';

/**
 * The bundler half of server functions.
 *
 * A `*.server.ts` module is real code on the server. In the client graph it
 * is swapped, at `load` time, for a module of stubs — one per `serverFn()`
 * export, each POSTing to the RPC endpoint. Only the marked exports exist in
 * the swap: importing anything else from the file in client code fails import
 * analysis with a missing-export error, which keeps the rest of the module as
 * server-only as it always was.
 */

/** The file convention. Same suffix rule the server-guard enforces. */
const SERVER_FILE = /\.server\.(ts|js|mts|mjs|tsx|jsx)$/;

export function isServerFnFile(file: string): boolean {
	return SERVER_FILE.test(file);
}

type Node = Record<string, any>;

/**
 * The names exported as `serverFn(...)` calls, statically.
 *
 * Only initializers rooted in a call to a binding imported as `serverFn` from
 * `'@riproute/riproute/server'` count — a local function that happens to share the name
 * does not. Covers `export const x = serverFn(...)`, the builder chain
 * `export const x = serverFn().middleware(m).handler(fn)` (multi-declarator
 * too) and `export default serverFn(...)`; anything fancier can re-export a
 * const.
 */
export async function collectServerFnExports(source: string, filename: string): Promise<string[]> {
	// Cheap gate before parsing: no mention, no exports.
	if (!source.includes('serverFn')) return [];

	const ast = (await parse(source, filename)) as Node;
	const body = (ast.body ?? ast.program?.body ?? []) as Node[];

	const aliases = new Set<string>();

	for (const statement of body) {
		if (statement.type !== 'ImportDeclaration') continue;
		if (statement.source?.value !== '@riproute/riproute/server') continue;

		for (const specifier of statement.specifiers ?? []) {
			if (
				specifier.type === 'ImportSpecifier' &&
				specifier.imported?.name === 'serverFn' &&
				typeof specifier.local?.name === 'string'
			) {
				aliases.add(specifier.local.name);
			}
		}
	}

	if (aliases.size === 0) return [];

	// `serverFn(fn)` and the builder chain `serverFn().middleware(m).handler(fn)`
	// both count: walk member-call chains down to the innermost callee.
	const rootCalleeName = (node: Node | null | undefined): string | null => {
		let current = node;

		while (current?.type === 'CallExpression') {
			const callee = current.callee as Node | undefined;

			if (callee?.type === 'Identifier') return callee.name as string;

			if (callee?.type === 'MemberExpression') {
				current = callee.object as Node;
				continue;
			}

			return null;
		}

		return null;
	};

	const isServerFnCall = (node: Node | null | undefined): boolean => {
		const name = rootCalleeName(node);

		return name !== null && aliases.has(name);
	};

	const names: string[] = [];

	for (const statement of body) {
		if (statement.type === 'ExportDefaultDeclaration') {
			if (isServerFnCall(statement.declaration)) names.push('default');
			continue;
		}

		if (statement.type !== 'ExportNamedDeclaration') continue;

		const declaration = statement.declaration;

		if (declaration?.type !== 'VariableDeclaration') continue;

		for (const declarator of declaration.declarations ?? []) {
			if (
				declarator.id?.type === 'Identifier' &&
				typeof declarator.id.name === 'string' &&
				isServerFnCall(declarator.init)
			) {
				names.push(declarator.id.name);
			}
		}
	}

	return names;
}

/** Reads a file and collects its `serverFn` exports; `[]` when unreadable. */
export async function collectServerFnExportsFromFile(file: string): Promise<string[]> {
	let source: string;

	try {
		source = await fs.promises.readFile(file, 'utf-8');
	} catch {
		return [];
	}

	return collectServerFnExports(source, file);
}

/** Every `*.server.*` file under `<root>/src`, as absolute paths. */
export function scanServerFnFiles(root: string): string[] {
	const out: string[] = [];

	const walk = (dir: string): void => {
		let entries: fs.Dirent[];

		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

				walk(full);
				continue;
			}

			if (entry.isFile() && SERVER_FILE.test(entry.name)) out.push(full);
		}
	};

	walk(path.join(root, 'src'));

	return out;
}

/**
 * The wire id of one function: a hash of its root-relative path and export
 * name, so the endpoint is stable across builds but the app's file layout
 * never appears in the client bundle. Client stub and server table both
 * derive it from the same strings, which is the entire contract.
 */
export function serverFnHash(file: string, root: string, name: string): string {
	const id = `${normalizeId(path.relative(root, file))}#${name}`;

	return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
}

/**
 * The client-side swap for one `*.server.ts` module.
 */
export function generateServerFnProxyModule(
	file: string,
	root: string,
	names: readonly string[]
): string {
	const lines = [
		'// Generated by riproute. The real module runs on the server only.',
		"import { createServerFnStub } from '@riproute/router';",
		'',
	];

	for (const name of names) {
		const stub = `createServerFnStub(${JSON.stringify(
			serverFnHash(file, root, name)
		)}, ${JSON.stringify(name)})`;

		lines.push(
			name === 'default' ? `export default ${stub};` : `export const ${name} = ${stub};`
		);
	}

	return lines.join('\n');
}

/**
 * Swaps `*.server.ts` modules for stubs in the client graph.
 *
 * A `load` hook, deliberately: it runs before every transform, so neither the
 * Ripple compiler nor the server-guard's content analysis ever sees the real
 * module in a client build. Files with no `serverFn` exports are left alone —
 * the guard's `resolveId` hook has already refused the import by then.
 */
export function serverFnClientPlugin(): Plugin {
	let root = process.cwd();

	return {
		name: 'riproute:server-fn',
		enforce: 'pre',

		configResolved(config) {
			root = config.root;
		},

		async load(id) {
			if (!isClientEnvironment(this.environment)) return null;

			const file = id.split('?')[0];

			if (!SERVER_FILE.test(file) || normalizeId(file).includes('/node_modules/'))
				return null;

			const names = await collectServerFnExportsFromFile(file);

			if (names.length === 0) return null;

			return { code: generateServerFnProxyModule(file, root, names) };
		},
	};
}
