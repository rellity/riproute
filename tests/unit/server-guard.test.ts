import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '../../src/vite/package-root';
import {
	analyzeServerOnly,
	classifySpecifier,
	isServerOnlyPath,
	matchGlob,
	mightBeServerPath,
} from '../../src/vite/server-guard';

const ROOT = '/app';
const at = (...parts: string[]) => path.join(ROOT, ...parts);

describe('classifySpecifier', () => {
	it('recognises Node built-ins with and without the prefix', () => {
		expect(classifySpecifier('node:fs')).toBe('builtin');
		expect(classifySpecifier('fs')).toBe('builtin');
		expect(classifySpecifier('node:child_process')).toBe('builtin');
		expect(classifySpecifier('node:sqlite')).toBe('builtin');
	});

	it("recognises riproute's server entries", () => {
		expect(classifySpecifier('riproute/server')).toBe('entry');
		expect(classifySpecifier('riproute/adapter-node')).toBe('entry');
		expect(classifySpecifier('riproute/server-only')).toBe('entry');
	});

	it('leaves ordinary imports alone', () => {
		expect(classifySpecifier('riproute')).toBeNull();
		expect(classifySpecifier('riproute/vite')).toBeNull();
		expect(classifySpecifier('./thing')).toBeNull();
		expect(classifySpecifier('lodash-es')).toBeNull();
	});
});

describe('mightBeServerPath', () => {
	it('matches the shapes worth resolving', () => {
		// An import specifier normally omits the extension.
		expect(mightBeServerPath('../data.server')).toBe(true);
		expect(mightBeServerPath('./db.server.ts')).toBe(true);
		expect(mightBeServerPath('$lib/server/db')).toBe(true);
		expect(mightBeServerPath('../server')).toBe(true);
	});

	it('does not pay for ordinary imports', () => {
		expect(mightBeServerPath('./utils')).toBe(false);
		expect(mightBeServerPath('ripple')).toBe(false);
		expect(mightBeServerPath('./observer')).toBe(false);
	});
});

describe('isServerOnlyPath', () => {
	it('matches the default conventions', () => {
		expect(isServerOnlyPath(at('src/data.server.ts'), { root: ROOT })).toBe(true);
		expect(isServerOnlyPath(at('src/routes/api.server.tsrx'), { root: ROOT })).toBe(true);
		expect(isServerOnlyPath(at('src/lib/server/db.ts'), { root: ROOT })).toBe(true);
		expect(isServerOnlyPath(at('src/lib/server/nested/deep.ts'), { root: ROOT })).toBe(true);
		expect(isServerOnlyPath(at('src/server/secrets.ts'), { root: ROOT })).toBe(true);
	});

	it('leaves everything else alone', () => {
		expect(isServerOnlyPath(at('src/utils.ts'), { root: ROOT })).toBe(false);
		expect(isServerOnlyPath(at('src/lib/observer.ts'), { root: ROOT })).toBe(false);
		expect(isServerOnlyPath(at('src/serverless.ts'), { root: ROOT })).toBe(false);
	});

	it('honours include and exclude', () => {
		expect(isServerOnlyPath(at('src/db/pool.ts'), { root: ROOT })).toBe(false);
		expect(isServerOnlyPath(at('src/db/pool.ts'), { root: ROOT, include: ['src/db/**'] })).toBe(
			true
		);
		expect(
			isServerOnlyPath(at('src/server/safe.ts'), {
				root: ROOT,
				exclude: ['src/server/safe.ts'],
			})
		).toBe(false);
	});

	it('ignores dependencies, which declare their own entry points', () => {
		expect(isServerOnlyPath('/elsewhere/src/server/db.ts', { root: ROOT })).toBe(false);
		// The directory conventions are anchored at the project root, so a
		// dependency's own `src/server/` is none of our business.
		expect(isServerOnlyPath(at('node_modules/x/src/server/db.ts'), { root: ROOT })).toBe(false);
	});

	it("never matches riproute's own source, which defines the convention", () => {
		const own = path.join(PACKAGE_ROOT, 'src/server/index.ts');

		expect(isServerOnlyPath(own, { root: PACKAGE_ROOT })).toBe(false);
	});
});

describe('analyzeServerOnly', () => {
	it('flags a secret read from process.env', () => {
		expect(analyzeServerOnly('export const url = process.env.DATABASE_URL;')).toMatchObject({
			what: 'reads process.env.DATABASE_URL',
			lineNumber: 1,
		});
		expect(analyzeServerOnly("const k = process.env['API_KEY'];")).toMatchObject({
			what: 'reads process.env.API_KEY',
		});
	});

	it('allows the env vars a browser bundle actually gets', () => {
		expect(analyzeServerOnly('const dev = process.env.NODE_ENV !== "production";')).toBeNull();
		expect(analyzeServerOnly('const url = process.env.VITE_API_URL;')).toBeNull();
	});

	it('takes deliberate feature detection at its word', () => {
		const code = 'const port = typeof process !== "undefined" ? process.env.PORT : 0;';

		expect(analyzeServerOnly(code)).toBeNull();
	});

	it('flags a database driver', () => {
		expect(analyzeServerOnly("import { Pool } from 'pg';")).toMatchObject({
			what: 'imports "pg", which needs a server',
		});
		expect(analyzeServerOnly("import { S3 } from '@aws-sdk/client-s3';")).toMatchObject({
			what: 'imports "@aws-sdk/client-s3", which needs a server',
		});
		expect(analyzeServerOnly("const pg = require('pg');")).not.toBeNull();
		expect(analyzeServerOnly("await import('mongodb');")).not.toBeNull();
	});

	it('ignores a type-only import, which never reaches the bundle', () => {
		expect(analyzeServerOnly("import type { Pool } from 'pg';")).toBeNull();
	});

	it('does not confuse a lookalike package name', () => {
		expect(analyzeServerOnly("import x from '@stripe/stripe-js';")).toBeNull();
		expect(analyzeServerOnly("import x from 'pg-formatter-browser';")).toBeNull();
	});

	it('flags CommonJS-only globals', () => {
		expect(analyzeServerOnly('const here = __dirname;')).toMatchObject({
			what: 'uses __dirname',
		});
	});

	it('reports the offending line', () => {
		const found = analyzeServerOnly(
			'const a = 1;\nconst b = 2;\nconst c = process.env.SECRET;'
		);

		expect(found).toMatchObject({ lineNumber: 3, line: 'const c = process.env.SECRET;' });
	});

	it('can be turned off', () => {
		expect(analyzeServerOnly('process.env.SECRET', { analyze: false })).toBeNull();
	});

	it('says nothing about ordinary browser code', () => {
		expect(
			analyzeServerOnly("import { track } from 'ripple';\nexport const x = track(0);")
		).toBeNull();
	});
});

describe('matchGlob', () => {
	it('handles the patterns the conventions need', () => {
		expect(matchGlob('src/**', 'src/a/b.ts')).toBe(true);
		expect(matchGlob('src/**', 'src/a.ts')).toBe(true);
		expect(matchGlob('src/**', 'other/a.ts')).toBe(false);
		expect(matchGlob('**/*.server.{ts,js}', 'deep/nested/db.server.ts')).toBe(true);
		expect(matchGlob('**/*.server.{ts,js}', 'db.server.js')).toBe(true);
		expect(matchGlob('**/*.server.{ts,js}', 'db.servers.ts')).toBe(false);
		expect(matchGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
	});
});
