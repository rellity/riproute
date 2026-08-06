import { describe, expect, it } from 'vitest';

import { extractBaseTitle } from '../../packages/vite/src/title-rewrite';

function shell(head: string): string {
	return [
		'export function shell(props) @{',
		'\t<>',
		'\t\t<head>',
		`\t\t\t${head}`,
		'\t\t</head>',
		'\t\t<html lang="en"><body>{props.children}</body></html>',
		'\t</>',
		'}',
	].join('\n');
}

describe('extractBaseTitle', () => {
	it('reads a string literal', async () => {
		expect(await extractBaseTitle(shell("<title>{'My app'}</title>"), 'x.tsrx')).toBe('My app');
	});

	it('reads plain text', async () => {
		expect(await extractBaseTitle(shell('<title>My app</title>'), 'x.tsrx')).toBe('My app');
	});

	it('reads a constant template literal', async () => {
		expect(await extractBaseTitle(shell('<title>{`My app`}</title>'), 'x.tsrx')).toBe('My app');
	});

	it('ignores a computed title rather than half-supporting it', async () => {
		expect(await extractBaseTitle(shell('<title>{name}</title>'), 'x.tsrx')).toBeNull();
		expect(await extractBaseTitle(shell('<title>{`a ${b}`}</title>'), 'x.tsrx')).toBeNull();
	});

	it('ignores a <title> outside <head> — that one is a route claim', async () => {
		const source =
			"export default function Page() @{\n\t<div>\n\t\t<title>{'claim'}</title>\n\t</div>\n}\n";

		expect(await extractBaseTitle(source, 'x.tsrx')).toBeNull();
	});

	it('returns null for a file with no title at all', async () => {
		expect(await extractBaseTitle('export const x = 1;', 'x.ts')).toBeNull();
	});
});
