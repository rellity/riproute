import {
	maybeCompress,
	normalizeWebRequest,
	toErrorResponse,
	type ErrorHandler,
	type WebRequestOptions,
} from '../adapter-shared';
import { serveStatic } from '../adapter-node/static';

export { serveStatic };
export type { ServeStaticOptions } from '../adapter-node/static';

/**
 * Bun HTTP adapter.
 *
 * Bun speaks web standards natively — `Bun.serve` hands the handler a
 * `Request` and takes a `Response` back — so this is thinner than the node
 * adapter: no `IncomingMessage`/`ServerResponse` bridging. The shared pieces
 * (the hardened static server, compression, the error page, proxy trust and
 * host allow-listing) are the same code the node adapter uses, so a build that
 * targets Bun behaves identically to one that targets Node.
 */

type BunServer = {
	port: number;
	hostname: string;
	stop(closeActiveConnections?: boolean): Promise<void>;
};

type BunServeOptions = {
	port?: number;
	hostname?: string;
	fetch: (request: Request, server: BunServer) => Response | Promise<Response>;
};

declare const Bun: { serve(options: BunServeOptions): BunServer };

export type Handler = (request: Request) => Response | Promise<Response>;

export type ListenOptions = {
	port?: number;
	host?: string;
};

export type AdapterOptions = WebRequestOptions & {
	/** Seconds to let in-flight requests finish on shutdown. Defaults to 10. */
	shutdownTimeout?: number;
	/**
	 * Compress compressible responses (brotli or gzip, by `Accept-Encoding`).
	 * On by default — `bun dist/server` should be deployable without a proxy
	 * in front of it doing the compressing.
	 */
	compress?: boolean;
	/**
	 * Attach SIGINT/SIGTERM handlers that drain in-flight requests before the
	 * process exits. On by default when `listen()` is used.
	 */
	gracefulShutdown?: boolean;
	/** Called when the handler throws. The default logs and returns a bare 500. */
	onError?: ErrorHandler;
};

export type RiprouteServer = {
	/** The underlying `Bun.serve` server once listening, or `null` before. */
	raw: BunServer | null;
	listen(options?: ListenOptions): Promise<{ port: number; host: string }>;
	/** Stops accepting connections and waits for in-flight requests. */
	close(): Promise<void>;
};

/**
 * Bridges a web-standard handler onto `Bun.serve`.
 *
 * `Bun.serve` starts listening the moment it is called, so — unlike the node
 * adapter, which can create the server up front — the server is created inside
 * `listen()`.
 */
export function createServer(handler: Handler, options: AdapterOptions = {}): RiprouteServer {
	let server: BunServer | null = null;

	const respond = async (request: Request): Promise<Response> => {
		let normalized: Request;

		try {
			normalized = normalizeWebRequest(request, options);
		} catch {
			// A refused or malformed host — answer 400 rather than serve it.
			return new Response('Bad Request', {
				status: 400,
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			});
		}

		try {
			const response = await handler(normalized);

			return options.compress !== false ? maybeCompress(normalized, response) : response;
		} catch (error) {
			return toErrorResponse(error, normalized, options.onError);
		}
	};

	return {
		get raw() {
			return server;
		},

		listen(listenOptions = {}) {
			const port = listenOptions.port ?? Number(process.env.PORT ?? 3000);
			const hostname = listenOptions.host ?? process.env.HOST ?? '0.0.0.0';

			server = Bun.serve({ port, hostname, fetch: (request) => respond(request) });

			if (options.gracefulShutdown !== false) {
				const stop = (signal: NodeJS.Signals) => () => {
					// eslint-disable-next-line no-console
					console.log(`riproute: ${signal}, draining`);
					void this.close().then(() => process.exit(0));
				};

				process.once('SIGTERM', stop('SIGTERM'));
				process.once('SIGINT', stop('SIGINT'));
			}

			// eslint-disable-next-line no-console
			console.log(`riproute listening on http://${hostname}:${server.port}`);

			return Promise.resolve({ port: server.port, host: hostname });
		},

		async close() {
			if (server === null) return;

			const current = server;

			server = null;

			const timeout = (options.shutdownTimeout ?? 10) * 1000;
			let timer: ReturnType<typeof setTimeout> | undefined;

			// `stop()` drains in-flight requests; if one never finishes, force it
			// after the timeout with `stop(true)`.
			await Promise.race([
				current.stop(),
				new Promise<void>((resolve) => {
					timer = setTimeout(() => void current.stop(true).then(resolve), timeout);
				}),
			]);

			if (timer !== undefined) clearTimeout(timer);
		},
	};
}
