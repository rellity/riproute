import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { compressStream, negotiateEncoding, shouldCompress } from './compression';
import { toWebRequest } from './request';
import type { RequestOptions } from './request';
import { sendWebResponse } from './response';
import { serveStatic } from './static';

export { toWebRequest, sendWebResponse, serveStatic };
export type { RequestOptions };
export type { ServeStaticOptions } from './static';

export type Handler = (request: Request) => Response | Promise<Response>;

export type ListenOptions = {
	port?: number;
	host?: string;
};

export type AdapterOptions = RequestOptions & {
	/** Seconds to let in-flight requests finish on shutdown. Defaults to 10. */
	shutdownTimeout?: number;
	/**
	 * Compress compressible responses (brotli or gzip, by `Accept-Encoding`).
	 * On by default — `node dist/server` should be deployable without a proxy
	 * in front of it doing the compressing.
	 */
	compress?: boolean;
	/**
	 * Attach SIGINT/SIGTERM handlers that drain in-flight requests before the
	 * process exits. On by default when `listen()` is used.
	 */
	gracefulShutdown?: boolean;
	/** Called when the handler throws. The default logs and returns a bare 500. */
	onError?: (error: unknown, request: Request) => Response | Promise<Response>;
};

export type RiprouteServer = {
	/** The underlying `node:http` server, for anything this adapter does not wrap. */
	raw: Server;
	/** The `(req, res)` listener, for mounting inside an existing server. */
	middleware: (req: IncomingMessage, res: ServerResponse) => void;
	listen(options?: ListenOptions): Promise<{ port: number; host: string }>;
	/** Stops accepting connections and waits for in-flight requests. */
	close(): Promise<void>;
};

/**
 * Bridges a web-standard handler onto `node:http`.
 *
 * Written here rather than reused from `@ripple-ts/adapter-node` so the pieces
 * that matter in production — proxy trust, `set-cookie` splitting,
 * backpressure, graceful shutdown — are ours to change.
 */
export function createServer(handler: Handler, options: AdapterOptions = {}): RiprouteServer {
	let inflight = 0;
	let draining: (() => void) | null = null;
	// eslint-disable-next-line prefer-const
	let server: RiprouteServer;

	const middleware = (req: IncomingMessage, res: ServerResponse): void => {
		inflight++;

		void (async () => {
			// Building the request can throw — a malformed `Host` header makes the
			// URL unconstructable. That must become a 400, not an escaped
			// rejection: this task is fire-and-forget, so a throw here would be an
			// unhandled rejection and, on Node >= 15, kill the whole process.
			let request: Request;

			try {
				request = toWebRequest(req, options);
			} catch {
				res.statusCode = 400;
				res.setHeader('content-type', 'text/plain; charset=utf-8');
				res.end('Bad Request');
				return;
			}

			try {
				let response = await handler(request);

				if (options.compress !== false) {
					response = maybeCompress(request, response);
				}

				await sendWebResponse(res, response);
			} catch (error) {
				await sendWebResponse(res, await toErrorResponse(error, request, options));
			}
		})()
			// Last-resort backstop: nothing above should reject, but a socket that
			// dies mid-write could. Swallow it rather than let it crash the process.
			.catch((error) => {
				// eslint-disable-next-line no-console
				console.error('[riproute] request pipeline error\n', error);

				try {
					if (!res.headersSent && !res.writableEnded) res.statusCode = 500;
					if (!res.writableEnded) res.end();
				} catch {
					res.destroy();
				}
			})
			.finally(() => {
				inflight--;

				if (inflight === 0 && draining !== null) draining();
			});
	};

	const raw = http.createServer(middleware);

	// Slightly above the common 60s proxy idle timeout, so the proxy closes
	// connections first and never races a socket this server just reused.
	raw.keepAliveTimeout = 65_000;
	raw.headersTimeout = 66_000;
	raw.requestTimeout = 300_000;

	server = {
		raw,
		middleware,

		listen(listenOptions = {}) {
			const port = listenOptions.port ?? Number(process.env.PORT ?? 3000);
			const host = listenOptions.host ?? process.env.HOST ?? '0.0.0.0';

			return new Promise((resolve, reject) => {
				raw.once('error', reject);
				raw.listen(port, host, () => {
					raw.off('error', reject);

					const address = raw.address();
					const actual =
						typeof address === 'object' && address !== null ? address.port : port;

					// eslint-disable-next-line no-console
					console.log(`riproute listening on http://${host}:${actual}`);

					// Drain rather than drop on SIGTERM: an orchestrator's stop is
					// routine, and in-flight requests should not pay for it.
					if (options.gracefulShutdown !== false) {
						const stop = (signal: NodeJS.Signals) => () => {
							// eslint-disable-next-line no-console
							console.log(`riproute: ${signal}, draining ${inflight} in-flight`);
							void server.close().then(() => process.exit(0));
						};

						process.once('SIGTERM', stop('SIGTERM'));
						process.once('SIGINT', stop('SIGINT'));
					}

					resolve({ port: actual, host });
				});
			});
		},

		async close() {
			await new Promise<void>((resolve) => raw.close(() => resolve()));

			if (inflight === 0) return;

			const timeout = (options.shutdownTimeout ?? 10) * 1000;

			await Promise.race([
				new Promise<void>((resolve) => {
					draining = resolve;
				}),
				new Promise<void>((resolve) => setTimeout(resolve, timeout).unref()),
			]);
		},
	};

	return server;
}

/**
 * Compresses a response when the client, the content type and the size all
 * say it is worth it.
 */
function maybeCompress(request: Request, response: Response): Response {
	if (response.body === null || response.status === 204 || response.status === 304) {
		return response;
	}

	const encoding = negotiateEncoding(request.headers.get('accept-encoding'));

	if (encoding === null) return response;

	const headers = new Headers(response.headers);
	const length = headers.get('content-length');

	if (!shouldCompress(headers, length === null ? null : Number(length))) return response;

	// The compressed size is unknowable up front, so the response streams.
	headers.delete('content-length');
	headers.set('content-encoding', encoding);
	appendVary(headers, 'accept-encoding');

	return new Response(compressStream(response.body, encoding), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function appendVary(headers: Headers, value: string): void {
	const existing = headers.get('vary');

	if (existing === null) {
		headers.set('vary', value);
		return;
	}

	const parts = existing
		.toLowerCase()
		.split(',')
		.map((part) => part.trim());

	if (parts.includes('*') || parts.includes(value)) return;

	headers.set('vary', `${existing}, ${value}`);
}

async function toErrorResponse(
	error: unknown,
	request: Request,
	options: AdapterOptions
): Promise<Response> {
	if (options.onError !== undefined) return options.onError(error, request);

	// eslint-disable-next-line no-console
	console.error(`[riproute] ${request.method} ${request.url} failed\n`, error);

	return new Response('Internal Server Error', {
		status: 500,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
}
