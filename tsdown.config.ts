import { defineConfig } from 'tsdown';

/**
 * Only the parts that run outside Vite are built.
 *
 * `riproute` and `riproute/server` ship as source: they import `.tsrx`, which
 * no bundler outside the app's own Vite pipeline can compile. The plugin and
 * the adapters are plain TypeScript loaded by the runtime — `vite.config.ts`
 * imports the plugin before Vite exists, and an adapter is the production entry.
 *
 * The adapters are separate entries on purpose: the shared static/compression
 * code is bundled into each, but neither pulls the other's runtime bootstrap,
 * so a build that targets one runtime never carries the other's server code.
 */
export default defineConfig({
	entry: {
		'vite/index': 'src/vite/index.ts',
		'adapter-node/index': 'src/adapter-node/index.ts',
		'adapter-bun/index': 'src/adapter-bun/index.ts',
	},
	outDir: 'dist',
	format: 'esm',
	platform: 'node',
	target: 'node20',
	dts: true,
	clean: true,
	external: ['vite', 'ripple', 'ripple/compiler', 'ripple/server', 'riproute'],
});
