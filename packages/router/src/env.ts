/**
 * Environment detection.
 *
 * Ripple ships separate client and server runtimes (`ripple` resolves to
 * `index-client.js` under the `browser` condition and `index-server.js`
 * otherwise). The router is a single module graph shared by both, so any
 * DOM access has to be guarded at runtime.
 */
export const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';
