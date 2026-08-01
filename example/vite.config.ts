import { ripple } from '@ripple-ts/vite-plugin';
import { riproute } from 'riproute/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// riproute does not wrap `ripple()` — that plugin owns `.tsrx` compilation,
	// scoped CSS and HMR, and stays yours to configure.
	plugins: [riproute({ title: 'riproute' }), ripple()],
	build: { target: 'esnext' },
});
