import { riproute } from 'riproute/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [riproute({ title: 'riproute' })],
	build: { target: 'esnext' },
});
