/**
 * The half of the kit that needs Node built-ins.
 *
 * Split from the main entry on purpose: `@riproute/cloudflare` imports the
 * web-standard half, and a stray `node:zlib` reaching a Worker bundle breaks
 * it. Node and Bun import both halves.
 */

export {
	compressStream,
	createCompressor,
	maybeCompress,
	negotiateEncoding,
	shouldCompress,
	appendVary,
	type Encoding,
} from './compression';

export { serveStatic, type ServeStaticOptions } from './static';
