import { builtinModules } from 'node:module';
import path from 'node:path';

import type { Plugin, ViteDevServer } from 'vite';

import { isClientEnvironment, isRiprouteSource, normalizeId } from './package-root';
import { collectServerFnExportsFromFile, isServerFnFile } from './server-fn';

/**
 * Keeps server-only code out of the browser bundle.
 *
 * Without this, a route that imports a database client or a secret gets it
 * bundled into the client chunk, and Vite downgrades a Node builtin in client
 * code to a *runtime* warning — so the first symptom is a broken production
 * page rather than a failed build. Everything here fails the build instead.
 */

export type ServerOnlyOptions = {
	/** Extra root-relative globs to treat as server-only. */
	include?: string[];
	/** Root-relative globs that opt back out of every rule here. */
	exclude?: string[];
	/**
	 * Inspect the contents of app modules for server-only code that carries no
	 * marker and no telling file name. On by default.
	 */
	analyze?: boolean;
};

/**
 * riproute specifiers that must never reach a browser.
 *
 * `riproute/server-only` is the interesting one: it exports nothing and exists
 * purely to be imported for its presence. A module marks itself with it, and
 * because imports are transitive, anything that pulls that module into the
 * client graph pulls the marker in too — and fails here, with the chain.
 */
const SERVER_ENTRIES = new Set([
	'@riproute/riproute/server',
	'@riproute/node',
	'@riproute/riproute/server-only',
]);

const BUILTINS = new Set([
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
	'node:sqlite',
	'node:test',
]);

/**
 * The default conventions, matched against the root-relative path.
 *
 * `*.server.*` is the per-file marker; the two directories are the per-area
 * one. Both are the shapes people already reach for, and both read as
 * server-only at a glance in an import statement.
 */
const DEFAULT_PATTERNS = [
	'**/*.server.{ts,tsx,mts,cts,js,jsx,mjs,cjs,tsrx}',
	'src/lib/server/**',
	'src/server/**',
];

/** What kind of rule matched, so the error can explain itself. */
export type ServerOnlyReason = 'builtin' | 'entry' | 'convention';

export type GuardOptions = ServerOnlyOptions & { root: string };

/**
 * Classifies a bare import specifier, before any resolution.
 *
 * Builtins and riproute's own entries are recognised from the specifier alone,
 * which is what keeps the guard off the hot path: the vast majority of imports
 * are answered here without a `this.resolve()` round trip.
 */
export function classifySpecifier(specifier: string): ServerOnlyReason | null {
	if (BUILTINS.has(specifier)) return 'builtin';
	if (specifier.startsWith('node:')) return 'builtin';
	if (SERVER_ENTRIES.has(specifier)) return 'entry';

	return null;
}

/**
 * Whether a specifier is worth resolving to check against the path
 * conventions. Only strings that already look server-only pay for resolution.
 */
export function mightBeServerPath(specifier: string): boolean {
	// `.server(\.|$)` rather than `.server.`: an import specifier normally omits
	// the extension, so `./db.server.ts` is written `'./db.server'`.
	return /\.server(\.|$)/.test(specifier) || /(^|[\\/])server([\\/]|$)/.test(specifier);
}

/** Whether a resolved file matches the server-only path conventions. */
export function isServerOnlyPath(file: string, options: GuardOptions): boolean {
	// riproute's own `src/server/` defines the convention; it must not trip it.
	if (isRiprouteSource(file)) return false;

	const relative = toPosix(path.relative(options.root, path.resolve(file)));

	// Outside the project root there is no convention to apply — that is a
	// dependency, and dependencies declare their own entry points.
	if (relative === '' || relative.startsWith('..')) return false;

	if ((options.exclude ?? []).some((pattern) => matchGlob(pattern, relative))) return false;

	return [...DEFAULT_PATTERNS, ...(options.include ?? [])].some((pattern) =>
		matchGlob(pattern, relative)
	);
}

/**
 * Packages that only work on a server.
 *
 * Deliberately short and specific. A long list of maybes would produce false
 * positives, and a false positive here fails someone's build. Entries ending in
 * `/` match by prefix.
 */
const SERVER_PACKAGES = [
	'@aws-sdk/',
	'@prisma/',
	'@sendgrid/',
	'argon2',
	'bcrypt',
	'bcryptjs',
	'better-sqlite3',
	'drizzle-orm/better-sqlite3',
	'drizzle-orm/node-postgres',
	'firebase-admin',
	'googleapis',
	'ioredis',
	'jsonwebtoken',
	'knex',
	'mongodb',
	'mongoose',
	'mysql',
	'mysql2',
	'nodemailer',
	'pg',
	'pg-native',
	'prisma',
	'redis',
	'sequelize',
	'sqlite3',
	'ssh2',
	'stripe',
	'typeorm',
];

export type ServerOnlyEvidence = {
	/** What was found, phrased for the error message. */
	what: string;
	/** The offending source line, trimmed. */
	line: string;
	/** 1-based line number. */
	lineNumber: number;
};

/**
 * Looks for server-only code in a module that carries no marker and no telling
 * file name.
 *
 * The convention and the marker only catch code someone remembered to label.
 * Most leaks are not labelled — a helper grows a `process.env.DATABASE_URL`
 * read, a route imports it, and the secret is in the client chunk. These three
 * signals are the ones with no legitimate browser meaning:
 *
 * - `process.env.X` — Vite defines nothing but `process.env.NODE_ENV` for the
 *   browser, so every other access is already a `process is not defined` waiting
 *   to happen. Not a heuristic; a bug either way.
 * - a runtime import of a database driver, a mailer, a cloud SDK.
 * - `__dirname`, `__filename`, `require()` — CommonJS/Node-only globals.
 *
 * Type-only imports are ignored: they vanish before the bundle exists.
 */
export function analyzeServerOnly(
	code: string,
	options: { analyze?: boolean } = {}
): ServerOnlyEvidence | null {
	if (options.analyze === false) return null;

	return findProcessEnv(code) ?? findServerPackage(code) ?? findNodeGlobal(code);
}

const PROCESS_ENV =
	/\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g;

function findProcessEnv(code: string): ServerOnlyEvidence | null {
	if (!code.includes('process.env') && !code.includes('process ')) return null;

	// Code that feature-detects `process` is deliberately isomorphic; taking it
	// at its word is cheaper than trying to prove the guard covers every access.
	if (code.includes('typeof process')) return null;

	for (const match of code.matchAll(PROCESS_ENV)) {
		const name = match[1] ?? match[2];

		// `NODE_ENV` is replaced by every bundler; `VITE_`-prefixed names are
		// the ones Vite deliberately publishes to the client.
		if (name === 'NODE_ENV' || name.startsWith('VITE_')) continue;

		return evidence(code, match.index, `reads process.env.${name}`);
	}

	return null;
}

const IMPORT_FROM = /^[ \t]*(?:import|export)\s+(?!type[\s{])[^;'"]*?from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const REQUIRE_OR_DYNAMIC = /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;

function findServerPackage(code: string): ServerOnlyEvidence | null {
	for (const pattern of [IMPORT_FROM, BARE_IMPORT, REQUIRE_OR_DYNAMIC]) {
		pattern.lastIndex = 0;

		for (const match of code.matchAll(pattern)) {
			const specifier = match[1];
			const hit = SERVER_PACKAGES.find((name) =>
				name.endsWith('/') ? specifier.startsWith(name) : specifier === name
			);

			if (hit !== undefined) {
				return evidence(code, match.index, `imports "${specifier}", which needs a server`);
			}
		}
	}

	return null;
}

const NODE_GLOBAL = /\b(__dirname|__filename)\b/;

function findNodeGlobal(code: string): ServerOnlyEvidence | null {
	const match = NODE_GLOBAL.exec(code);

	return match === null ? null : evidence(code, match.index, `uses ${match[1]}`);
}

function evidence(code: string, index: number, what: string): ServerOnlyEvidence {
	const before = code.slice(0, index);
	const lineNumber = before.split('\n').length;
	const start = before.lastIndexOf('\n') + 1;
	const end = code.indexOf('\n', index);

	return {
		what,
		line: code.slice(start, end === -1 ? code.length : end).trim(),
		lineNumber,
	};
}

/**
 * Formats the build failure.
 *
 * The chain is the point. "Something imports node:fs" is not actionable; the
 * route file that pulled it in is.
 */
export function formatServerOnlyError(
	target: string,
	reason: ServerOnlyReason,
	chain: string[]
): string {
	const what =
		reason === 'builtin'
			? `"${target}" is a Node built-in module and`
			: target === '@riproute/riproute/server-only'
				? 'A module marked `import "@riproute/riproute/server-only"`'
				: reason === 'entry'
					? `"${target}" runs only on the server and`
					: target;

	const trace = [`  ${target}`, ...chain.map((link) => `    imported by ${link}`)].join('\n');

	const hint =
		reason === 'convention'
			? 'Server-only modules match *.server.*, src/lib/server/** and src/server/**,\n' +
				'and anything importing "@riproute/riproute/server-only".\n' +
				'To call a function in a *.server.* file from the browser, export it\n' +
				'wrapped in serverFn() from "@riproute/riproute/server".'
			: '';

	return [
		`[riproute] ${what} cannot be imported into client-side code.`,
		'',
		trace,
		'',
		hint,
		'Split the browser-safe part into its own module, or load the data on the',
		'server and pass it to the route as props.',
	]
		.filter((line, index, all) => !(line === '' && all[index - 1] === ''))
		.join('\n');
}

/** Formats a build failure for a module the content analysis flagged. */
export function formatAnalysisError(
	file: string,
	found: ServerOnlyEvidence,
	chain: string[]
): string {
	return [
		`[riproute] ${file} ${found.what}, so it cannot run in the browser.`,
		'',
		`  ${file}:${found.lineNumber}`,
		`    ${found.line}`,
		...chain.map((link) => `    imported by ${link}`),
		'',
		'Move it to the server and pass the result to the route as props. Mark it',
		'with `import "@riproute/riproute/server-only"` to make that explicit.',
		'',
		'If this really is browser-safe, add the path to',
		'`riproute({ serverOnly: { exclude: [...] } })`, or turn the check off',
		'with `serverOnly: { analyze: false }`.',
	].join('\n');
}

/**
 * The plugin.
 *
 * `resolveId` is the hook for imports: it is the only one that knows *who* is
 * importing, and the importer is the actionable half of the error. `transform`
 * is the hook for contents, because that is where the source is.
 */
export function serverGuardPlugin(options: ServerOnlyOptions = {}): Plugin {
	let root = process.cwd();
	let devServer: ViteDevServer | null = null;

	return {
		name: 'riproute:server-guard',
		enforce: 'pre',
		// The server bundle is allowed to import all of this — that is the point
		// of it. Only the browser graph is policed.
		applyToEnvironment: (environment) => isClientEnvironment(environment),

		configResolved(config) {
			root = config.root;
		},

		configureServer(server) {
			devServer = server;
		},

		async resolveId(specifier, importer) {
			if (importer === undefined || !isClientEnvironment(this.environment)) return null;

			let reason = classifySpecifier(specifier);
			let target = specifier;

			// riproute's server entries are unambiguous wherever they come from,
			// including a dependency — that is what makes the `server-only`
			// marker work through library code. Everything else is policed only
			// in the app's own source: a dependency importing `node:fs` behind a
			// browser field is normal, and Vite's resolver, which runs after this
			// `pre` hook, is the thing that sorts it out.
			if (reason !== 'entry' && !isProjectSource(importer, root)) return null;

			if (reason === null) {
				if (!mightBeServerPath(specifier)) return null;

				const resolved = await this.resolve(specifier, importer, { skipSelf: true });

				if (resolved === null || resolved.external === true) return null;

				const file = cleanUrl(resolved.id);

				if (!isServerOnlyPath(file, { ...options, root })) return null;

				// A `*.server.*` file with `serverFn()` exports is the one sanctioned
				// crossing: the import is allowed through, and the server-fn plugin's
				// `load` hook swaps the module for RPC stubs before any client
				// transform can see the real code. Everything else stays refused —
				// including suffix files with nothing marked, whose error below now
				// says how to mark them.
				if (
					isServerFnFile(file) &&
					(await collectServerFnExportsFromFile(file)).length > 0
				) {
					return null;
				}

				reason = 'convention';
				target = display(file, root);
			}

			return this.error(
				formatServerOnlyError(target, reason, buildChain(importer, root, this, devServer))
			);
		},

		/**
		 * The unmarked case.
		 *
		 * A module only reaches here if it is already in the client graph, so by
		 * the time the analysis finds a `process.env.DATABASE_URL` the import
		 * that pulled it in exists — and the chain names it.
		 */
		transform(code, id) {
			if (!isClientEnvironment(this.environment)) return null;

			const file = cleanUrl(id);

			if (!isProjectSource(id, root)) return null;

			const relative = toPosix(path.relative(root, file));

			if ((options.exclude ?? []).some((pattern) => matchGlob(pattern, relative)))
				return null;

			const found = analyzeServerOnly(code, options);

			if (found === null) return null;

			return this.error(
				formatAnalysisError(
					relative,
					found,
					buildChain(file, root, this, devServer).slice(1)
				)
			);
		},
	};
}

/**
 * Walks importers back towards an entry.
 *
 * Best effort by design: the graph is fully populated during a build and in a
 * warm dev server, but a cold first request may know only the direct importer.
 * One link is still enough to act on.
 */
function buildChain(
	from: string,
	root: string,
	ctx: { getModuleInfo: (id: string) => { importers?: readonly string[] } | null },
	devServer: ViteDevServer | null
): string[] {
	const chain: string[] = [];

	for (let current: string | undefined = from, hop = 0; current && hop < 10; hop++) {
		const label = display(cleanUrl(current), root);

		if (chain.includes(label)) break;

		chain.push(label);
		current = importersOf(current, ctx, devServer)[0];
	}

	return chain;
}

function importersOf(
	id: string,
	ctx: { getModuleInfo: (id: string) => { importers?: readonly string[] } | null },
	devServer: ViteDevServer | null
): string[] {
	const fromBundle = ctx.getModuleInfo(id)?.importers;

	if (fromBundle !== undefined && fromBundle.length > 0) return [...fromBundle];

	const node = devServer?.environments.client.moduleGraph.getModuleById(id);

	return node === undefined || node === null
		? []
		: [...node.importers]
				.map((importer) => importer.id)
				.filter((value): value is string => value !== null);
}

/** Whether `id` is a real file in the app, as opposed to a dependency or a virtual module. */
function isProjectSource(id: string, root: string): boolean {
	if (id.startsWith('\0') || id.includes('\0')) return false;

	// Posix on both sides: Vite ids use `/` on every OS, `root` may not.
	const file = normalizeId(cleanUrl(id));

	if (!path.isAbsolute(file)) return false;
	if (file.includes('/node_modules/')) return false;
	if (isRiprouteSource(file)) return false;

	return file.startsWith(`${normalizeId(root)}/`);
}

/** Root-relative where possible — an absolute path in an error is mostly noise. */
function display(id: string, root: string): string {
	const relative = toPosix(path.relative(root, id));

	return relative === '' || relative.startsWith('..') ? id : relative;
}

function cleanUrl(id: string): string {
	return id.split('?')[0];
}

function toPosix(value: string): string {
	return normalizeId(value);
}

/**
 * Minimal glob matcher: `**`, `*`, `?` and `{a,b}` alternation.
 *
 * A dependency for this would be three transitive packages to audit; the
 * patterns a route layout needs are this small.
 */
export function matchGlob(pattern: string, value: string): boolean {
	return globToRegExp(pattern).test(value);
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
	const cached = globCache.get(pattern);

	if (cached !== undefined) return cached;

	let source = '';

	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];

		if (char === '*') {
			if (pattern[index + 1] === '*') {
				// `**/` also matches zero directories, so `src/**/x` finds `src/x`.
				if (pattern[index + 2] === '/') {
					source += '(?:[^/]*(?:/|$))*';
					index += 2;
				} else {
					source += '.*';
					index += 1;
				}
			} else {
				source += '[^/]*';
			}

			continue;
		}

		if (char === '?') {
			source += '[^/]';
			continue;
		}

		if (char === '{') {
			const close = pattern.indexOf('}', index);

			if (close !== -1) {
				const options = pattern
					.slice(index + 1, close)
					.split(',')
					.map(escapeRegExp);

				source += `(?:${options.join('|')})`;
				index = close;
				continue;
			}
		}

		source += escapeRegExp(char);
	}

	const regexp = new RegExp(`^${source}$`);

	globCache.set(pattern, regexp);

	return regexp;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
