/**
 * The parts of the router that are plain data and pure functions.
 *
 * Separate from the package barrel because that barrel pulls in every `.tsrx`
 * component. The server package needs constants and matching, not components,
 * and importing the barrel for a constant would drag the whole client runtime
 * into a server bundle.
 */
export { LOCATION_PARAM, SERVER_FN_PREFIX, SPLAT_PARAM, SYMBOLS } from './constants';
export { IS_BROWSER } from './env';
export {
	compileRoutePath,
	isPathActive,
	matchCompiledRoutePath,
	matchRoutes,
	normalizeRoutePath,
} from './utils/match-routes';
export type { CompiledRoutePath } from './utils/match-routes';
export {
	buildHref,
	isExternalUrl,
	isSafeHref,
	normalizeBase,
	normalizePathname,
	parseLocation,
	stripBase,
	withBase,
} from './utils/location';
export { DEFAULT_TITLE_SEPARATOR, TITLE_TOKEN, resolveTitle } from './utils/title';
export type * from './types/index';
