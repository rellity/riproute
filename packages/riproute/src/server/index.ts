import type { Component } from 'ripple';
import { getCss, render } from 'ripple/server';

import { createRouterApp } from '@riproute/router';
import { renderShell } from './render-shell.tsrx';
import type { RouteDefinition } from '@riproute/router/primitives';
import { normalizeBase, stripBase } from '@riproute/router/primitives';
import { matchRoutes, normalizeRoutePath } from '@riproute/router/primitives';
import { BODY_MARKER, HEAD_MARKER, escapeHtml, fillTemplate, splitTemplate } from './html';
import type { PageTemplate } from './html';
import { withRequestEvent } from './server-fn';

export { BODY_MARKER, HEAD_MARKER, splitTemplate, fillTemplate };
export type { PageTemplate };
export { createServerFnDispatch, getRequestEvent, serverFn, ServerFnError } from './server-fn';
export type {
	RequestEvent,
	ServerFnBuilder,
	ServerFnDispatchOptions,
	ServerFnMiddleware,
	ServerFnTable,
} from './server-fn';

export type TemplateSource = string | ((request: Request) => string | Promise<string>);

export type HandlerOptions = {
	/** The route table — generated from `src/routes`, or written by hand. */
	routes: RouteDefinition[];
	/** Layout every route renders inside; the `__root` route in file mode. */
	root?: Component;
	/** Rendered when nothing matches. Beats a `'**'` route. */
	fallback?: Component;
	/** Mount the app under a path prefix. */
	base?: string;
	/** Default document title, and what `&title` expands to. */
	title?: string;
	/**
	 * The HTML shell, as a static document.
	 *
	 * A function in dev, because Vite rewrites the document per request (HMR
	 * client, `@vite/client`, plugin-injected tags). Ignored when `shell` is
	 * given.
	 */
	template?: TemplateSource;
	/**
	 * The root route's `shell` export: the base document, written as a component
	 * rather than an `index.html`. Rendered once per request into the template.
	 */
	shell?: Component;
	/**
	 * Last look at the assembled document before it is split.
	 *
	 * This is where the `<script>` and `<link>` tags go — Vite's in dev, the
	 * built asset URLs in production. A shell cannot write them itself: it does
	 * not know its own hashed file names.
	 */
	transformTemplate?: (html: string, request: Request) => string | Promise<string>;
	/** The element SSR output goes into. Defaults to `root`. */
	rootId?: string;
	/**
	 * Runs before rendering. Return a `Response` to answer the request without
	 * touching the router — API routes, redirects, auth gates.
	 */
	onRequest?: (request: Request) => Response | undefined | Promise<Response | undefined>;
	/** Called when rendering throws. Return a `Response` to override the 500. */
	onError?: (
		error: unknown,
		request: Request
	) => Response | undefined | Promise<Response | undefined>;
};

export type RiprouteHandler = (request: Request) => Promise<Response>;

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

/**
 * Builds a framework-agnostic `Request` → `Response` handler.
 *
 * Nothing here touches `node:http`; the adapter does that. Keeping the handler
 * on web primitives is what makes the same build runnable on Node, a worker or
 * a test harness.
 */
export function createHandler(options: HandlerOptions): RiprouteHandler {
	const base = normalizeBase(options.base);
	const rootId = options.rootId ?? 'root';

	// Matching only needs the table's shape, so it can be built once.
	const table = new Map<string, Component>();

	for (const route of options.routes) {
		table.set(normalizeRoutePath(route.path), route.element);
	}

	if (options.shell === undefined && options.template === undefined) {
		throw new Error(
			'[riproute] createHandler needs either a `shell` component or a `template` string.'
		);
	}

	// A constant template with nothing to transform is split once; everything
	// else has to be rebuilt per request.
	const constantTemplate =
		typeof options.template === 'string' &&
		options.shell === undefined &&
		options.transformTemplate === undefined
			? splitTemplate(options.template, rootId)
			: null;

	async function resolveTemplate(request: Request): Promise<PageTemplate> {
		if (constantTemplate !== null) return constantTemplate;

		const source =
			options.shell !== undefined
				? await renderShell(options.shell)
				: typeof options.template === 'string'
					? options.template
					: await (options.template as (request: Request) => string | Promise<string>)(
							request
						);

		const transformed =
			options.transformTemplate === undefined
				? source
				: await options.transformTemplate(source, request);

		return splitTemplate(transformed, rootId);
	}

	async function handle(request: Request): Promise<Response> {
		if (options.onRequest !== undefined) {
			const early = await options.onRequest(request);

			if (early !== undefined) return early;
		}

		try {
			const url = new URL(request.url);
			const pathname = stripBase(url.pathname, base);
			// A `**` route or a `fallback` decides *what* renders, not what the
			// response says: an unmatched URL is still a 404, and answering 200
			// with a "not found" page is what keeps broken links out of search
			// results and monitoring.
			const matched = matchRoutes(table, pathname);
			const status = matched === null ? 404 : 200;

			const template = await resolveTemplate(request);

			// The last claim wins, and the router reports the base title up front,
			// so this holds the right value by the time the render finishes.
			let title = options.title;

			const app = createRouterApp({
				routes: options.routes,
				root: options.root,
				fallback: options.fallback,
				base: options.base,
				title: options.title,
				url: url.pathname + url.search,
				static: true,
				onTitle(next) {
					title = next;
				},
			});

			const { head, body, css } = await render(app);
			const styles = renderCss(css);

			return new Response(fillTemplate(template, renderTitle(title) + head + styles, body), {
				status,
				headers: HTML_HEADERS,
			});
		} catch (error) {
			if (options.onError !== undefined) {
				const handled = await options.onError(error, request);

				if (handled !== undefined) return handled;
			}

			throw error;
		}
	}

	// The whole request — hooks, dispatch and render alike — runs inside the
	// request context, so `getRequestEvent()` works during SSR too.
	return (request) => withRequestEvent(request, () => handle(request));
}

/**
 * Renders the one `<title>` the document gets.
 *
 * Written here rather than by a component so there is exactly one, always: the
 * handler owns the head, so nothing downstream can add a second or reorder it
 * against the rest of the document.
 */
function renderTitle(title: string | undefined): string {
	return title === undefined || title === '' ? '' : `<title>${escapeHtml(title)}</title>`;
}

/**
 * Renders collected scoped styles.
 *
 * `data-ripple-ssr` is not decorative: Ripple's client runtime removes exactly
 * that selector once the real stylesheet has loaded, so the page never flashes
 * unstyled and the SSR copy never lingers as a duplicate.
 */
function renderCss(css: Set<string>): string {
	if (css.size === 0) return '';

	const text = getCss(css);

	return text === '' ? '' : `<style data-ripple-ssr>${text}</style>`;
}
