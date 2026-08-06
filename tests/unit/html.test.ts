import { describe, expect, it } from 'vitest';

import {
	BODY_MARKER,
	HEAD_MARKER,
	fillTemplate,
	splitTemplate,
} from '../../packages/riproute/src/server/html';

const PLAIN =
	'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';

describe('splitTemplate', () => {
	it('fills a plain Vite index.html with no markers', () => {
		const template = splitTemplate(PLAIN);

		expect(fillTemplate(template, '<title>x</title>', '<p>hi</p>')).toBe(
			'<!doctype html><html><head><meta charset="utf-8"><title>x</title></head>' +
				'<body><div id="root"><p>hi</p></div></body></html>'
		);
	});

	it('prefers explicit markers', () => {
		const html = `<html><head>${HEAD_MARKER}</head><body><main>${BODY_MARKER}</main></body></html>`;

		expect(fillTemplate(splitTemplate(html), 'H', 'B')).toBe(
			'<html><head>H</head><body><main>B</main></body></html>'
		);
	});

	it('honours a custom mount point', () => {
		const html = '<html><head></head><body><div id="app"></div></body></html>';

		expect(fillTemplate(splitTemplate(html, 'app'), '', 'B')).toBe(
			'<html><head></head><body><div id="app">B</div></body></html>'
		);
	});

	it('says what is missing', () => {
		expect(() => splitTemplate('<html><body></body></html>')).toThrow(/needs a <head> element/);
		expect(() => splitTemplate('<html><head></head><body></body></html>')).toThrow(
			/needs a mount point/
		);
	});
});
