import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: { index: 'src/index.ts', adapter: 'src/adapter.ts' },
	outDir: 'dist',
	format: 'esm',
	platform: 'node',
	target: 'node20',
	dts: { resolve: [/^@riproute\//] },
	clean: true,
});
