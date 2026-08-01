import { defineConfig } from 'tsdown';

/**
 * Only the parts that run outside Vite are built.
 *
 * `riproute` and `riproute/server` ship as source: they import `.tsrx`, which
 * no bundler outside the app's own Vite pipeline can compile. The plugin and
 * the adapter are plain TypeScript loaded by Node — `vite.config.ts` imports
 * the first before Vite exists, and the second is the production entry.
 */
export default defineConfig({
	entry: {
		'vite/index': 'src/vite/index.ts',
		'adapter-node/index': 'src/adapter-node/index.ts',
	},
	outDir: 'dist',
	format: 'esm',
	platform: 'node',
	target: 'node20',
	dts: true,
	clean: true,
	external: ['vite', 'ripple', 'ripple/compiler', 'ripple/server', 'riproute'],
});
