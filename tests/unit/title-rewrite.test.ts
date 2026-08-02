import { describe, expect, it } from 'vitest';

import { rewriteTitles } from '../../src/vite/title-rewrite';

const IMPORT = "import { Title as RiprouteTitle } from 'riproute';";

/** Wraps markup in a component so the compiler's parser has something to chew on. */
function component(markup: string): string {
	return `export default function Page() @{\n\t<div>\n\t\t${markup}\n\t</div>\n}\n`;
}

async function rewrite(markup: string): Promise<string> {
	return rewriteTitles(component(markup), '/src/routes/page.tsrx');
}

/** Just the rewritten element, which is all most of these assertions care about. */
async function element(markup: string): Promise<string | null> {
	const match = (await rewrite(markup)).match(/<RiprouteTitle[^\n]*\/>/);

	return match === null ? null : match[0];
}

describe('rewriteTitles', () => {
	it('leaves a file with no <title> exactly as it was', async () => {
		const source = component("<h1>{'hi'}</h1>");

		expect(await rewriteTitles(source, '/src/routes/page.tsrx')).toBe(source);
	});

	it('rewrites a bare <title>', async () => {
		expect(await element("<title>{'docs'}</title>")).toBe("<RiprouteTitle text={'docs'} />");
	});

	it('keeps the append keyword', async () => {
		expect(await element("<title append>{'home'}</title>")).toBe(
			"<RiprouteTitle text={'home'} append />"
		);
	});

	it('keeps the replace keyword', async () => {
		expect(await element("<title replace>{'docs'}</title>")).toBe(
			"<RiprouteTitle text={'docs'} replace />"
		);
	});

	it('passes other attributes through as written', async () => {
		expect(await element('<title append separator=" · ">{\'home\'}</title>')).toBe(
			'<RiprouteTitle text={\'home\'} append separator=" · " />'
		);
		expect(await element("<title append separator={' · '}>{'home'}</title>")).toBe(
			"<RiprouteTitle text={'home'} append separator={' · '} />"
		);
	});

	it('passes an expression through untouched', async () => {
		expect(await element('<title>{`User ${props.params.id}`}</title>')).toBe(
			'<RiprouteTitle text={`User ${props.params.id}`} />'
		);
	});

	it('quotes plain text', async () => {
		expect(await element('<title append>About us</title>')).toBe(
			'<RiprouteTitle text={"About us"} append />'
		);
	});

	it('collapses the whitespace JSX would have collapsed', async () => {
		expect(await element('<title>\n\t\t\tAbout\n\t\t</title>')).toBe(
			'<RiprouteTitle text={"About"} />'
		);
	});

	it('joins mixed children into a template literal', async () => {
		expect(await element('<title>User {props.params.id} — profile</title>')).toBe(
			'<RiprouteTitle text={`User ${props.params.id} — profile`} />'
		);
	});

	it('escapes backticks in mixed text', async () => {
		expect(await element('<title>a `b` {props.x}</title>')).toBe(
			'<RiprouteTitle text={`a \\`b\\` ${props.x}`} />'
		);
	});

	// JSX reads `{c}` as an expression, so a trailing `$` really is a literal
	// dollar sitting in front of an interpolation — which is what the template
	// literal already says.
	it('leaves a literal $ before an expression alone', async () => {
		expect(await element('<title>${props.x}</title>')).toBe(
			'<RiprouteTitle text={`$${props.x}`} />'
		);
	});

	it('refuses an empty <title>', async () => {
		await expect(rewrite('<title append></title>')).rejects.toThrow(/needs content/);
		await expect(rewrite('<title>   </title>')).rejects.toThrow(/needs content/);
	});

	it('leaves <title> inside <svg> alone', async () => {
		const source = component("<svg><title>{'icon'}</title></svg>");

		expect(await rewriteTitles(source, '/src/routes/page.tsrx')).toBe(source);
	});

	it('rewrites every <title> in a file', async () => {
		const rewritten = await rewrite("<title>{'a'}</title>\n\t\t<title append>{'b'}</title>");

		expect(rewritten).toContain("<RiprouteTitle text={'a'} />");
		expect(rewritten).toContain("<RiprouteTitle text={'b'} append />");
		expect(rewritten.match(/RiprouteTitle text/g)).toHaveLength(2);
	});

	it('imports Title once, without shifting any line', async () => {
		const source = component("<title>{'docs'}</title>");
		const rewritten = await rewriteTitles(source, '/src/routes/page.tsrx');

		expect(rewritten.startsWith(IMPORT)).toBe(true);
		expect(rewritten.match(/from 'riproute'/g)).toHaveLength(1);
		expect(rewritten.split('\n')).toHaveLength(source.split('\n').length);
	});

	it('keeps line numbers when the element spanned several lines', async () => {
		const source = component("<title\n\t\t\tappend\n\t\t>{'home'}</title>");
		const rewritten = await rewriteTitles(source, '/src/routes/page.tsrx');

		expect(rewritten.split('\n')).toHaveLength(source.split('\n').length);
		expect(rewritten).toContain('append');
	});

	it('picks a different local name when RiprouteTitle is taken', async () => {
		const source = `const RiprouteTitle = 1;\n${component("<title>{'x'}</title>")}`;
		const rewritten = await rewriteTitles(source, '/src/routes/page.tsrx');

		expect(rewritten).toContain("import { Title as RiprouteTitle1 } from 'riproute';");
		expect(rewritten).toContain("<RiprouteTitle1 text={'x'} />");
	});
});

describe('titleRewritePlugin load hook', () => {
	it('rewrites at load time, so plugin order cannot matter', async () => {
		const { titleRewritePlugin } = await import('../../src/vite/title-rewrite');
		const fs = await import('node:fs');
		const os = await import('node:os');
		const path = await import('node:path');

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riproute-title-'));
		const file = path.join(dir, 'page.tsrx');

		fs.writeFileSync(file, component("<title append>{'home'}</title>"));

		try {
			const plugin = titleRewritePlugin() as never as {
				load: (id: string) => Promise<{ code: string } | null>;
			};

			// `@ripple-ts/vite-plugin`'s compile transform is also enforce:'pre',
			// so with `[ripple(), riproute()]` a transform-based rewrite would run
			// after the compiler. `load` runs before every transform — this is the
			// hook that makes `<title>` work under either plugin order.
			const result = await plugin.load(file);

			expect(result).not.toBeNull();
			expect(result?.code).toContain("<RiprouteTitle text={'home'} append />");

			// Files with nothing to rewrite fall through to Vite's default loader.
			fs.writeFileSync(file, component("<h1>{'hi'}</h1>"));
			expect(await plugin.load(file)).toBeNull();

			// Virtual ids and missing files are not this plugin's business.
			expect(await plugin.load('\0virtual:riproute/routes')).toBeNull();
			expect(await plugin.load(path.join(dir, 'gone.tsrx'))).toBeNull();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
