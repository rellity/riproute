import type { Children, Component } from 'ripple';
import { describe, expect, it } from 'vitest';

import { defineRoutes } from '../../packages/router/src/index';
import { createHandler } from '../../packages/riproute/src/server/index';
import { renderShell } from '../../packages/riproute/src/server/render-shell.tsrx';

function Shell(props: { children?: Children }) @{
	<>
		<head>
			<meta charset="utf-8" />
			<title>{'Base'}</title>
		</head>

		<html lang="en">
			<body>
				<noscript>{'no js'}</noscript>
				{props.children}
			</body>
		</html>
	</>
}

function Home() @{
	<div>
		<title append>{'home'}</title>
		<h1>{'Home'}</h1>
	</div>
}

const routes = defineRoutes([{ path: '/', element: Home }]);

describe('renderShell', () => {
	it('renders a complete document with both markers', async () => {
		const template = await renderShell(Shell as unknown as Component);

		expect(template).toMatch(/^<!doctype html>/);
		expect(template).toContain('<html lang="en">');
		expect(template).toContain('<!--riproute-head--></head>');
		expect(template).toContain('<!--riproute-body-->');
		// The document is a template, not hydratable markup.
		expect(template).not.toContain('<!--[-->');
	});

	it('refuses a shell without a children slot', async () => {
		function NoSlot() @{
			<html lang="en">
				<body></body>
			</html>
		}

		await expect(renderShell(NoSlot as unknown as Component)).rejects.toThrow(
			/must render `\{props\.children\}`/
		);
	});

	it('refuses a shell without an <html> element', async () => {
		function NoHtml(props: { children?: Children }) @{
			<div>{props.children}</div>
		}

		await expect(renderShell(NoHtml as unknown as Component)).rejects.toThrow(
			/must render an <html> element/
		);
	});
});

describe('createHandler with a shell', () => {
	it('serves the app inside the shell, straight into <body>', async () => {
		const handler = createHandler({ routes, shell: Shell as unknown as Component });
		const html = await (await handler(new Request('http://test/'))).text();

		expect(html).toContain('<html lang="en">');
		expect(html).toContain('<noscript>no js</noscript>');
		expect(html).toContain('<h1>Home</h1>');
		// No mount div — the app sits directly in the body.
		expect(html).not.toContain('id="root"');
	});

	it("expands &title against the shell's base title", async () => {
		// `title` comes from the plugin, which read it out of the shell's <head>.
		const handler = createHandler({
			routes,
			shell: Shell as unknown as Component,
			title: 'Base',
		});
		const html = await (await handler(new Request('http://test/'))).text();

		expect(html).toContain('<title>home | Base</title>');
		expect(html.match(/<title>/g)).toHaveLength(1);
	});

	it('runs transformTemplate over the assembled document', async () => {
		const handler = createHandler({
			routes,
			shell: Shell as unknown as Component,
			transformTemplate: (html) => html.replace('</head>', '<meta name="x"></head>'),
		});
		const html = await (await handler(new Request('http://test/'))).text();

		expect(html).toContain('<meta name="x">');
	});

	it('needs either a shell or a template', () => {
		expect(() => createHandler({ routes })).toThrow(/either a `shell` component or a `template`/);
	});
});
