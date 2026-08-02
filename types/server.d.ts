/**
 * Public type surface for `riproute/server`.
 *
 * Hand-written for the same reason as `types/index.d.ts`: the handler pulls in
 * `create-router-app.tsrx`, and pointing `types` at a module that names a
 * `.tsrx` file gives every consumer `TS2307`.
 *
 * Keep in sync with `src/server/index.ts`.
 */
import type { Component } from 'ripple';
import type { RouteDefinition } from '../src/types/index';

export declare const HEAD_MARKER: '<!--riproute-head-->';
export declare const BODY_MARKER: '<!--riproute-body-->';

export type PageTemplate = {
	before: string;
	between: string;
	after: string;
};

/** Splits a document into the pieces the renderer fills. */
export declare function splitTemplate(html: string, rootId?: string): PageTemplate;

/** Assembles the final document. */
export declare function fillTemplate(template: PageTemplate, head: string, body: string): string;

export type TemplateSource = string | ((request: Request) => string | Promise<string>);

export type HandlerOptions = {
	routes: RouteDefinition[];
	root?: Component;
	fallback?: Component;
	base?: string;
	title?: string;
	template: TemplateSource;
	rootId?: string;
	onRequest?: (request: Request) => Response | undefined | Promise<Response | undefined>;
	onError?: (
		error: unknown,
		request: Request
	) => Response | undefined | Promise<Response | undefined>;
};

export type RiprouteHandler = (request: Request) => Promise<Response>;

/** Builds a framework-agnostic `Request` → `Response` handler. */
export declare function createHandler(options: HandlerOptions): RiprouteHandler;

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

export type RequestEvent = {
	/** The request being served — the RPC call, or the page being rendered. */
	request: Request;
};

/**
 * Marks a function exported from a `*.server.ts` file as callable from the
 * browser. Returns the function unchanged; arguments and result cross the
 * wire as JSON.
 */
export declare function serverFn<T extends (...args: never[]) => unknown>(fn: T): T;

/**
 * The request behind the current call — inside a server function, or anywhere
 * in a server render. Throws outside a request.
 */
export declare function getRequestEvent(): RequestEvent;

/** Builds the RPC endpoint hook the generated handler wires in. */
export declare function createServerFnDispatch(
	loaders: Record<string, () => Promise<Record<string, unknown>>>,
	endpoint?: string
): (request: Request) => Promise<Response | undefined>;
