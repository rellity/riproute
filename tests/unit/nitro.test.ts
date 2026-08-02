import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasNitroPlugin, nitroBeforeRiproute } from '../../src/vite/nitro';
import { resolveOptions } from '../../src/vite/options';
import { generateNitroModule } from '../../src/vite/virtual-modules';

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
