# Implementation Plan: Electron skeleton

**Branch**: `main` (committed directly; this feature creates the `ci` check that ends direct commits) | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-electron-skeleton/spec.md`, clarified 2026-09-07.

## Summary

A running, nearly empty Electron application: one window titled `Legible
Cities` opening to an empty Library; one custom origin, `app://local`,
serving the interface and, by routing only, generated project output; a
preload bridge with a single method; a development loop against the sibling
engine checkout configured by `.env.local`; a check on Linux, macOS and
Windows that lints, typechecks, unit-tests and launches the real app once.
Nothing draws, nothing runs the engine, nothing is vendored (that is
`specs/002`). The technical approach is electron-vite's three-process layout
with the renderer served through the custom scheme in development as well as
in production, so the origin never differs.

## Technical Context

**Language/Version**: TypeScript 5.9 (typescript-eslint supports `<6.1`, so
not 7.x yet), Node.js 22 LTS on the runners, ES2022 output.

**Primary Dependencies**: Electron 44.2 (the version the capture spike
measured), electron-vite 5 (peer: Vite 7, `@swc/core`), Vite 7.3, React 19,
`@vitejs/plugin-react` 5 (the 6 line needs Vite 8). Tooling: Vitest 5,
Playwright 1.63 (the `playwright` package; no browsers downloaded, only its
Electron driver is used), ESLint 10 with typescript-eslint 8, Prettier 3,
electron-builder 26 (configuration only in this feature). Exact pins in
`package.json`; the reasoning per choice in `research.md`.

**Storage**: none. Reads `<engine home>/out/<id>/` if asked; writes nothing.

**Testing**: Vitest for pure main-side modules (path validation,
configuration parsing, tokens drift); one Playwright Electron end-to-end
smoke test against the built app; `xvfb-run` on the Linux runner.

**Target Platform**: macOS 15+ (arm64 and Intel) and Windows 10/11 x64 as
targets; Linux as a verification platform only.

**Project Type**: desktop app, three processes (main, preload, renderer).

**Performance Goals**: window within 10 s of launch on the two target
machines (SC-001); the smoke test within 60 s per platform (SC-003).

**Constraints**: no outbound network request in normal operation (FR-034);
context isolation on, Node integration off, sandbox on (FR-014); nothing
written beside the source or build output (SC-009); no map, no engine, no
child process in this feature (FR-032, FR-033).

**Scale/Scope**: one window, one screen, one bridge method, two route
prefixes, about a dozen source files and three test files.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design below.*

| Principle or constraint | How this plan complies |
|---|---|
| I. One renderer | The renderer draws a heading and a sentence. No SVG, no canvas, no map library in `package.json`. FR-032 is a review line. |
| II. The engine is the source of truth | No engine logic; the design tokens are copied from the engine's page and a test refuses drift (FR-007). |
| III. Determinism is a feature | Not exercised. Nothing captured or exported. |
| IV. No network, no telemetry | The only fetch the app makes is the main process proxying the Vite dev server on `localhost` in development; a packaged build fetches nothing. CSP on the interface allows `'self'` only, plus the HMR websocket in development. No update check, no crash reporter, no CDN font. |
| V. Hygiene by tools | The existing hooks and workflows cover the new files; `.env.local` is already ignored; `.env.example` carries no real path. |
| VI. Accessible by default | The Library is a labelled `main` region with an `h1` and a `role="status"` empty state; tokens hold contrast in both themes; a `prefers-reduced-motion` rule disables the only transition. There are no interactive controls yet, so keyboard reach is trivially complete and stays a review line for every later screen. |
| VII. Decisions recorded | ADR-013 (the origin) and ADR-016 (the engine home) are the records this feature builds on; `research.md` records the three technical choices with alternatives. No new ADR: nothing here is hard to reverse except what those two already fix. |
| Never write inside the bundle | Engine home defaults to `<userData>/engine`; the app writes nothing at all in this feature. |
| `app://local` is one origin | FR-008 to FR-013; the dev-server proxy exists precisely so development does not introduce a second origin. |
| The renderer holds no Node APIs | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the bridge exposes one method (`contracts/bridge.md`). |
| Child processes | None spawned. |
| GPL-3.0-or-later, third parties listed | New runtime dependencies (Electron, React) and development tooling (electron-vite, Vite, Vitest, Playwright, ESLint, Prettier, electron-builder) are added to `THIRD_PARTY_NOTICES.md`. |

**Post-design re-check**: the design in `data-model.md` and `contracts/`
adds no surface beyond the above. The one judgement call is the dev-server
proxy (principle IV): it is a fetch to `localhost` from the main process,
in development only, and the alternative (loading `http://localhost:5173`
directly, as electron-vite's template does) would make the development
origin differ from the packaged one, which the spec forbids (FR-009).

## Project Structure

### Documentation (this feature)

```text
specs/001-electron-skeleton/
├── plan.md              # This file
├── research.md          # Phase 0: the three verified unknowns and the version pins
├── data-model.md        # Phase 1: origin, identifier, asset path, Library, engine home, configuration, tokens, window
├── quickstart.md        # Phase 1: what to run and what it proves
├── contracts/
│   ├── bridge.md        # window.api and its IPC channel
│   ├── origin.md        # app://local routes, refusals, content types, CSP
│   └── config.md        # .env.local format and the startup log lines
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json                 # scripts: dev, build, start, lint, format, typecheck, test, test:e2e, dist
package-lock.json
electron.vite.config.ts      # main / preload / renderer; renderer base "/ui/", fixed dev port, HMR host
electron-builder.yml         # productName, appId, targets; no extraResources (specs/002)
tsconfig.json                # references the two below
tsconfig.node.json           # main + preload + shared + tests/unit
tsconfig.web.json            # renderer + shared
eslint.config.js             # flat config: @eslint/js, typescript-eslint, react-hooks
.prettierrc
.env.example                 # every key from contracts/config.md, documented, no real path
src/
├── main/
│   ├── index.ts             # app lifecycle: single-instance lock, scheme registration, window, quit
│   ├── config.ts            # .env.local parsing, defaults, the [config] log lines (pure: testable)
│   ├── log.ts               # one logger, stderr, level + tag
│   ├── protocol.ts          # protocol.handle("app"): /ui/ (built or proxied) and /projects/
│   ├── paths.ts             # project id + asset path validation, safe resolution (pure: testable)
│   └── library.ts           # library:list handler, returns []
├── preload/
│   └── index.ts             # contextBridge.exposeInMainWorld("api", …)
├── shared/
│   └── api.ts               # the bridge's types and channel names
└── renderer/
    ├── index.html
    └── src/
        ├── main.tsx         # React root; sets data-theme from prefers-color-scheme
        ├── App.tsx          # the Library region and its empty state
        └── styles/
            ├── tokens.css   # copied from the engine page's two theme blocks; tested for drift
            └── app.css      # layout, focus, reduced motion; consumes tokens only
tests/
├── unit/
│   ├── paths.test.ts        # the traversal matrix (SC-005), both separators
│   ├── config.test.ts       # parsing, precedence, defaults, log lines
│   └── tokens.test.ts       # tokens.css equals the engine page's blocks; skips with a message if no engine
└── e2e/
    └── smoke.spec.ts        # Playwright Electron: launch built app, title, empty state, quit, exit
.github/workflows/ci.yml     # matrix ubuntu-22.04 / macos-15 / windows-latest; job name "ci (<os>)"
docs/ARCHITECTURE.md         # the technical architecture, present tense for what exists
```

**Structure Decision**: electron-vite's conventional three-directory layout
under `src/`, because its build produces `out/main`, `out/preload` and
`out/renderer` that the protocol handler and the smoke test address by name,
and because the assistant's rule scopes (`src/main/**`,
`src/renderer/**`) were written for it. Pure modules (`paths.ts`,
`config.ts`) import nothing from Electron so Vitest runs them in Node.

## Complexity Tracking

No constitution violations to justify. One deliberate extra, recorded here
rather than as a violation: the development proxy in `protocol.ts` (about
twenty lines) exists to keep FR-009 true in development; the simpler
alternative, loading the dev server's URL directly, was rejected because it
is exactly the second origin the constitution forbids.
