import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	hasNitroPlugin,
	hasResolvedNitroPlugin,
	nitroBeforeRiproute,
	resolveAdapter,
} from '../../packages/vite/src/nitro';
import { resolveOptions } from '../../packages/vite/src/options';
import { generateNitroModule } from '../../packages/vite/src/virtual-modules';
import bunAdapter from '../../packages/bun/src/adapter';
import cloudflareAdapter from '../../packages/cloudflare/src/adapter';
import nodeAdapter from '../../packages/node/src/adapter';

const nitroish = (name: string) => ({ name });

describe('hasNitroPlugin', () => {
	it('finds nitro at the top level and nested, the way vite flattens', () => {
		expect(hasNitroPlugin([nitroish('riproute'), nitroish('nitro:main')])).toBe(true);
		expect(hasNitroPlugin([[nitroish('nitro:init')], nitroish('riproute')])).toBe(true);
	});

	it('tolerates the junk a plugins array legally carries', () => {
		expect(
			hasNitroPlugin([false, null, undefined, Promise.resolve(nitroish('nitro:main'))])
		).toBe(false);
		expect(hasNitroPlugin(undefined)).toBe(false);
		expect(hasNitroPlugin('nitro' as never)).toBe(false);
	});

	it('does not fire on lookalikes', () => {
		expect(hasNitroPlugin([nitroish('nitro'), nitroish('vite-plugin-nitro-cache')])).toBe(
			false
		);
	});
});

describe('nitroBeforeRiproute', () => {
	it('flags nitro resolved ahead of riproute', () => {
		expect(nitroBeforeRiproute([nitroish('nitro:init'), nitroish('riproute')])).toBe(true);
		expect(nitroBeforeRiproute([nitroish('riproute'), nitroish('nitro:init')])).toBe(false);
		expect(nitroBeforeRiproute([nitroish('riproute')])).toBe(false);
	});
});

describe('generateNitroModule', () => {
	const root = path.resolve('/app');
	const options = resolveOptions({}, root);

	it('dev: exports the fetch shape nitro requires', () => {
		const code = generateNitroModule(options, {
			dev: true,
			base: '/',
			tags: '',
			template: null,
		});

		expect(code).toContain('export default { fetch:');
		expect(code).toContain('/@vite/client');
		expect(code).toContain('__x00__virtual:riproute/client');
		expect(code).toContain('/__riproute/dev-css-ids');
		// Template-mode apps read index.html from disk during dev.
		expect(code).toContain(JSON.stringify(options.template));
	});

	it('dev: prefixes the vite base onto the dev script urls', () => {
		const code = generateNitroModule(options, {
			dev: true,
			base: '/app/',
			tags: '',
			template: null,
		});

		expect(code).toContain('/app/@vite/client');
		expect(code).toContain('/app/@id/__x00__virtual:riproute/client');
	});

	it('prod: bakes the template and the asset tags into the bundle', () => {
		const code = generateNitroModule(options, {
			dev: false,
			base: '/',
			tags: '<script src="/assets/index-abc.js"></script>',
			template: '<!doctype html><html><head></head><body></body></html>',
		});

		expect(code).toContain('export default { fetch:');
		expect(code).toContain('index-abc.js');
		expect(code).toContain('<!doctype html>');
		expect(code).not.toContain('node:fs');
		expect(code).not.toContain('@riproute/node');
	});

	it('prod: a shell-less app with no template fails loudly, not with a blank page', () => {
		const code = generateNitroModule(options, {
			dev: false,
			base: '/',
			tags: '',
			template: null,
		});

		expect(code).toContain('No document to render');
	});
});

const entryContext = {
	tags: '<script src="/assets/index-abc.js"></script>',
	template: '<!doctype html><html><head></head><body></body></html>',
	templatePath: '/app/index.html',
	clientDirFromServer: '../client',
	assetsDir: 'assets',
	base: '',
	handlerId: 'virtual:riproute/handler',
};

describe('adapter descriptors', () => {
	it('each imports only its own runtime package', () => {
		const node = nodeAdapter.entry(entryContext);
		const bun = bunAdapter.entry(entryContext);
		const cloudflare = cloudflareAdapter.entry(entryContext);

		expect(node).toContain("from '@riproute/node'");
		expect(node).not.toContain('@riproute/bun');
		expect(node).not.toContain('@riproute/cloudflare');

		expect(bun).toContain("from '@riproute/bun'");
		expect(bun).not.toContain('@riproute/node');

		expect(cloudflare).toContain("from '@riproute/cloudflare'");
		expect(cloudflare).not.toContain('@riproute/node');
	});

	it('the server targets build a complete server; the Worker does not', () => {
		const node = nodeAdapter.entry(entryContext);

		expect(node).toContain('createServer(handler)');
		expect(node).toContain('serveStatic(clientDir');
		expect(node).toContain('RIPROUTE_NO_LISTEN');

		const cloudflare = cloudflareAdapter.entry(entryContext);

		// A Worker has no filesystem, no process and no socket to listen on.
		expect(cloudflare).toContain('export default { fetch: createFetchHandler(handler) };');
		expect(cloudflare).not.toContain('node:fs');
		expect(cloudflare).not.toContain('RIPROUTE_NO_LISTEN');
		// The template is baked in rather than read at boot.
		expect(cloudflare).toContain('<!doctype html>');
	});

	it('only the Worker asks for its dependencies to be bundled', () => {
		expect(cloudflareAdapter.viteConfig?.noExternal).toBe(true);
		expect(nodeAdapter.viteConfig?.noExternal).toBeUndefined();
		expect(bunAdapter.viteConfig?.noExternal).toBeUndefined();
	});

	it('names and runtime packages line up', () => {
		expect([nodeAdapter.name, bunAdapter.name, cloudflareAdapter.name]).toEqual([
			'node',
			'bun',
			'cloudflare',
		]);
		expect(cloudflareAdapter.runtimePackage).toBe('@riproute/cloudflare');
	});
});

describe('resolveOptions output directories', () => {
	it('refuses a server output dir inside the client output dir', () => {
		// The client dir is served as static files; the SSR bundle living there
		// would be handed out with it. `path.relative(x, x)` is '' so the old
		// `|| '.'` fallback made this collapse silently.
		expect(() =>
			resolveOptions({ clientOutDir: 'dist', serverOutDir: 'dist' }, '/app')
		).toThrow(/must not be inside/);
		expect(() =>
			resolveOptions({ clientOutDir: 'dist', serverOutDir: 'dist/server' }, '/app')
		).toThrow(/must not be inside/);
	});

	it('accepts the default sibling layout', () => {
		const options = resolveOptions({}, '/app');

		expect(options.clientDirFromServer).toBe('../client');
	});
});
