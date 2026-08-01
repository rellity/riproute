import path from 'node:path';

import { compile } from 'ripple/compiler';
import type { Plugin, ResolvedConfig } from 'vite';

const TSRX = /\.tsrx$/;
const STYLE_QUERY = '?riproute-style.css';

/**
 * Compiles `.tsrx` through Ripple's compiler.
 *
 * riproute does not compose with `@ripple-ts/vite-plugin`. That plugin is a
 * whole metaframework — it registers its SSR middleware ahead of Vite's own,
 * owns `index.html`, and reads `ripple.config.ts`. Every one of those fought
 * the router in practice. The part we actually need is this: `compile()`, plus
 * a virtual module for the scoped CSS it extracts.
 */
export function tsrxPlugin(): Plugin {
	const styles = new Map<string, string>();

	let config: ResolvedConfig;

	return {
		name: 'riproute:tsrx',
		enforce: 'pre',

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
			if (!TSRX.test(id.split('?')[0])) return null;

			// `this.environment` is the reliable signal in Vite 6+; the `ssr`
			// flag is still passed for `ssrLoadModule`.
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
				const styleId = `${toPosix(path.relative(config.root, id.split('?')[0]))}${STYLE_QUERY}`;

				styles.set(styleId, compiled.css);
				output += `\nimport ${JSON.stringify(`/${styleId}`)};\n`;
			}

			return { code: output, map: compiled.map };
		},

		/**
		 * Keeps extracted CSS in step with the component it came from.
		 *
		 * Re-running the transform through Vite refreshes the style cache as a
		 * side effect; without adding the style module to the update the
		 * browser keeps the previous stylesheet until a full reload.
		 */
		hotUpdate: {
			order: 'pre',
			async handler({ file, modules }) {
				if (this.environment.name !== 'client' || !TSRX.test(file)) return;

				const styleId = `/${toPosix(path.relative(config.root, file))}${STYLE_QUERY}`;
				const before = styles.get(styleId.slice(1));

				try {
					await this.environment.transformRequest(
						`/${toPosix(path.relative(config.root, file))}`
					);
				} catch {
					// A partially-typed component fails to compile. Expected.
				}

				if (styles.get(styleId.slice(1)) === before) return;

				const styleModule = this.environment.moduleGraph.getModuleById(styleId);

				if (styleModule == null || modules.includes(styleModule)) return;

				this.environment.moduleGraph.invalidateModule(styleModule);

				return [...modules, styleModule];
			},
		},
	};
}

function toPosix(value: string): string {
	return value.split(path.sep).join('/');
}
