# riproute

A server-rendered router for [Ripple](https://ripple-ts.com), shipped as a Vite
plugin with its own SSR flow and its own `node:http` adapter.

One plugin gives you file-based routing, an SSR dev server, hydration, and a
production build that boots with `node dist/server`. There is no
`ripple.config.ts`, no second plugin to order correctly, and no metaframework in
between.

```ts
// vite.config.ts
import { riproute } from 'riproute/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [riproute({ title: 'My app' })],
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

riproute is not published to npm. Install it from GitHub:

```sh
npm install github:rellity/riproute
```

The `prepare` script builds `dist/` on install, so the plugin and the adapter
are ready to use straight from a clone.

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

## Plugin options

| Option         | Default         |                                                                       |
| -------------- | --------------- | --------------------------------------------------------------------- |
| `routesDir`    | `'src/routes'`  | Scanned for route files. `false` turns file routing off.              |
| `routes`       | —               | Module exporting a `routes` array. Takes precedence over `routesDir`. |
| `template`     | `'index.html'`  | The HTML shell.                                                       |
| `rootId`       | `'root'`        | Element the app renders into.                                         |
| `base`         | `''`            | Mount the app under a path prefix.                                    |
| `title`        | —               | Default document title, and what `&title` expands to.                 |
| `clientOutDir` | `'dist/client'` |                                                                       |
| `serverOutDir` | `'dist/server'` |                                                                       |

Explicit `<!--riproute-head-->` and `<!--riproute-body-->` markers in the
template are honoured; without them the head content goes before `</head>` and
the body into `<div id="root">`, so a plain Vite `index.html` works unchanged.

## Notes on Ripple 0.3.118

Two upstream behaviours shape the design. Both are worked around here, and both
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

## Development

```sh
npm install
npm test          # unit, SSR and jsdom-client projects
npm run test:e2e  # dev server and production build, in a real browser
npm run build     # dist/vite and dist/adapter-node
```

`npm run test:e2e` boots the app in `example/` twice — once under `vite`, once
from `dist/server` — and asserts, in Chromium, that hydration adopted the server
markup, that the counter increments, that navigation does not reload the page,
and that there is exactly one `<title>`. Unit tests cannot see any of that: a
failed hydration is a `console.warn`, and a lost outlet anchor only shows up on
the second render.

## Licence

MIT
