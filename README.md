# riproute

A server-rendered router for [Ripple](https://ripple-ts.com), shipped as a Vite
plugin with its own SSR flow and its own `node:http` adapter.

It gives you file-based routing, an SSR dev server, hydration, and a production
build that boots with `node dist/server`. There is no `ripple.config.ts` and no
metaframework in between — riproute adds routing next to Ripple's own plugin
rather than wrapping it, the way a TanStack Start app sits next to the React
plugin.

```ts
// vite.config.ts
import { ripple } from '@ripple-ts/vite-plugin';
import { riproute } from 'riproute/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [riproute(), ripple()],
});
```

```
src/routes/
	__root.tsrx        the document and the layout
	index.tsrx         /
	about.tsrx         /about
	users.$id.tsrx     /users/:id
	files/$.tsrx       /files/*splat
	__not-found.tsrx   rendered when nothing matches
```

```tsrx
// src/routes/__root.tsrx
import type { Children } from 'ripple';
import { Link, Outlet } from 'riproute';

// The base document. `shell` replaces index.html — `{props.children}` is where
// the app goes, no id="root" div needed. Server-only: the browser hydrates the
// content at the slot, never the document around it. (Ripple treats <head> as
// its own block, so it sits beside <html>; riproute reassembles the document.)
export function shell(props: { children?: Children }) @{
	<>
		<head>
			<meta charset="utf-8" />
			<title>{'My app'}</title>
		</head>

		<html lang="en">
			<body>{props.children}</body>
		</html>
	</>
}

// The layout every route renders inside — the part the browser hydrates.
export default function RootLayout() @{
	<div>
		<nav><Link href="/about" activeClass="active">{'About'}</Link></nav>
		<main><Outlet /></main>
	</div>
}
```

That is the whole setup. `vite` serves it with SSR; `vite build` produces
`dist/client` and `dist/server`; `node dist/server` serves the built app.

Prefer a static shell? Skip the `shell` export and put an `index.html` with a
`<div id="root"></div>` next to `vite.config.ts` — riproute renders into that
instead.

## Install

riproute is not published to npm. Install it from GitHub, alongside Ripple and
Ripple's Vite plugin:

```sh
npm install github:rellity/riproute ripple
npm install -D @ripple-ts/vite-plugin
```

The `prepare` script builds `dist/` on install, so the plugin and the adapter
are ready to use straight from a clone.

Do not add a `ripple.config.ts`. riproute never reads one, but its presence
switches `@ripple-ts/vite-plugin` into metaframework mode, where it registers an
SSR middleware ahead of Vite's own stack and starts answering requests riproute
expects to handle. The plugin warns if it finds one.

## Routing

### File-based (default)

Files under `src/routes` become routes. The conventions match TanStack Start:

| File               | Route                                               |
| ------------------ | --------------------------------------------------- |
| `index.tsrx`       | `/`                                                 |
| `about.tsrx`       | `/about`                                            |
| `posts/index.tsrx` | `/posts`                                            |
| `posts/$id.tsrx`   | `/posts/:id`                                        |
| `posts.$id.tsrx`   | `/posts/:id` (flat form, same thing)                |
| `files/$.tsrx`     | `/files/*splat`                                     |
| `__root.tsrx`      | the layout, not a route                             |
| `__not-found.tsrx` | the `**` catch-all                                  |
| `_helpers.ts`      | ignored — a single `_` hides a file from the router |

Every route file default-exports its component. Adding, renaming or deleting one
regenerates the table and reloads the page.

Dynamic routes get their params typed from the pattern:

```tsrx
import type { RouteComponentProps } from 'riproute';

export default function Post(props: RouteComponentProps<'/posts/:slug'>) @{
	// props.params.slug: string — and only slug; a typo is a type error.
}
```

Splats work the same way — `RouteComponentProps<'/docs/*splat'>` types
`params.splat`. Without a pattern argument, `params` falls back to
`Record<string, string>`.

**Create an empty file and it scaffolds itself.** While the dev server is
running, a new empty `.tsrx` under `src/routes` gets a working template written
into it — named for its route, typed for its params, `<title>` claim included —
the way TanStack Start does it. Only ever an _empty_ file: anything with
content (a git checkout, a paste) is never touched. Turn it off with
`riproute({ scaffold: false })`.

### Code-first

Point the plugin at a module instead:

```ts
riproute({ routes: 'src/routes.ts' });
```

```ts
// src/routes.ts
import { defineRoutes } from 'riproute';
import Home from './pages/home.tsrx';
import RootLayout from './pages/layout.tsrx';

export const root = RootLayout;
export const routes = defineRoutes([{ path: '/', element: Home }]);
```

Routes are always a table, never `<Route>` children. That is a hydration
requirement rather than a style preference — see _Why the router takes no
children_ below.

## API

```tsrx
import {
	Link,          // an <a> that intercepts plain left-clicks
	Outlet,        // renders the matched route; placed by the root layout
	Redirect,      // navigates to `to` once rendered
	Router,        // owns the location; usually created for you
	navigateTo,    // imperative navigation
	useLocation,
	useMatch,
	useNavigate,
	useParams,
	useRouter,
	useSearchParams,
} from 'riproute';
```

`riproute/server` exports `createHandler()`, a `Request` → `Response` SSR
handler with no Node dependency. `riproute/adapter-node` bridges it onto
`node:http`, with `serveStatic()`, proxy-header handling, `set-cookie`
splitting, backpressure and graceful shutdown.

## Titles

Write a `<title>` in a route. There is no component to import and no `<head>`
to wrap it in — the plugin rewrites the element, and the SSR handler emits
exactly one `<title>` for the document.

```tsrx
export default function About() @{
	<div>
		<title append>{'About | &title'}</title>
		<h1>{'About'}</h1>
	</div>
}
```

`&title` expands to the base title — the `<title>` written in the shell's
`<head>` (or, failing that, the plugin's `title` option) — and `replace` is the
default. So the keyword is only ever needed to append _without_ the token:

| Written                                                | With base title `Site`                        |
| ------------------------------------------------------ | --------------------------------------------- |
| `<title>{'docs'}</title>`                              | `docs`                                        |
| `<title replace>{'docs'}</title>`                      | `docs`, said out loud                         |
| `<title>{'home \| &title'}</title>`                    | `home \| Site` — the token does the appending |
| `<title append>{'home'}</title>`                       | `home \| Site`                                |
| `<title append separator=" · ">{'home'}</title>`       | `home · Site`                                 |
| `<title append>{'home \| &title'}</title>`             | `home \| Site` — never appended twice         |
| `<title>{'home \| &title'}</title>`, no `title` option | `home` — no dangling separator                |

Any expression works, so a title can be built from the route's params:
`<title>{`User ${props.params.id}`}</title>`. The last claim rendered wins.
Two places are left alone: `<title>` inside an `<svg>` (an accessibility
label), and `<title>` inside a `<head>` block (the document's own base title,
read statically).

## Server-only code

The client bundle refuses to import anything that belongs on the server, and
fails the build naming the import chain rather than shipping it.

Mark a module explicitly, the way React's `server-only` package works:

```ts
import 'riproute/server-only';

export const db = connect(process.env.DATABASE_URL);
```

The marker is transitive: anything that imports a marked module into the
browser graph pulls the marker in too, and fails there.

Three things are caught without any marker at all:

- **Naming conventions** — `*.server.ts`, `src/lib/server/**`, `src/server/**`.
  The one sanctioned crossing is a `serverFn()` export — see
  [Server functions](#server-functions).
- **Node built-ins** — importing `node:fs` from app code. Vite would otherwise
  externalise it with a runtime warning, so the first symptom is a broken
  production page.
- **Contents.** Most leaks are not labelled: a helper grows a
  `process.env.DATABASE_URL` read, a route imports it, and the secret is in the
  client chunk. riproute flags a module that reads any `process.env` value other
  than `NODE_ENV` or a `VITE_`-prefixed one, imports a database driver, mailer or
  cloud SDK, or uses `__dirname`. Type-only imports are ignored, and a module
  that feature-detects with `typeof process` is taken at its word.

```ts
riproute({
	serverOnly: {
		include: ['src/db/**'], // extra root-relative globs
		exclude: ['src/config.server.ts'], // opt back out
		analyze: false, // turn the content check off
	},
});
```

## Server functions

The sanctioned way across the server boundary. Declare a function with
`serverFn()` inside any `*.server.ts` file and it becomes callable from
everywhere — on the server the call is direct, and in the browser the import
turns into a typed stub that POSTs to the function's own endpoint,
`/__riproute/serverfn/<hash>`, where riproute runs the real thing. The hash is
derived from the file and export name at build time, so calls are
tellable-apart in the network tab while the app's file layout never appears in
the client bundle:

```ts
// src/lib/todos.server.ts
import { serverFn, getRequestEvent } from 'riproute/server';
import type { ServerFnMiddleware } from 'riproute/server';

const requireUser: ServerFnMiddleware = async (event, next) => {
	const user = await sessionUser(event.request); // cookies, headers

	if (user === null) throw new Error('unauthorized');

	event.locals.user = user; // handed to the handler

	return next();
};

export const addTodo = serverFn()
	.middleware([requireUser])
	.handler(async (text: string) => {
		const { locals } = getRequestEvent();

		return db.todos.insert(locals.user, text);
	});

// no middleware? the shorthand skips the builder:
export const listTodos = serverFn(async () => db.todos.all());
```

Calling one from a route is just an import — in the browser bundle it is a
stub, during SSR the real function. The hooks wrap the two call shapes,
TanStack Query style: `useQueryFn()` loads on mount, `useMutateFn()` fires
when told to. Both destructure without losing reactivity:

```tsrx
import { useMutateFn, useQueryFn } from 'riproute';
import { createTodo, listTodos } from '../lib/todos.server';

export default function Todos() @{
	// Runs once hydrated, never during SSR.
	const { data, loading, error, refetch } = useQueryFn(listTodos);

	const { mutate: addTodo, loading: adding } = useMutateFn(
		async (text: string) => {
			await createTodo(text);
			await refetch();
		}
	);

	<div>
		@if (loading.value) {
			<p>{'Loading…'}</p>
		}

		<ul>
			@for (const todo of data; key todo.id) {
				<li>{todo.name}</li>
			}
		</ul>

		<button
			disabled={adding.value}
			onClick={() => addTodo('hello')}
		>{'Add'}</button>
	</div>
}
```

Every field is a reactive ref read with `.value` — destructured or not, it
keeps updating — and an array-valued `data` is directly iterable, typed to
the element, so `@for (const todo of data)` reads exactly as it should.

- **`useQueryFn(fn, ...args)`** calls `fn(...args)` once the component
  reaches the browser and exposes `data`, `loading`, `error` and
  `refetch(...args?)` — re-run with the original arguments or new ones,
  resolving with the value. A superseded call can never overwrite a newer
  result, and the page server-renders in its loading state.
- **`useMutateFn(fn)`** runs nothing until `mutate(...args)` is called.
  `mutate` resolves with the result — or `undefined` on failure, with the
  failure in `error`, never as a rejection, so a bare
  `onClick={() => mutate(...)}` cannot leak an unhandled promise. `reset()`
  returns to the initial state.

Types flow through untouched: TypeScript checks the call against the source
module, so `addTodo` keeps its signature and a wrong argument is a type error
in the editor, not a runtime surprise. Arguments and results cross the wire as
JSON — keep them plain data.

Middleware is around-style: it runs before the handler wherever the function
is called (RPC or direct), in the order given. Call `next()` to continue —
its value is the handler's result, yours to pass through or replace — return
without calling it to short-circuit, or throw to fail the call. `event.locals`
is per-request scratch space shared with the handler.

The wrapper is the security boundary, not ceremony. Only `serverFn()` exports
exist in the browser's view of the module: importing anything else from a
`.server.ts` file fails the client build with a missing-export error, and the
endpoint refuses to run anything unmarked — so the `db` sitting next to
`addTodo` stays exactly as server-only as it was. A `.server.ts` file with no
`serverFn` exports at all cannot be imported from client code, same as always.

`getRequestEvent()` returns the request behind the current call — inside a
server function, and anywhere in a server render. Server functions run _after_
`onRequest` hooks, so an auth gate in `hooks.server.ts` covers them too.

## Endpoints and hooks

Server functions replace most hand-written JSON endpoints; what stays in
`src/hooks.server.ts` (picked up by name) is the cross-cutting kind — auth
gates, redirects, error reporting, and endpoints that are not function calls:

```ts
// src/hooks.server.ts
export function onRequest(request: Request): Response | undefined {
	if (!authorized(request)) return new Response(null, { status: 401 });

	return undefined; // fall through to server functions and routing
}
```

`onRequest` runs before route matching _and_ before server-function dispatch —
return a `Response` to answer the request, return nothing to let riproute
carry on. An `onError` export overrides the 500 page the same way. The module
runs identically under `vite` and in the built server.

## Plugin options

| Option         | Default                 |                                                                        |
| -------------- | ----------------------- | ---------------------------------------------------------------------- |
| `routesDir`    | `'src/routes'`          | Scanned for route files. `false` turns file routing off.               |
| `routes`       | —                       | Module exporting a `routes` array. Takes precedence over `routesDir`.  |
| `hooks`        | `'src/hooks.server.ts'` | Module exporting `onRequest` / `onError`. `false` disables the lookup. |
| `scaffold`     | `true`                  | Fill new empty route files with a template in dev.                     |
| `nitro`        | auto                    | Serve through nitro. Detected from the plugin array; see below.        |
| `template`     | `'index.html'`          | The HTML shell.                                                        |
| `rootId`       | `'root'`                | Element the app renders into.                                          |
| `base`         | `''`                    | Mount the app under a path prefix.                                     |
| `title`        | —                       | Default document title, and what `&title` expands to.                  |
| `serverOnly`   | —                       | Tune what the client bundle refuses to import. See above.              |
| `clientOutDir` | `'dist/client'`         |                                                                        |
| `serverOutDir` | `'dist/server'`         |                                                                        |

Explicit `<!--riproute-head-->` and `<!--riproute-body-->` markers in the
template are honoured; without them the head content goes before `</head>` and
the body into `<div id="root">`, so a plain Vite `index.html` works unchanged.

## Production

`vite build` writes `dist/client` (hashed assets) and `dist/server/index.js` — a
complete server, not a snippet to wire up:

```sh
PORT=3000 node dist/server
```

The generated server serves the hashed assets with immutable caching, renders
everything else, and the adapter underneath it is built for being exposed:

- **Compression** — brotli or gzip by `Accept-Encoding`, for compressible types
  above 1 KiB. On by default so a bare `node dist/server` behaves well without
  a proxy in front; a CDN or proxy that compresses can leave it on harmlessly
  (`vary: accept-encoding` is set).
- **Graceful shutdown** — SIGTERM/SIGINT stop accepting connections and drain
  in-flight requests (10s cap) before exiting, so an orchestrator's routine
  restart drops nothing.
- **Proxy trust is opt-in** — `x-forwarded-*` headers are ignored unless the
  handler is created with `trustProxy: true`, because behind no proxy they are
  attacker-controlled and the URL decides which route runs.
- **`set-cookie` splitting, backpressure, keep-alive timeouts** tuned to sit
  behind a 60s-idle proxy without racing it.

Importing `dist/server/index.js` with `RIPROUTE_NO_LISTEN=1` set exports the
bare `handler` and `server` instead of booting, for embedding in another
process.

### Nitro

To deploy through [nitro](https://nitro.build) instead of the built-in
`node:http` server, add its Vite plugin at the end of the array:

```ts
import { nitro } from 'nitro/vite';

plugins: [riproute(), ripple(), nitro()];
```

That is the whole integration. riproute detects nitro and registers its
request handler as nitro's SSR service; nitro then owns the server on both
sides — its dev server in `vite dev`, and `vite build` producing a deployable
`.output/` for whatever preset is configured (node, Cloudflare, Vercel, …)
instead of `dist/`. Static assets, compression and process lifecycle are
nitro's from there, riproute renders the pages, and everything else — routes,
titles, hooks, the server-only guard — behaves identically. Nitro's own
features (`server/api/` routes, storage, tasks) work as documented by nitro.

Order matters: nitro reads the SSR entry riproute plants during config
resolution, so `nitro()` must come **after** `riproute()` — riproute warns if
it does not. The detection can be overridden with `riproute({ nitro: false })`.

Two dev-mode notes. The very first page load after the server boots may paint
before stylesheets are inlined (every later render has them); and plugins that
inject HTML through `transformIndexHtml` are not consulted, because nitro's
environment runner renders the document outside Vite's HTML pipeline.

## Notes on Ripple 0.3.118

These upstream behaviours shape the design. All are worked around here, and all
are covered by tests so the workarounds do not get tidied away.

**Route components render a single root element.** A fragment-rooted route
(`<>…</>`) hydrates fine — and then duplicates the entire layout on its first
state update, silently. Wrap the page in a `<div>`; the e2e suite counts
layouts after an update to keep this honest.

**Title claims never touch tracked state.** A tracked write from a component
rendered during (or right after) hydration re-renders the router's dynamic
block, with the same duplicated-layout result — reproduced with nothing but an
empty write in a hydrated route. `setTitle` therefore stamps a plain ref and
assigns `document.title` directly, and `<Title>` hangs its claim off an
attribute expression rather than `effect()`, because registering an effect from
a hydrated route's body desyncs the cursor the same way.

**Why the router takes no children.** A component that renders a dynamic
expression _after_ `{children}` in a fragment desyncs the hydration cursor, and
the whole tree silently falls back to a client mount. Reproduced with no router
code at all: `<>{children}<Thing value={x} /></>` fails, the reverse order does
not. The matched route is exactly such a dynamic block, so `<Router>` renders it
first and takes no children; layouts go in the root route and place `<Outlet />`.

**Why `<Outlet>` uses a single-item keyed `@for`.** Ripple's server runtime
emits no hydration markers around a dynamic component, while the client's
`composite()` expects a comment anchor to insert before. Hydration adopts the
markup, but the anchor ends up pointing at the first real node of the route. The
first navigation destroys that node, the insertion point goes with it, and the
outlet is empty from then on — no error, no warning. A keyed `@for` emits
markers on both sides, so the branch is replaced between anchors that outlive
it.

**Why the `<title>` is written by the handler, not a component.** A `<head>`
block only defers its contents when it sits in the component handed to
`render()`. Anywhere deeper — including inside `<Router>` — it flushes as soon
as that component finishes, which is before any route has rendered, so a title
claimed by a page arrives too late to appear. The router reports the resolved
title outwards through `onTitle` instead, and the SSR handler, which already
owns the document, writes the single `<title>` itself. In the browser the
router assigns `document.title` directly.

## Development

```sh
npm install
npm test              # unit, SSR, jsdom-client and Vite-build projects
npm run test:coverage # the same, with a V8 coverage report
npm run test:e2e      # dev server and production build, in a real browser
npm run build         # dist/vite and dist/adapter-node
```

Coverage reads low on the dev middleware and the generated-module templates —
those run inside real Vite processes during `test:e2e`, which V8 coverage
cannot see. The browser suite is the test of record for them.

`npm run test:e2e` boots the app in `example/` twice — once under `vite`, once
from `dist/server` — and asserts, in Chromium, that hydration adopted the server
markup, that the counter increments, that navigation does not reload the page,
and that each route's `<title>` is right and singular. Unit tests cannot see any
of that: a failed hydration is a `console.warn`, and a lost outlet anchor only
shows up on the second render.

## Licence

MIT
