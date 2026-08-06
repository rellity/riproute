# Handover

State of riproute as of `1517d14` on `main`. Everything below was run, not
assumed; where something is untested it says so.

## What riproute is

A server-rendered router for Ripple 0.3.118, shipped as a Vite plugin. It sits
_beside_ `@ripple-ts/vite-plugin` rather than wrapping it — no
`ripple.config.ts`, no metaframework. File-based routes, SSR dev server,
hydration, server functions, and a production build that boots per adapter.

Everything user-facing is documented in `README.md`, which is current as of this
commit. This file covers the things a README should not: why some decisions are
the way they are, and what is not finished.

## Layout

A pnpm workspace driven by turbo. Seven packages, six of them released.

| Package                 | Ships as | Role                                                    |
| ----------------------- | -------- | ------------------------------------------------------- |
| `@riproute/riproute`    | source   | SSR handler, server functions, server-only guard        |
| `@riproute/router`      | source   | components, hooks, contexts, routing primitives         |
| `@riproute/vite`        | `dist/`  | the plugin: file routing, SSR, builds, dev middleware   |
| `@riproute/node`        | `dist/`  | `node:http` adapter                                     |
| `@riproute/bun`         | `dist/`  | `Bun.serve` adapter                                     |
| `@riproute/cloudflare`  | `dist/`  | Workers adapter                                         |
| `@riproute/adapter-kit` | never    | the adapter contract — `private`, bundled into the rest |

**Source-shipped vs built is load-bearing.** `router` and `riproute` ship `.ts`
and `.tsrx` for the app's own Vite to compile, because Ripple's compiler has to
see `.tsrx`. That means they cannot bundle anything, which is why
`SERVER_FN_PREFIX` lives in `@riproute/router` rather than in the adapter kit:
it is the lowest package all three consumers (client stub, server dispatch, dev
middleware) can reach. Built packages inline it; source-shipped ones import it
as ordinary source. Do not "tidy" it back into the kit — the kit is not
installed at runtime.

## Adapter selection

There is no `adapter` option. The plugin reads the app's **declared**
dependencies, finds the single `@riproute/*` adapter among them, imports
`<pkg>/adapter` and asks the descriptor for the server entry source.

- zero installed → error; more than one → error. Never a guess.
- **Declared** deps specifically, not `require.resolve`: a pnpm workspace root
  hoists every adapter into view, so resolution alone would let a sibling
  package vote. `tests/unit/adapter-resolution.test.ts` pins this.
- A client-only build needs no adapter. The error is deferred to the point where
  the server entry is actually loaded, so `vite build` for a static site still
  works.

Adding a target is a new package: `defineAdapter({ name, runtimePackage,
viteConfig?, startHint?, entry(ctx) })`. No branch in the plugin.

Verified: swapping the example's `@riproute/node` for `@riproute/cloudflare` and
rebuilding, with no config change, emits `export default { fetch` — a Worker
module.

## Distribution

Not on npm. A release is the channel.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` then installs, builds, tests, packs, and
attaches the tarballs. Installation is by URL:

```sh
R=https://github.com/rellity/riproute/releases/download/v0.1.0
npm i $R/riproute-riproute-0.1.0.tgz $R/riproute-vite-0.1.0.tgz \
      $R/riproute-node-0.1.0.tgz ripple
```

Release assets on a public repo download anonymously — no token, no registry.
(GitHub _Packages_ would need auth even for public packages, so it is not an
option here.)

`scripts/pack-release.mjs` is the interesting part:

- rewrites each intra-repo dependency to the **URL of the sibling tarball in the
  same release**, so one URL pulls the rest transitively;
- drops `workspace:` devDependencies from the published manifest (installers
  ignore them, and they name packages deliberately absent from the release);
- restores every manifest afterwards — `workspace:*` in the tree is what makes a
  checkout link to itself instead of downloading its own published past;
- refuses a tag that disagrees with the packages' `version`, because URLs come
  from the tag and filenames from the version, and a mismatch publishes dead
  links.

Use `--base http://127.0.0.1:PORT` to pack against a local server and rehearse
an install for real.

### Things that do NOT work, and will be asked about

- `npm install github:rellity/riproute` — reports success, installs
  `node_modules/riproute-monorepo` (the private root), nothing importable. The
  worst failure shape; the README says so explicitly.
- `pnpm add github:rellity/riproute#path:/packages/router` — dies on
  `workspace:*`.
- Swapping `workspace:*` for git URLs to fix the above: **do not**. Tested — pnpm
  then fetches the tarball instead of linking the local copy, so intra-repo
  development silently builds against whatever is pushed.

## Verification

```sh
pnpm install && pnpm build
pnpm test                                                  # 295 tests, 25 files
CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e      # 23 browser checks
pnpm format:check
```

The suite lives at the repo root, not per package — it is cross-package by
nature (integration builds an app with the plugin; e2e drives Chromium against a
real server). `turbo` owns the build graph only. If you add a `test` task back
to `turbo.json`, make sure some package actually defines the script: a
`turbo run test` matching nothing exits 0 and looks like a pass.

E2E is the test of record for the dev middleware and the generated modules —
V8 coverage cannot see inside the real Vite processes, so coverage reads low
there by design.

## Open / unverified

1. **`release.yml` has never run.** The packing half is tested locally and by
   `tests/integration/release.test.ts`, but `pnpm/action-setup` and
   `gh release create` on the runner are untried until the first `v*` tag.
2. **`ci.yml` has never been observed either.** It was rewritten for
   pnpm/turbo in `8f4090b` and the exact sequence was run locally, but PR #1
   merged while the first hosted run was still in flight. Likeliest failure
   candidates: `pnpm/action-setup` resolving the version from `packageManager`,
   and Playwright's system deps in the runner image.
3. **`feat/turborepo-adapters` is merged** (PR #1) and can be deleted, locally
   and on the remote.
4. Nitro is selected by presence of `nitro()` in `plugins`, not by an adapter
   package — it predates the adapter split and is the one target that still
   works differently. Worth unifying if nitro use grows.
5. Nitro's path router cannot express extension matching, so there is no
   per-extension `routeRules`. A previous attempt at an SVG CSP rule
   (`/**/*.svg`) matched every response and broke hydration; e2e caught it. If
   you need that, it has to happen in the handler, not in `routeRules`.

## Conventions

- Commits are authored `rellity <rellsub1@gmail.com>`, no co-author trailers.
- Prettier with tabs; `pnpm format:check` gates CI.
- Every security finding in this repo's history was reproduced by executing
  code before being fixed. Two were only visible that way: the
  `compressStream` teardown leak (130 → 15,808 producer pulls after the
  consumer cancelled) and an `allowedHosts` bypass via an absolute-form request
  line. Keep that habit — reading the code was not enough in either case.
