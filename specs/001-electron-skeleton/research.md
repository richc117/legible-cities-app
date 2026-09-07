# Research: Electron skeleton

Phase 0 of the plan. Three unknowns were checked against the official
documentation by independent readers, and each answer was then handed to a
second reader told to refute it; one refutation succeeded and is folded in
below. Everything else in the plan is either fixed by the constitution and
the earlier decision records, or is a version pin checked against the npm
registry on 2026-09-07.

## 1. Serving `app://local` with `protocol.handle`

**Decision.** Register once, at module top level of the main entry, before
`app.whenReady()`:

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])
```

`standard` makes `app://local` a real origin that resolves relative URLs
(without it the scheme "will behave like the file protocol, but without the
ability to resolve relative URLs", and web storage is disabled);
`supportFetchAPI` lets the renderer `fetch()` the origin; `stream` is
required for streamed bodies. `bypassCSP`, `corsEnabled` and
`allowServiceWorkers` stay off. The docs are explicit that this call is
allowed only before `ready` and only once, while `protocol.handle` is
allowed only after `ready`.

The handler receives a WHATWG `Request` and returns a `Response` or a
promise of one. Routing is on `new URL(req.url)`: host must be `local`,
then the pathname. Three branches:

- **Development interface**: forward to the Vite dev server with
  `net.fetch(devUrl + pathname + search, { method, headers, body })` and
  return its response unchanged, so the navigation URL and the page origin
  stay `app://local`. `net.fetch` reaches `http://localhost` from inside a
  handler; `bypassCustomProtocolHandlers` is only for forwarding to the same
  scheme and is not needed. The dev URL is `process.env.ELECTRON_RENDERER_URL`,
  which electron-vite sets after the server listens; with `strictPort` it is
  always port 5173.
- **Packaged interface**: map `/ui/<rest>` onto electron-vite's
  `out/renderer/<rest>` after the escape check, and stream the file.
- **Project output**: validate the identifier and the path (`data-model.md`),
  resolve under `<engine home>/out/<id>/`, stream the file with an explicit
  content type: `new Response(Readable.toWeb(createReadStream(abs)), { headers: { 'content-type': mime } })`.
  Electron 44.2 ships Node 24, where `Readable.toWeb` is stable. The docs'
  one-liner `net.fetch(pathToFileURL(abs).toString())` also works, but its
  content type is undocumented, so the explicit form is used where the type
  matters.
- **Refusals**: `new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })`
  and the same with 403 and 405. Never throw from the handler.

**Two facts that shaped the routing.** electron-vite 5 forces the renderer's
Vite `base` to `./` in production and warns on anything but `./` or `/`, so
a `/ui/` base is not available; the built `index.html` uses `./`-relative
asset URLs, which resolve under `app://local/ui/` because the scheme is
standard. And in development Vite emits root-relative URLs (`/@vite/client`,
`/src/main.tsx`, `/node_modules/.vite/deps/…`, `/@fs/…`, `/@react-refresh`),
so the development branch forwards every path that is not `/projects/…` to
the dev server, stripping only a leading `/ui`.

**Alternatives considered.** Loading `http://localhost:5173` directly in
development, as electron-vite's template does: rejected, it is the second
origin FR-009 forbids. `registerFileProtocol`: deprecated in favour of
`protocol.handle`. A custom partition: unnecessary, and it would need
`ses.protocol.handle` on that session.

**Sources.** electronjs.org/docs/latest/api/protocol (`handle`,
`registerSchemesAsPrivileged`, the `app://bundle` example with its escape
check and its `net.fetch` proxy branch), api/net (`net.fetch`),
api/structures/custom-scheme, breaking-changes (Response bodies as
streams), and electron-vite's `src/plugins/electron.ts` for the base rule.
Skeptic: not refuted.

## 2. Vite's HMR client behind the proxy

**Decision.** The HMR client does not use `window.location`; it derives the
websocket host from `import.meta.url` of `/@vite/client`. Fetched through
the proxy that URL is `app://local/@vite/client`, so the client would dial
`ws://local:/` and fail. The documented reverse-proxy recipe fixes it, in the
renderer's Vite config:

```ts
renderer: {
  server: {
    host: 'localhost', port: 5173, strictPort: true,
    hmr: { protocol: 'ws', host: 'localhost', clientPort: 5173 },
  },
}
```

`strictPort` matters twice: Vite otherwise tries the next free port, and
electron-vite builds `ELECTRON_RENDERER_URL` from the configured port.
`hmr.clientPort` overrides the port only on the client side; setting
`hmr.port` to a different value would open a second websocket server, so it
stays unset, as does `hmr.path`. The websocket path equals `base`, which is
`/`. `server.origin` is not needed and would produce cross-origin asset
URLs. `server.cors` is irrelevant because every request arrives through the
same-origin proxy.

The interface's CSP in development therefore allows `connect-src 'self'
ws://localhost:5173`, and `script-src` needs `'unsafe-inline'` for the
React refresh preamble that Vite injects; a packaged build allows `'self'`
only. These are the keys under `server.hmr` in Vite 5 to 7; Vite 8 moves
them under `server.ws` and keeps `server.hmr.*` synced, so the config
survives electron-vite's next Vite bump unchanged.

**Alternatives considered.** Vite's backend-integration pattern (script tags
pointing straight at `http://localhost:5173`): no HMR config needed but the
page would load cross-origin scripts and Vite's CORS default would have to
be widened to `app://local`. Rejected for the same reason as above.

**Sources.** vite.dev and v7.vite.dev `config/server-options` (`server.hmr`,
`server.port`, `server.strictPort`, `server.origin`, `server.cors`),
`config/shared-options#base`, `guide/backend-integration`; Vite 7.1
`client.ts`, `clientInjections.ts` and `ws.ts` for the derivation. Skeptic:
not refuted.

## 3. Playwright's Electron driver on the three runners

**Decision.** `@playwright/test` as a development dependency; it carries the
Electron driver and downloads no browser (`npm ci` runs no install script,
and `npx playwright install` is never called - the driver launches the
`electron` package's own binary). The test is a plain `test()` with no
browser fixture:

```ts
import { _electron as electron, expect, test } from '@playwright/test'
const app = await electron.launch({ args: ['.'], cwd: repoRoot, timeout: 30_000 })
try {
  const window = await app.firstWindow()
  await expect(window).toHaveTitle('Legible Cities')
} finally {
  await app.close()
}
```

`args: ['.']` is `electron .`, which needs `"main": "./out/main/index.js"`
in `package.json` (electron-vite requires that line) and a completed
`electron-vite build`. `executablePath` is omitted, so the driver resolves
the binary from the `electron` package. On Linux, Playwright adds
`--no-sandbox` itself because `chromiumSandbox` defaults to false. The
playwright config sets `workers: 1`, a 60 s test timeout, and no `projects`.

**The refuted claim, and its correction.** The first reading said
`npm ci` installs the Electron binary. It does not: since Electron 42 the
npm package has no `postinstall`, and the binary is fetched "dynamically the
first time that its main bin script is run" - which, in a test, would happen
inside `electron.launch()` against the launch timeout, on every runner. The
CI sequence therefore has an explicit step after `npm ci`:
`npx install-electron --no` (idempotent; leaves `node_modules/electron/dist`
in place). `ELECTRON_SKIP_BINARY_DOWNLOAD` no longer exists.

**Per runner.** `ubuntu-22.04`: `xvfb-run -a npm run test:e2e`; `xvfb` is on
the image, and Chromium's shared libraries are present because the image
ships Chrome. `macos-15` (arm64 only) and `windows-latest`: no display
setup; Electron's own guidance says xvfb-maybe "will do nothing" there. Node
22 LTS via `actions/setup-node` with npm caching (Electron 44 needs Node
22.12+; Vitest 4 accepts 20, 22 and 24+). Playwright's Electron support is
labelled experimental, so the version is pinned exactly.

**Sources.** playwright.dev `api/class-electron`,
`api/class-electronapplication`, `docs/ci`; electronjs.org
`tutorial/installation`, `breaking-changes` (42.0: no postinstall),
`tutorial/testing-on-headless-ci`; `playwright-core`'s `electron.ts` for the
`--no-sandbox` default; runner-images README for the labels. Skeptic:
refuted on the binary download; correction applied above.

## 4. Version pins

Checked against the registry on 2026-09-07, with peer dependencies.

| Package | Pin | Why this and not the latest |
|---|---|---|
| electron | 44.2.0 | The version the capture spike measured; the latest of its line |
| electron-vite | 5.0.0 | Peer: Vite `^5 \|\| ^6 \|\| ^7` and `@swc/core`; forces renderer base `./` (above) |
| vite | 7.3.6 | The newest line electron-vite 5 accepts; Vite 8 is not |
| @vitejs/plugin-react | 5.2.0 | The 6 line requires Vite 8 |
| @swc/core | 1.16.2 | electron-vite 5's peer |
| react, react-dom | 19.2.8 | current |
| typescript | 5.9.3 | typescript-eslint 8 supports `<6.1`; TypeScript 7 is the native port and not yet in that range |
| vitest | 4.1.11 | Accepts Node 20, 22 and 24+ and Vite 6 to 8; Vitest 5 excludes odd Node lines, which the development machine runs |
| @playwright/test | 1.63.0 | Pinned exactly; Electron support is experimental |
| electron-builder | 26.15.3 | Configuration only in this feature |
| eslint / @eslint/js / typescript-eslint / eslint-plugin-react-hooks | 10.10.0 / 10.0.1 / 8.69.0 / 7.1.1 | Flat config in JavaScript, so no `jiti` |
| prettier | 3.9.6 | |
| @types/node | 22.20.1 | Matches the runners' Node 22 |

## 5. Smaller decisions, recorded so they are not re-decided

- **Theme**: the engine's two themes map to the operating system's
  preference - `prefers-color-scheme: light` sets `data-theme="sepia"` on
  the root; otherwise the `:root` warm-dark values apply. No toggle yet
  (A4-03).
- **Tokens drift test**: reads the engine's `page.html` from
  `LEGIBLE_ENGINE_CHECKOUT` when set and compares its two theme blocks with
  `tokens.css` after whitespace normalisation; when unset (the runners, until
  the engine is vendored at a tag), it skips with a message naming the
  variable. The pinned-engine form of the test activates with the `engine`
  block in `vendor/pins.json` (A0-06, E11a).
- **Configuration parsing**: a twenty-line parser rather than a dependency;
  the format is fixed in `contracts/config.md`.
- **Logger**: one module writing to stderr with a level and a tag; A6-03
  redirects it to a file.
- **Quit**: `window-all-closed` quits on Windows and Linux and, by platform
  convention, not on macOS; the smoke test closes the application through
  Playwright, which resolves when the process exits.
- **Content types**: a small map by extension in the handler; unknown
  extensions are `application/octet-stream`.
