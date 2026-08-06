import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	hasNitroPlugin,
	hasResolvedNitroPlugin,
	nitroBeforeRiproute,
	resolveAdapter,
} from '../../src/vite/nitro';
import { resolveOptions } from '../../src/vite/options';
import {
	generateNitroModule,
	generateServerModule,
	generateWorkerdModule,
} from '../../src/vite/virtual-modules';

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
		expect(code).not.toContain('riproute/adapter-node');
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

describe('resolveAdapter', () => {
	it('defaults to node, and to nitro when the plugin is present', () => {
		expect(resolveAdapter({}, [nitroish('riproute')])).toBe('node');
		expect(resolveAdapter({}, [nitroish('riproute'), nitroish('nitro:main')])).toBe('nitro');
	});

	it('an explicit adapter always wins', () => {
		expect(resolveAdapter({ adapter: 'bun' }, [nitroish('nitro:main')])).toBe('bun');
		expect(resolveAdapter({ adapter: 'node' }, [nitroish('nitro:main')])).toBe('node');
		expect(resolveAdapter({ adapter: 'nitro' }, [])).toBe('nitro');
	});

	it('honours the legacy nitro boolean as an override', () => {
		expect(resolveAdapter({ nitro: true }, [])).toBe('nitro');
		expect(resolveAdapter({ nitro: false }, [nitroish('nitro:main')])).toBe('node');
	});
});

describe('hasResolvedNitroPlugin', () => {
	it('detects the nitro plugin by name in the resolved list', () => {
		expect(hasResolvedNitroPlugin([nitroish('riproute'), nitroish('nitro:env')])).toBe(true);
		expect(hasResolvedNitroPlugin([nitroish('riproute'), nitroish('ripple')])).toBe(false);
	});
});

describe('generateServerModule adapter selection', () => {
	const options = resolveOptions({}, path.resolve('/app'));

	it('imports the chosen adapter package, and only that one', () => {
		const node = generateServerModule(options, '', 'node');
		const bun = generateServerModule(options, '', 'bun');

		expect(node).toContain("from 'riproute/adapter-node'");
		expect(node).not.toContain('adapter-bun');

		expect(bun).toContain("from 'riproute/adapter-bun'");
		expect(bun).not.toContain('adapter-node');

		// Both are otherwise the same complete server entry.
		expect(bun).toContain('createServer(handler)');
		expect(bun).toContain('serveStatic(clientDir');
	});

	it('defaults to node', () => {
		expect(generateServerModule(options, '')).toContain("from 'riproute/adapter-node'");
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

describe('generateWorkerdModule', () => {
	const options = resolveOptions({}, path.resolve('/app'));

	it('emits a Worker module with no filesystem, server or listen', () => {
		const code = generateWorkerdModule(options, {
			tags: '<script src="/assets/index-abc.js"></script>',
			template: '<!doctype html><html><head></head><body></body></html>',
		});

		expect(code).toContain("import { createFetchHandler } from 'riproute/adapter-workerd';");
		expect(code).toContain('export default { fetch: createFetchHandler(handler) };');
		// A Worker has no filesystem, no process and no socket to listen on.
		expect(code).not.toContain('node:fs');
		expect(code).not.toContain('createServer');
		expect(code).not.toContain('RIPROUTE_NO_LISTEN');
		// The template is baked in, not read at boot.
		expect(code).toContain('<!doctype html>');
		expect(code).toContain('index-abc.js');
	});

	it('fails loudly when there is no document to render', () => {
		expect(generateWorkerdModule(options, { tags: '', template: null })).toContain(
			'No document to render'
		);
	});
});

describe('resolveAdapter with workerd', () => {
	it('selects workerd when asked, over an auto-detected nitro', () => {
		expect(resolveAdapter({ adapter: 'workerd' }, [])).toBe('workerd');
		expect(resolveAdapter({ adapter: 'workerd' }, [nitroish('nitro:main')])).toBe('workerd');
	});
});
