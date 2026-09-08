# Contract: the application origin (`app://local`)

Registered with `protocol.registerSchemesAsPrivileged` before the app is
ready, handled with `protocol.handle("app", …)` in the main process. One
scheme, one host, for the interface and for generated project pages.

The original reason for that was wrong. ADR-013 said the two had to share an
origin so a later feature could reach `iframe.contentWindow`; A3-02 found
that a parent never needed to, because the main process injects into a
frame's main world whatever its origin. The viewer's frame is sandboxed to
an opaque origin, and generated pages are served with a policy of their own
rather than the interface's (ADR-028).

## Routes

| URL | Response |
|---|---|
| `app://local/ui/` and `app://local/ui/index.html` | The interface document |
| `app://local/ui/<asset>` | A built renderer asset (packaged), or the same path fetched from the Vite dev server and returned as-is (development). The document origin is `app://local` in both. |
| `app://local/projects/<id>/<path>` | The file `<engine home>/out/<id>/<path>`, streamed, with a content type from the extension |
| `app://local/projects/<id>/` | 404: no directory listings |
| anything else | 404 |

Only `GET` and `HEAD` are served; other methods are 405.

## Refusals

| Case | Status | Body |
|---|---|---|
| Identifier fails validation (`data-model.md`) | 404 | `not found` |
| Project directory does not exist | 404 | `not found` |
| Asset path fails validation, or resolves outside the project directory (traversal, absolute, encoded separator, outward symlink) | 403 | `forbidden` |
| File missing, or is a directory | 404 | `not found` |
| Method not `GET`/`HEAD` | 405 | `method not allowed` |

Bodies are those literal strings. No response ever carries a filesystem path,
the engine home, or a stack trace (FR-012). Refusals are logged on the main
side with the URL, not the resolved path.

## Content types

By extension: `html`, `js`/`mjs`, `css`, `json`, `svg`, `png`, `jpg`/`jpeg`,
`webp`, `gif`, `woff2`, `woff`, `ttf`, `map`, `txt`, `wasm`. Unknown
extensions are `application/octet-stream`. HTML is served with a
`Content-Security-Policy` header:

- `/ui/`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` (the style allowance since `specs/005`: the control kit styles its shadow roots with inline `<style>` elements) — plus, in development only, `ws://localhost:5173` in `connect-src` for Vite's HMR client and `'unsafe-inline'` in `script-src` and `style-src` for its injected client and styles.
- `/projects/`: reserved for the viewer feature (A3-02); the generated page is self-contained and will need inline scripts. Not served in this feature beyond the routing above.

## Privileges

`standard: true, secure: true, supportFetchAPI: true, stream: true` (the
exact set is confirmed in `research.md`). Never `bypassCSP`.
