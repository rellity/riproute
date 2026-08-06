import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { compile } from 'ripple/compiler';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const resolve = (relative: string): string => path.join(here, relative);

import { isRiprouteSource } from './packages/vite/src/package-root';
import { rewriteTitles } from './packages/vite/src/title-rewrite';

/**
 * Minimal `.tsrx` transform.
 *
 * `@ripple-ts/vite-plugin` also wires up SSR routing, HMR and config loading,
 * none of which the tests need — they need the compiler pointed at the right
 * mode, plus the literal `<title>` rewrite so a test can author exactly what an
 * app authors.
 */
function tsrx(mode: 'client' | 'server'): Plugin {
	return {
		name: 'riproute:tsrx',
		enforce: 'pre',
		async transform(code, id) {
			if (!id.endsWith('.tsrx')) return null;

			// riproute's own components are exempt for the same reason as in the
			// plugin: `title-head.tsrx` holds the one real <title>.
			const source = isRiprouteSource(id) ? code : await rewriteTitles(code, id);
			const compiled = await compile(source, id, { mode, dev: false });

			return { code: compiled.code, map: compiled.map };
		},
	};
}

/**
 * Workspace packages resolve to source in tests.
 *
 * The packages are not built when the suite runs, and pointing at `dist/`
 * would test yesterday's output. `@riproute/adapter-kit/node` has to come
 * before the bare specifier so the subpath is not swallowed by it.
 */
const workspace = [
	{
		find: '@riproute/adapter-kit/node',
		replacement: resolve('packages/adapter-kit/src/node.ts'),
	},
	{ find: '@riproute/adapter-kit', replacement: resolve('packages/adapter-kit/src/index.ts') },
	{
		find: '@riproute/riproute/server-only',
		replacement: resolve('packages/riproute/src/server-only.ts'),
	},
	{
		find: '@riproute/riproute/server',
		replacement: resolve('packages/riproute/src/server/index.ts'),
	},
	{ find: '@riproute/riproute', replacement: resolve('packages/riproute/src/index.ts') },
	{
		find: '@riproute/router/primitives',
		replacement: resolve('packages/router/src/primitives.ts'),
	},
	{ find: '@riproute/router', replacement: resolve('packages/router/src/index.ts') },
	{ find: '@riproute/node', replacement: resolve('packages/node/src/index.ts') },
	{ find: '@riproute/bun', replacement: resolve('packages/bun/src/index.ts') },
	{ find: '@riproute/cloudflare', replacement: resolve('packages/cloudflare/src/index.ts') },
];

const shared = {
	resolve: { extensions: ['.tsrx', '.ts', '.js', '.json'], alias: workspace },
	esbuild: { target: 'esnext' },
};

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/**'],
			// The generated-code templates and the e2e harness are exercised by
			// the browser suite, which V8 coverage cannot see.
			exclude: ['src/types/**', 'types/**'],
			reporter: ['text', 'html'],
		},
		projects: [
			{
				...shared,
				plugins: [tsrx('client')],
				resolve: {
					...shared.resolve,
					// jsdom is still Node as far as resolution goes, so the
					// browser condition has to be asked for explicitly —
					// otherwise `ripple` hands back its server runtime.
					conditions: ['browser', 'import', 'module', 'default'],
				},
				test: {
					name: 'client',
					environment: 'jsdom',
					include: ['tests/client/**/*.test.tsrx'],
					setupFiles: ['tests/setup-client.ts'],
				},
			},
			{
				...shared,
				plugins: [tsrx('server')],
				resolve: {
					...shared.resolve,
					// `ripple` must resolve to its server build here, the same
					// way the metaframework resolves it during SSR.
					alias: [...workspace, { find: /^ripple$/, replacement: 'ripple/server' }],
				},
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/server/**/*.test.tsrx'],
					setupFiles: ['tests/setup-server.ts'],
				},
			},
			{
				...shared,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.test.ts'],
				},
			},
			{
				...shared,
				test: {
					name: 'integration',
					environment: 'node',
					include: ['tests/integration/**/*.test.ts'],
					// Real Vite builds, so a per-test default of 5s is too tight.
					testTimeout: 60_000,
				},
			},
		],
	},
});
