import { describe, expect, it } from 'vitest';

import { normalizeId } from '../../src/vite/package-root';
import { tsrxFallbackPlugin } from '../../src/vite/tsrx-fallback';

const SOURCE = "export function NotFound() @{\n\t<div>{'Not found'}</div>\n}\n";

/**
 * Drives the plugin's hooks directly.
 *
 * The real trigger needs riproute physically installed inside `node_modules`
 * (Vite only appends `?v=` to dependency URLs), which a unit test cannot set
 * up — so the transform is exercised with the exact id shape from the field:
 * `not-found.tsrx?v=55629989`.
 */
async function run(id: string, code: string, consumer: 'client' | 'server' = 'client') {
	const plugin = tsrxFallbackPlugin() as never as {
		configResolved: (config: unknown) => void;
		transform: (this: unknown, code: string, id: string, options?: unknown) => Promise<unknown>;
	};

	plugin.configResolved({ command: 'serve', root: '/app' });

	return plugin.transform.call({ environment: { config: { consumer } } }, code, id) as Promise<{
		code: string;
	} | null>;
}

describe('tsrxFallbackPlugin', () => {
	it('compiles a query-carrying .tsrx id the ripple plugin misses', async () => {
		const result = await run('/app/node_modules/riproute/src/x.tsrx?v=55629989', SOURCE);

		expect(result).not.toBeNull();
		expect(result?.code).toContain("import * as _$_ from 'ripple/internal/client'");
		expect(result?.code).not.toContain('@{');
	});

	it('compiles for the server when the environment says so', async () => {
		const result = await run('/app/n/x.tsrx?v=1', SOURCE, 'server');

		expect(result?.code).toContain("import * as _$_ from 'ripple/internal/server'");
	});

	it('leaves bare .tsrx ids to the ripple plugin', async () => {
		expect(await run('/app/src/routes/index.tsrx', SOURCE)).toBeNull();
	});

	it('stays inert when the code is already compiled', async () => {
		const compiled = "import * as _$_ from 'ripple/internal/client';\nexport function X() {}";

		expect(await run('/app/n/x.tsrx?v=1', compiled)).toBeNull();
	});
});

describe('normalizeId', () => {
	it('rewrites Windows separators, which Vite ids never use', () => {
		expect(normalizeId('C:\\Users\\x\\app\\src\\a.ts')).toBe('C:/Users/x/app/src/a.ts');
		expect(normalizeId('/already/posix')).toBe('/already/posix');
	});
});
