import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

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

	const middleware = (req: IncomingMessage, res: ServerResponse): void => {
		inflight++;

		void (async () => {
			const request = toWebRequest(req, options);

			try {
				await sendWebResponse(res, await handler(request));
			} catch (error) {
				await sendWebResponse(res, await toErrorResponse(error, request, options));
			} finally {
				inflight--;

				if (inflight === 0 && draining !== null) draining();
			}
		})();
	};

	const raw = http.createServer(middleware);

	return {
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
