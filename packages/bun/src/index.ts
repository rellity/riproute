import {
	normalizeWebRequest,
	toErrorResponse,
	type ErrorHandler,
	type WebRequestOptions,
} from '@riproute/adapter-kit';
import { maybeCompress, serveStatic } from '@riproute/adapter-kit/node';

export { serveStatic };
export type { ServeStaticOptions } from '@riproute/adapter-kit/node';

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
	/**
	 * Bun defaults this to `NODE_ENV !== 'production'`, and in development its
	 * fallback 500 page embeds the error message, stack and surrounding source.
	 * Always passed explicitly so a container that forgets `NODE_ENV` cannot
	 * disclose source to the internet.
	 */
	development?: boolean;
	/** Bun's own request timeout, in seconds. Its default is 10. */
	idleTimeout?: number;
	/** Enforced against a declared `Content-Length` only — chunked bypasses it. */
	maxRequestBodySize?: number;
	fetch: (request: Request, server: BunServer) => Response | Promise<Response>;
	error?: (error: unknown) => Response | Promise<Response>;
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
	/**
	 * Largest request body to accept, in bytes. Defaults to 128 MiB — Bun's own
	 * documented limit, which it enforces only against a declared
	 * `Content-Length`; this adapter also enforces it for chunked bodies, which
	 * would otherwise be unbounded.
	 */
	maxBodyBytes?: number;
	/**
	 * Seconds Bun may leave a request idle before closing it. Defaults to 120;
	 * Bun's own default is 10, which silently kills any slower handler.
	 */
	idleTimeout?: number;
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
const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024;

export function createServer(handler: Handler, options: AdapterOptions = {}): RiprouteServer {
	let server: BunServer | null = null;

	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

	const respond = async (request: Request): Promise<Response> => {
		let normalized: Request;

		try {
			normalized = capBody(normalizeWebRequest(request, options), maxBodyBytes);
		} catch (error) {
			if (error === TOO_LARGE) {
				return new Response('Payload Too Large', {
					status: 413,
					headers: { 'content-type': 'text/plain; charset=utf-8' },
				});
			}

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
			try {
				return await toErrorResponse(error, normalized, options.onError);
			} catch (nested) {
				// An `onError` that throws must not reach Bun's fallback page.
				// eslint-disable-next-line no-console
				console.error('[riproute] onError threw\n', nested);

				return new Response('Internal Server Error', {
					status: 500,
					headers: { 'content-type': 'text/plain; charset=utf-8' },
				});
			}
		}
	};

	// Hoisted into a binding rather than using `this`, so a destructured
	// `const { listen } = createServer(...)` still shuts down correctly — with
	// `this` the signal handler throws and, because registering it suppressed
	// the default terminate-on-SIGTERM, the process would never exit at all.
	const instance: RiprouteServer = {
		get raw() {
			return server;
		},

		listen(listenOptions = {}) {
			if (server !== null) {
				throw new Error('[riproute] This server is already listening.');
			}

			if (typeof Bun === 'undefined') {
				throw new Error(
					"[riproute] This build targets Bun (adapter: 'bun') but is running " +
						'somewhere else. Start it with `bun dist/server`, or rebuild with ' +
						"riproute({ adapter: 'node' })."
				);
			}

			const port = listenOptions.port ?? Number(process.env.PORT ?? 3000);
			const hostname = listenOptions.host ?? process.env.HOST ?? '0.0.0.0';

			server = Bun.serve({
				port,
				hostname,
				// Never Bun's development fallback: it puts the error, its stack
				// and the surrounding source in the response body.
				development: false,
				idleTimeout: options.idleTimeout ?? 120,
				maxRequestBodySize: maxBodyBytes,
				fetch: (request) => respond(request),
				// Anything that escapes `respond` — a body stream failing after
				// the response was returned — lands here instead of Bun's page.
				error: (error: unknown) => {
					// eslint-disable-next-line no-console
					console.error('[riproute] request pipeline error\n', error);

					return new Response('Internal Server Error', {
						status: 500,
						headers: { 'content-type': 'text/plain; charset=utf-8' },
					});
				},
			});

			if (options.gracefulShutdown !== false) {
				const stop = (signal: NodeJS.Signals) => () => {
					// eslint-disable-next-line no-console
					console.log(`riproute: ${signal}, draining`);
					void instance
						.close()
						.then(() => process.exit(0))
						.catch(() => process.exit(1));
				};

				process.once('SIGTERM', stop('SIGTERM'));
				process.once('SIGINT', stop('SIGINT'));
			}

			// eslint-disable-next-line no-console
			console.log(`riproute listening on http://${hostname}:${server.port}`);

			return Promise.resolve({ port: server.port, host: hostname });
		},

		async close() {
			const current = server;

			if (current === null) return;

			const timeout = (options.shutdownTimeout ?? 10) * 1000;
			let timer: ReturnType<typeof setTimeout> | undefined;

			try {
				// `stop()` drains in-flight requests; if one never finishes, force
				// it after the timeout with `stop(true)`.
				await Promise.race([
					current.stop(),
					new Promise<void>((resolve) => {
						timer = setTimeout(() => void current.stop(true).then(resolve), timeout);
					}),
				]);
			} finally {
				if (timer !== undefined) clearTimeout(timer);
				// Cleared only once the drain is over, so `raw` stays truthful
				// while requests are still being served.
				server = null;
			}
		},
	};

	return instance;
}

const TOO_LARGE = Symbol('riproute.bodyTooLarge');

/**
 * Bounds the request body.
 *
 * Bun's `maxRequestBodySize` is enforced only against a declared
 * `Content-Length`; a `Transfer-Encoding: chunked` body is unbounded, so an
 * app route calling `request.json()` can be driven to an OOM by one
 * unauthenticated request. A declared over-length body is refused up front;
 * a chunked one is capped as it streams, erroring the body past the limit
 * rather than buffering it.
 */
function capBody(request: Request, limit: number): Request {
	const declared = Number(request.headers.get('content-length') ?? Number.NaN);

	if (Number.isFinite(declared) && declared > limit) throw TOO_LARGE;

	if (request.body === null) return request;

	let seen = 0;

	const capped = request.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				seen += chunk.byteLength;

				if (seen > limit) {
					controller.error(new Error('[riproute] Request body too large.'));
					return;
				}

				controller.enqueue(chunk);
			},
		})
	);

	// Rebuilt from its parts rather than `new Request(request, { body })`:
	// `pipeThrough` has already locked the original body, and re-wrapping a
	// request whose body is disturbed throws.
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: capped,
		signal: request.signal,
		redirect: request.redirect,
		duplex: 'half',
	} as RequestInit);
}
