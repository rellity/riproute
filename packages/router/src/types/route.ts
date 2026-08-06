import type { Component } from 'ripple';

/** Flattens an intersection so hovers read `{ id: string; rest: string }`. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The params a route pattern produces, keyed exactly as the matcher keys them:
 * `/users/:id` → `{ id: string }`, `/files/*rest` → `{ rest: string }`, and a
 * bare `*` (or the `**` catch-all) under the literal key `'*'`. A non-literal
 * pattern — `RouteComponentProps` with no argument — falls back to
 * `Record<string, string>` rather than pretending to know the keys.
 */
export type ExtractPathParams<T extends string> = string extends T
	? Record<string, string>
	: Prettify<Params<T>>;

type Params<T extends string> = T extends `${infer _Start}:${infer Param}/${infer Rest}`
	? { [K in Param]: string } & Params<`/${Rest}`>
	: T extends `${infer _Start}:${infer Param}`
		? { [K in Param]: string }
		: T extends `${infer _Start}*${infer Splat}`
			? { [K in Splat extends '' ? '*' : Splat]: string }
			: {};

// Type-safe route props based on path
export type TypedRouteProps<T extends string> = {
	params: ExtractPathParams<T>;
	searchParams?: Record<string, string>;
};

// Helper type for creating type-safe route components
export type TypedRouteComponent<T extends string> = Component<TypedRouteProps<T>>;

// Type-safe route definition
export type TypedRoute<T extends string> = {
	path: T;
	component: TypedRouteComponent<T>;
};
