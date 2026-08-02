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
	/** Per-request scratch space: middleware writes, the handler reads. */
	locals: Record<string, unknown>;
};

/**
 * Around-style middleware: call `next()` to continue (its value is the
 * handler's result), return without calling it to short-circuit, throw to
 * fail the call.
 */
export type ServerFnMiddleware = (event: RequestEvent, next: () => Promise<unknown>) => unknown;

export type ServerFnBuilder = {
	/** Adds middleware, run in the order given, before the handler. */
	middleware(middleware: readonly ServerFnMiddleware[]): ServerFnBuilder;
	/** Sets the function itself and returns it, callable and typed as written. */
	handler<T extends (...args: never[]) => unknown>(fn: T): T;
};

/**
 * Declares a function in a `*.server.ts` file as callable from the browser:
 * `serverFn().middleware([...]).handler(fn)`, or `serverFn(fn)` as shorthand
 * when there is no middleware. Arguments and result cross the wire as JSON.
 */
export declare function serverFn(): ServerFnBuilder;
export declare function serverFn<T extends (...args: never[]) => unknown>(fn: T): T;

/**
 * The request behind the current call — inside a server function, or anywhere
 * in a server render. Throws outside a request.
 */
export declare function getRequestEvent(): RequestEvent;

export type ServerFnTable = Record<
	string,
	{ name: string; load: () => Promise<Record<string, unknown>> }
>;

/** Builds the RPC endpoint hook the generated handler wires in. */
export declare function createServerFnDispatch(
	functions: ServerFnTable,
	prefix?: string
): (request: Request) => Promise<Response | undefined>;
