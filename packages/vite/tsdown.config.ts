import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts' },
	outDir: 'dist',
	format: 'esm',
	platform: 'node',
	target: 'node20',
	dts: true,
	clean: true,
	external: ['vite', 'ripple', 'ripple/compiler', 'ripple/server', '@riproute/adapter-kit'],
});
