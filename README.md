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
	plugins: [riproute({ title: 'My app' }), ripple()],
});
```

```
src/routes/
	__root.tsrx        the layout every route renders inside
	index.tsrx         /
	about.tsrx         /about
	users.$id.tsrx     /users/:id
	files/$.tsrx       /files/*splat
	__not-found.tsrx   rendered when nothing matches
```

```tsrx
// src/routes/__root.tsrx
import { Link, Outlet } from 'riproute';

export default function RootLayout() @{
	<div>
		<nav><Link href="/about" activeClass="active">{'About'}</Link></nav>
		<main><Outlet /></main>
	</div>
}
```

That is the whole setup. `vite` serves it with SSR; `vite build` produces
`dist/client` and `dist/server`; `node dist/server` serves the built app.

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

`&title` expands to the app's `title` option, and `replace` is the default. So
the keyword is only ever needed to append _without_ the token:

| Written                                                | With `title: 'Site'`                          |
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
`<title>` inside an `<svg>` is left alone — that one is an accessibility label.

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

## Plugin options

| Option         | Default         |                                                                       |
| -------------- | --------------- | --------------------------------------------------------------------- |
| `routesDir`    | `'src/routes'`  | Scanned for route files. `false` turns file routing off.              |
| `routes`       | —               | Module exporting a `routes` array. Takes precedence over `routesDir`. |
| `template`     | `'index.html'`  | The HTML shell.                                                       |
| `rootId`       | `'root'`        | Element the app renders into.                                         |
| `base`         | `''`            | Mount the app under a path prefix.                                    |
| `title`        | —               | Default document title, and what `&title` expands to.                 |
| `serverOnly`   | —               | Tune what the client bundle refuses to import. See above.             |
| `clientOutDir` | `'dist/client'` |                                                                       |
| `serverOutDir` | `'dist/server'` |                                                                       |

Explicit `<!--riproute-head-->` and `<!--riproute-body-->` markers in the
template are honoured; without them the head content goes before `</head>` and
the body into `<div id="root">`, so a plain Vite `index.html` works unchanged.

## Notes on Ripple 0.3.118

Three upstream behaviours shape the design. All are worked around here, and all
are covered by tests so the workarounds do not get tidied away.

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
npm test          # unit, SSR, jsdom-client and Vite-build projects
npm run test:e2e  # dev server and production build, in a real browser
npm run build     # dist/vite and dist/adapter-node
```

`npm run test:e2e` boots the app in `example/` twice — once under `vite`, once
from `dist/server` — and asserts, in Chromium, that hydration adopted the server
markup, that the counter increments, that navigation does not reload the page,
and that each route's `<title>` is right and singular. Unit tests cannot see any
of that: a failed hydration is a `console.warn`, and a lost outlet anchor only
shows up on the second render.

## Licence

MIT
