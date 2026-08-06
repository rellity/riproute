/**
 * Nitro integration.
 *
 * When `nitro/vite` sits in the plugin array — by convention at the end, after
 * the framework plugins — riproute stops being its own server and becomes
 * nitro's SSR *service*. Nitro reads the `ssr` environment's build input as
 * that service's entry, wires its renderer so every page request routes there,
 * serves the client build as its public assets, and owns dev, build and
 * deployment (`.output/`, presets, `nitro deploy`). riproute's `node:http`
 * entry and adapter are simply not used.
 *
 * The wiring rests on plugin order: nitro reads the environments out of the
 * config *its* `config` hook receives, so riproute's hook — which plants the
 * ssr entry — must have run first. `[riproute(), ripple(), nitro()]` is the
 * shape; nitro anywhere before riproute is detected and warned about.
 */

import type { Plugin } from 'vite';

/** Plugin names `nitro/vite` registers; any one of them means nitro is on. */
const NITRO_PLUGIN_NAMES = new Set(['nitro:init', 'nitro:env', 'nitro:main']);

type MaybePlugin = { name?: unknown } | null | undefined | false;

/**
 * Whether the nitro Vite plugin is in the array.
 *
 * Works on the raw user config, so nesting and falsy entries are handled the
 * way Vite itself handles them. Async plugin factories (promises) cannot be
 * inspected without awaiting and are ignored — nitro's own factory is
 * synchronous.
 */
export function hasNitroPlugin(plugins: unknown): boolean {
	if (!Array.isArray(plugins)) return false;

	return plugins.some((entry: MaybePlugin | MaybePlugin[]) =>
		Array.isArray(entry)
			? hasNitroPlugin(entry)
			: typeof entry === 'object' &&
				entry !== null &&
				typeof entry.name === 'string' &&
				NITRO_PLUGIN_NAMES.has(entry.name)
	);
}

/**
 * Whether nitro's plugins come before riproute's in the resolved order.
 *
 * That order is broken: nitro decides its services inside its own `config`
 * hook, and a riproute that runs after it plants an ssr entry nobody reads.
 */
export function nitroBeforeRiproute(plugins: readonly { name: string }[]): boolean {
	const nitroIndex = plugins.findIndex((plugin) => NITRO_PLUGIN_NAMES.has(plugin.name));
	const riprouteIndex = plugins.findIndex((plugin) => plugin.name === 'riproute');

	return nitroIndex !== -1 && riprouteIndex !== -1 && nitroIndex < riprouteIndex;
}

/** Whether the resolved plugin list contains the nitro plugin. */
export function hasResolvedNitroPlugin(plugins: readonly { name: string }[]): boolean {
	return plugins.some((plugin) => NITRO_PLUGIN_NAMES.has(plugin.name));
}

type NitroRouteRule = { headers?: Record<string, string> };
type NitroInstance = { options: { routeRules?: Record<string, NitroRouteRule> } };

/**
 * Restores the static-response hardening riproute's own adapters apply.
 *
 * Under nitro the client build is served by *nitro*, not by riproute's
 * `serveStatic`, so `nosniff` and the SVG sandbox would silently not apply —
 * nitro sets neither. A Vite plugin carrying a `nitro` property is registered
 * as a nitro module (`nitro/vite` collects `plugin.nitro`), which is the
 * supported way to reach `routeRules`. Inert when nitro is absent: nothing
 * else reads the property.
 *
 * Existing rules win, so an app can override either header.
 */
export function nitroHeadersPlugin(): Plugin {
	return {
		name: 'riproute:nitro-headers',

		nitro: {
			name: 'riproute:nitro-headers',
			setup(nitro: NitroInstance) {
				const rules = (nitro.options.routeRules ??= {});
				const everything = (rules['/**'] ??= {});

				everything.headers = {
					'x-content-type-options': 'nosniff',
					...everything.headers,
				};

				// No SVG sandbox rule here. riproute's own adapters set
				// `content-security-policy: sandbox` per response, keyed on the
				// resolved content type; nitro's route rules match path segments
				// and cannot express "by extension" — a `/**/*.svg` key matches
				// *everything*, which sandboxes the HTML document and stops the
				// app hydrating. Apps serving untrusted SVG under nitro should add
				// their own rule for the directory those files live in.
			},
		},
	} as Plugin;
}

/**
 * Resolves which adapter the build targets.
 *
 * An explicit `adapter` wins. Otherwise the legacy `nitro` boolean is honoured
 * (`true` → nitro, `false` → never nitro), and failing both, the nitro plugin's
 * mere presence selects nitro — so `[riproute(), ripple(), nitro()]` needs no
 * further configuration. Everything else defaults to node.
 */
export function resolveAdapter(
	options: { adapter?: 'node' | 'bun' | 'nitro'; nitro?: boolean },
	plugins: unknown
): 'node' | 'bun' | 'nitro' {
	if (options.adapter !== undefined) return options.adapter;
	if (options.nitro === true) return 'nitro';
	if (options.nitro === false) return 'node';

	return hasNitroPlugin(plugins) ? 'nitro' : 'node';
}
