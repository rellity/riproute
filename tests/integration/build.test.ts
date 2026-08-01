import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ripple } from '@ripple-ts/vite-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

import { riproute } from '../../src/vite/index';
import type { RiprouteOptions } from '../../src/vite/index';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

/**
 * Runs a real client build over a fixture app.
 *
 * The unit tests prove the matchers are right; only this proves the plugin is
 * wired into the pipeline at all. It is also the one place the composition with
 * `ripple()` — the arrangement a consumer actually writes — is exercised.
 */
async function buildClient(fixture: string, options: RiprouteOptions = {}) {
	const root = path.join(fixtures, fixture);

	return build({
		root,
		logLevel: 'silent',
		plugins: [riproute(options), ripple({ excludeRippleExternalModules: true })],
		build: {
			target: 'esnext',
			write: false,
			// Readable output, so an assertion about the bundle can be specific.
			minify: false,
			outDir: path.join(root, 'dist/client'),
		},
	});
}

describe('client build', () => {
	it('refuses to bundle a server-only module, and says who imported it', async () => {
		const failure = await buildClient('server-leak').catch((error: Error) => error.message);

		expect(failure).toContain('cannot be imported into client-side code');
		expect(failure).toContain('src/data.server.ts');
		expect(failure).toContain('imported by src/routes/index.tsrx');
	});

	it('lets it through when the path is excluded', async () => {
		await expect(
			buildClient('server-leak', { serverOnly: { exclude: ['src/data.server.ts'] } })
		).resolves.toBeDefined();
	});

	it('builds a clean app, rewriting the literal <title>', async () => {
		const result: any = await buildClient('clean');
		const code = result.output
			.filter((chunk: any) => chunk.type === 'chunk')
			.map((chunk: any) => chunk.code)
			.join('');

		expect(code).toContain('Home');
		// No compiled DOM template contains a <title> element — the rewrite
		// turned it into a component call before Ripple ever saw it. (A bare
		// `<title` search would hit the string in riproute's own error message.)
		expect(code).not.toMatch(/template\(`[^`]*<title/);
		// And `Title` itself was pulled in: the inert anchor it renders is the
		// giveaway. Together, that is the rewrite running in the real pipeline.
		expect(code).toContain('<template></template>');
	});
}, 60_000);
