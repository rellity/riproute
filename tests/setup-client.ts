import { mount } from 'ripple';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom has no layout, so scroll restoration is a no-op here.
window.scrollTo = vi.fn();

declare global {
	// eslint-disable-next-line no-var
	var container: HTMLElement;
	// eslint-disable-next-line no-var
	var render_into_dom: (component: any, props?: Record<string, any>) => void;
}

let unmount: (() => void) | null = null;

beforeEach(() => {
	// Every test starts from a known URL so the router has something to read.
	window.history.replaceState(null, '', '/');

	globalThis.container = document.createElement('div');
	document.body.appendChild(globalThis.container);
});

afterEach(() => {
	unmount?.();
	unmount = null;
	globalThis.container.remove();
});

globalThis.render_into_dom = (component, props) => {
	const root = props === undefined ? component : () => component(props);

	unmount = mount(root as never, { target: globalThis.container });
};
