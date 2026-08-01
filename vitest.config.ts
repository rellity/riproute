import { compile } from 'ripple/compiler';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Minimal `.tsrx` transform.
 *
 * The real `@ripple-ts/vite-plugin` also wires up SSR routing, HMR and config
 * loading, none of which the unit tests need — they only need the compiler,
 * pointed at the right mode.
 */
function tsrx(mode: 'client' | 'server'): Plugin {
	return {
		name: 'ripple-router:tsrx',
		enforce: 'pre',
		async transform(code, id) {
			if (!id.endsWith('.tsrx')) return null;

			const compiled = await compile(code, id, { mode, dev: false });

			return { code: compiled.code, map: compiled.map };
		},
	};
}

const shared = {
	resolve: { extensions: ['.tsrx', '.ts', '.js', '.json'] },
	esbuild: { target: 'esnext' },
};

export default defineConfig({
	test: {
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
					alias: [{ find: /^ripple$/, replacement: 'ripple/server' }],
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
		],
	},
});
