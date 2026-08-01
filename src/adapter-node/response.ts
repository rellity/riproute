import type { ServerResponse } from 'node:http';

/**
 * Writes a `Response` to a Node response.
 *
 * `getSetCookie()` rather than iterating headers: `Headers` joins duplicate
 * values with a comma, which is wrong for `set-cookie` and silently merges two
 * cookies into one broken value.
 */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
	res.statusCode = response.status;

	if (response.statusText !== '') res.statusMessage = response.statusText;

	for (const [key, value] of response.headers) {
		if (key.toLowerCase() === 'set-cookie') continue;

		res.setHeader(key, value);
	}

	const cookies = response.headers.getSetCookie();

	if (cookies.length > 0) res.setHeader('set-cookie', cookies);

	if (response.body === null) {
		res.end();
		return;
	}

	const reader = response.body.getReader();

	try {
		for (;;) {
			const { done, value } = await reader.read();

			if (done) break;

			// Respect backpressure: a slow client should slow the read loop
			// rather than pile chunks up in the socket buffer.
			if (!res.write(value)) {
				await new Promise<void>((resolve) => res.once('drain', resolve));
			}
		}
	} catch (error) {
		res.destroy(error instanceof Error ? error : new Error(String(error)));
		return;
	} finally {
		reader.releaseLock();
	}

	res.end();
}
