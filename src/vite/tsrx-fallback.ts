import path from 'node:path';

import { compile } from 'ripple/compiler';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Compiles the `.tsrx` ids `@ripple-ts/vite-plugin` provably misses.
 *
 * That plugin's compile step filters on `/\.tsrx$/` — anchored at the end of
 * the id. When riproute is a *real* dependency (installed from the GitHub ref,
 * physically inside `node_modules`) it lands in `optimizeDeps.exclude`, and
 * Vite appends a `?v=<hash>` cache-busting query to its module URLs. The
 * anchored filter never matches `not-found.tsrx?v=…`, raw `.tsrx` reaches
 * Vite's import analysis, and the dev server fails with "invalid JS syntax".
 * A workspace symlink resolves outside `node_modules` and never gets the
 * query, which is exactly why local development did not catch it.
 *
 * This is a safety net, not a return to owning the compile: `enforce: 'post'`
 * means it runs after Ripple's own transform phase and only ever sees what
 * that plugin left untouched — bare `.tsrx` ids stay its job. Should upstream
 * fix its filter, the source check below turns this into a no-op.
 */

/** Only ids with a query — the exact class the anchored filter misses. */
const QUERIED_TSRX = /\.tsrx\?/;

const STYLE_QUERY = '?riproute-style.css';

export function tsrxFallbackPlugin(): Plugin {
	const styles = new Map<string, string>();

	let config: ResolvedConfig;

	return {
		name: 'riproute:tsrx-fallback',
		enforce: 'post',

		configResolved(resolved) {
			config = resolved;
		},

		resolveId(id) {
			return id.endsWith(STYLE_QUERY) ? id : null;
		},

		load(id) {
			return styles.get(id) ?? null;
		},

		async transform(code, id, options) {
			if (!QUERIED_TSRX.test(id)) return null;

			// Still-uncompiled `.tsrx` source, recognisable by a component body.
			// Compiled output never contains `@{`, so a future upstream fix that
			// starts matching query ids makes this plugin inert, not a
			// double-compiler.
			if (!/@\{/.test(code)) return null;

			// The title rewrite already ran: `titleRewritePlugin` is
			// `enforce: 'pre'` and matches query ids. Only the compile is missing.
			const file = id.split('?')[0];
			const ssr = options?.ssr === true || this.environment?.config.consumer === 'server';
			const dev = config.command === 'serve';
			const filename = id.startsWith(config.root) ? id.slice(config.root.length) : id;

			const compiled = await compile(code, filename, {
				mode: ssr ? 'server' : 'client',
				dev,
				// Ripple's HMR runtime is client-only; asking for it during SSR
				// emits `import.meta.hot` calls Node has nothing to answer with.
				hmr: dev && !ssr,
			});

			let output = compiled.code;

			if (compiled.css) {
				const styleId = `${toPosix(path.relative(config.root, file))}${STYLE_QUERY}`;

				styles.set(styleId, compiled.css);
				output += `\nimport ${JSON.stringify(`/${styleId}`)};\n`;
			}

			return { code: output, map: compiled.map };
		},
	};
}

function toPosix(value: string): string {
	return value.split(path.sep).join('/');
}
