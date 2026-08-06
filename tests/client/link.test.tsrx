import { flushSync } from 'ripple';
import { describe, expect, it } from 'vitest';

import { Link } from '../../packages/router/src/index';

/** The anchor whose text is `label`. */
function anchor(label: string): HTMLAnchorElement {
	return [...container.querySelectorAll('a')].find(
		(a) => a.textContent === label
	) as HTMLAnchorElement;
}

describe('Link href safety', () => {
	it('renders safe hrefs and strips dangerous schemes to no href at all', () => {
		function Page() @{
			<div>
				<Link href="/about">{'rel'}</Link>
				<Link href="https://example.com">{'ext'}</Link>
				<Link href="javascript:alert(1)">{'js'}</Link>
				<Link href="data:text/html,<script>alert(1)</script>">{'data'}</Link>
			</div>
		}

		render_into_dom(Page);
		flushSync();

		expect(anchor('rel').getAttribute('href')).toBe('/about');
		expect(anchor('ext').getAttribute('href')).toBe('https://example.com');

		// A refused href is omitted entirely — the browser has nothing to execute.
		expect(anchor('js').getAttribute('href')).toBeNull();
		expect(anchor('data').getAttribute('href')).toBeNull();
	});
});
