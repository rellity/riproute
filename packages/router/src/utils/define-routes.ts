import type { RouteDefinition } from '../types/index';

/**
 * Identity helper that types a route table.
 *
 * Only needed for code-first apps — with file-based routing the Vite plugin
 * generates the table from `src/routes`.
 */
export function defineRoutes(routes: RouteDefinition[]): RouteDefinition[] {
	return routes;
}
