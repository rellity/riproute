import { render } from 'ripple/server';

declare global {
	// eslint-disable-next-line no-var
	var render_to_string: (component: any, props?: Record<string, any>) => Promise<string>;
}

/**
 * Server-renders a component and strips Ripple's hydration markers, which the
 * assertions here do not care about.
 */
globalThis.render_to_string = async (component, props) => {
	const root = props === undefined ? component : () => component(props);

	const { body } = await render(root as never);

	return (
		body
			.replace(/<!--[[\]]-->/g, '')
			// The inert `<template>` that `<Route>`/`<Title>`/`<Redirect>` emit so
			// hydration stays in step — an implementation detail here. There is a
			// dedicated test asserting it is present.
			.replace(/<template><\/template>/g, '')
	);
};
