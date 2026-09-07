# Tasks: Electron skeleton

**Input**: `specs/001-electron-skeleton/` - plan.md, research.md, data-model.md, contracts/, quickstart.md, spec.md (clarified 2026-09-07).

**Tests**: wanted. Unit tests for path validation, configuration parsing and tokens drift, and one Playwright Electron smoke test, are part of the feature (spec A-008, FR-027, FR-028). Each story's tests come before its implementation.

**Organisation**: by user story, so each is an independently testable increment. Story 1 is the MVP; stories 2 to 4 each add one load-bearing property (the origin, the dev loop, the checks).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelisable (different files, no dependency on an unfinished task)
- **[US1]**..**[US4]**: the user story from spec.md
- Every description names its file(s)

## Path Conventions

electron-vite's three-process layout under `src/` (`main/`, `preload/`, `renderer/`, plus `shared/`), tests under `tests/unit/` and `tests/e2e/`, build output under `out/` (ignored). See plan.md "Project Structure".

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the toolchain, pinned, before any source exists.

- [ ] T001 Create `package.json`: `"name": "legible-cities-app"`, `"productName": "Legible Cities"`, `"version": "0.0.0"`, `"private": true`, `"main": "./out/main/index.js"`, `"license": "GPL-3.0-or-later"`; scripts `dev` (electron-vite dev), `build` (electron-vite build), `start` (electron-vite preview), `lint` (eslint . && prettier --check .), `format` (prettier --write .), `typecheck` (tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json), `test` (vitest run), `test:e2e` (playwright test), `dist` (electron-builder --dir); devDependencies pinned exactly as research.md section 4 (electron 44.2.0, electron-vite 5.0.0, vite 7.3.6, @vitejs/plugin-react 5.2.0, @swc/core 1.16.2, typescript 5.9.3, vitest 4.1.11, @playwright/test 1.63.0, electron-builder 26.15.3, eslint 10.10.0, @eslint/js 10.0.1, typescript-eslint 8.69.0, eslint-plugin-react-hooks 7.1.1, prettier 3.9.6, @types/node 22.20.1, @types/react 19.2.18, @types/react-dom 19.2.7); dependencies react 19.2.8, react-dom 19.2.8; `"engines": { "node": ">=22.12.0" }`
- [ ] T002 Create `electron.vite.config.ts`: `main` and `preload` with `externalizeDepsPlugin()`; `renderer` with `react()`, `resolve.alias` `@renderer` → `src/renderer/src`, and `server: { host: 'localhost', port: 5173, strictPort: true, hmr: { protocol: 'ws', host: 'localhost', clientPort: 5173 } }` (research.md section 2; no `base`, no `hmr.port`, no `hmr.path`)
- [ ] T003 [P] Create `tsconfig.json` (references only), `tsconfig.node.json` (main, preload, shared, tests/unit, tests/e2e; `module: ESNext`, `moduleResolution: bundler`, `strict`, `types: ["node"]`) and `tsconfig.web.json` (renderer, shared; `jsx: react-jsx`, `lib: ["ESNext", "DOM", "DOM.Iterable"]`, `strict`)
- [ ] T004 [P] Create `eslint.config.js` (flat: `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react-hooks` recommended; ignores `out/`, `release/`, `node_modules/`, `.claude/`, `.specify/`) and `.prettierrc` (`semi: false`, `singleQuote: true`, `printWidth: 100`) and `.prettierignore` (`out/`, `release/`, `package-lock.json`, `*.md`, `.claude/`, `.specify/`, `specs/`, `docs/`, `vendor/`)
- [ ] T005 [P] Create `electron-builder.yml`: `appId: com.richardcaballero.legiblecities`, `productName: Legible Cities`, `directories: { output: release, buildResources: build }`, `files: [out/**, package.json]`, `mac: { target: [dmg] }`, `win: { target: [nsis] }`, `asar: true`; a comment that `extraResources` arrives with `specs/002`
- [ ] T006 [P] Create `.env.example` with every key from contracts/config.md, each with a comment and no real path; extend `.gitignore` with `release/`, `test-results/`, `playwright-report/` (`.env*`, `out/`, `node_modules/` are already there)
- [ ] T007 Run `npm install` to produce `package-lock.json`, then `npx install-electron --no` to fetch the Electron binary; commit the lockfile (research.md section 3: the binary is not fetched by `npm ci`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pure modules and the two test runners every story's tests need. No window yet.

- [ ] T008 Create `src/shared/api.ts`: `ProjectSummary { id: string; name: string }`, `Api { library: { list(): Promise<ProjectSummary[]> } }`, `CHANNELS = { libraryList: 'library:list' } as const`, and the `declare global { interface Window { api: Api } }` augmentation (contracts/bridge.md)
- [ ] T009 [P] Create `src/main/log.ts`: `log(tag, message)`, `warn`, `error` writing `[tag] message` lines to stderr through one function so A6-03 can redirect; no dependency on Electron
- [ ] T010 [P] Create `src/main/config.ts` (pure, no Electron import): `parseEnvFile(text): Record<string,string>` per contracts/config.md (KEY=value, `#` comments, quote stripping, no interpolation); `resolveConfig({ fileText, env, userData }): { home, loomBin, ffmpeg, engineCheckout, sources, unknownKeys, fileFound }` with environment winning over the file and `home` defaulting to `<userData>/engine`; `describeConfig(config): string[]` returning exactly the `[config]` lines of the contract
- [ ] T011 [P] Create `src/main/paths.ts` (pure, no Electron import): `isValidProjectId(id)` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, never `.`/`..`); `decodeAssetPath(raw): string[] | null` (single percent-decode, reject control characters and backslashes, split, reject empty/`.`/`..` segments); `resolveInside(root, segments, { realpath, sep, caseInsensitive }): Promise<string | null>` implementing data-model.md's steps 3 and 4 with injectable `realpath` so tests need no symlinks except the outward-symlink case; `contentTypeFor(filename)` with the map from contracts/origin.md
- [ ] T012 [P] Create `vitest.config.ts`: `test.include: ['tests/unit/**/*.test.ts']`, `environment: 'node'`; and `playwright.config.ts`: `testDir: 'tests/e2e'`, `workers: 1`, `timeout: 60_000`, `expect.timeout: 10_000`, `reporter: process.env.CI ? 'github' : 'list'`, no `projects` (research.md section 3)

**Checkpoint**: `npm run typecheck` and `npm run lint` pass on an empty test set; `npm test` reports no tests.

---

## Phase 3: User Story 1 - The application opens to an empty Library (Priority: P1) 🎯 MVP

**Goal**: one window titled `Legible Cities` with a labelled Library region and a readable empty state; quits cleanly; keyboard, screen reader and reduced motion respected; tokens from the engine page.

**Independent Test**: `npm run build && npm run test:e2e` launches the built app, finds the title and the empty state, closes it and confirms the process ended. `npm run dev` shows the same window by eye.

### Tests for User Story 1

- [ ] T013 [P] [US1] Create `tests/unit/tokens.test.ts`: read `src/renderer/src/styles/tokens.css`; if `LEGIBLE_ENGINE_CHECKOUT` (from the environment or a `.env.local` at the repo root) names a directory containing `src/schematic/page/page.html`, extract that page's `:root {…}` and `:root[data-theme="sepia"] {…}` blocks, normalise whitespace and comments, and assert equality with the two blocks in tokens.css; otherwise `test.skip` with the message naming the variable (research.md section 5)
- [ ] T014 [P] [US1] Create `tests/e2e/smoke.spec.ts`: `_electron.launch({ args: ['.'], cwd: repoRoot, env: { ...process.env, SCHEMATIC_HOME: <a fresh temp dir> }, timeout: 30_000 })`; `firstWindow()`; `expect(window).toHaveTitle('Legible Cities')`; `expect(window.getByRole('status')).toContainText(/no projects/i)`; `expect(window.getByRole('heading', { level: 1 })).toHaveText('Library')`; `app.close()` and assert the process exited (`app.process().exitCode !== null` after close, or a bounded wait); the launch env must not point at the developer's engine home

### Implementation for User Story 1

- [ ] T015 [P] [US1] Create `src/renderer/src/styles/tokens.css`: a header comment naming the source (the engine's `src/schematic/page/page.html`, both theme blocks, pinned engine) then the two blocks verbatim; nothing else
- [ ] T016 [P] [US1] Create `src/renderer/src/styles/app.css`: `html, body` background `var(--bg)`, colour `var(--text)`, system font stack, `main` as a centred column with `var(--bg-soft)` panel and `var(--border)`; `:focus-visible` outline `var(--focus)`; one `transition` on the panel and `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important } }`; no colour or spacing literal outside tokens
- [ ] T017 [P] [US1] Create `src/renderer/index.html`: `<html lang="en">`, `<title>Legible Cities</title>`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`; no inline script, no external URL
- [ ] T018 [US1] Create `src/renderer/src/main.tsx`: import both stylesheets; set `document.documentElement.dataset.theme = 'sepia'` when `matchMedia('(prefers-color-scheme: light)').matches` (and on change), else remove it; `createRoot(...).render(<App />)`
- [ ] T019 [US1] Create `src/renderer/src/App.tsx`: `<main aria-labelledby="library-heading">`, `<h1 id="library-heading">Library</h1>`, on mount call `window.api.library.list()`; while pending render nothing that reads as broken; when empty render `<p role="status">No projects yet. The first feed and the first project arrive with a later release.</p>`; when non-empty render a list (unreachable in this feature but typed)
- [ ] T020 [US1] Create `src/preload/index.ts`: `contextBridge.exposeInMainWorld('api', { library: { list: () => ipcRenderer.invoke(CHANNELS.libraryList) } })` typed as `Api`; nothing else exposed
- [ ] T021 [US1] Create `src/main/library.ts`: `registerLibrary(ipcMain)` handling `CHANNELS.libraryList` and returning `[]` (contracts/bridge.md: A1-05 fills it)
- [ ] T022 [US1] Create `src/main/index.ts`: at top level `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`; `app.requestSingleInstanceLock()` and quit if not obtained, `second-instance` focuses and restores the window; on `whenReady`: register the library handler, create one `BrowserWindow({ title: 'Legible Cities', width: 1100, height: 720, minWidth: 640, minHeight: 480, show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })`, `ready-to-show` → show, `loadURL('app://local/ui/')` (the handler lands in T026; until then this task may load the dev URL behind a TODO that T026 removes); `window-all-closed` quits except on darwin; `activate` recreates the window on darwin
- [ ] T023 [US1] Run `npm run build && npm run test:e2e` locally; then `npm run dev` and check by eye: one window, the heading, the empty state, keyboard focus visible on nothing broken, quit ends the process

**Checkpoint**: User Story 1 passes its smoke test on this machine.

---

## Phase 4: User Story 2 - The interface and generated project pages share one origin (Priority: P1)

**Goal**: `app://local` serves the interface (built or proxied) and `/projects/<id>/…` from the engine home, refusing every escape; the document origin is `app://local` in development and packaged.

**Independent Test**: `npm test` runs the traversal matrix; the smoke test asserts `location.origin === 'app://local'` and that `/projects/../x` is 403 and `/projects/nope/a` is 404 from inside the page.

### Tests for User Story 2

- [ ] T024 [P] [US2] Create `tests/unit/paths.test.ts` covering `isValidProjectId` (valid ids; `.`, `..`, empty, leading dot, slash, backslash, drive letter `C:`, 65 chars, unicode), `decodeAssetPath` (`a/b.html`; `..`; `%2e%2e`; `%2f` encoded separator; `a\\b`; `%00`; absolute `/etc/passwd`; double-encoding `%252e%252e` must stay literal and be rejected as a segment containing `%`? - no: it decodes once to `%2e%2e`, a legal filename, so the test asserts it is accepted as a segment and never resolves outside), and `resolveInside` with an injected `realpath`: inside → path; outward symlink (realpath returns a path outside root) → null; root itself → null when a file is expected; Windows `sep: '\\'` with `caseInsensitive: true` and a root that differs only by case → inside
- [ ] T025 [US2] Extend `tests/e2e/smoke.spec.ts`: `await window.evaluate(() => location.origin)` equals `app://local`; `await window.evaluate(() => fetch('/projects/../x').then(r => r.status))` is 403; `/projects/nope/a` is 404; `/projects/p1/index.html` is 200 with `text/html` after the test creates `<SCHEMATIC_HOME>/out/p1/index.html` in its temp dir before launch; the 403 and 404 bodies contain no `/` (no path)

### Implementation for User Story 2

- [ ] T026 [US2] Create `src/main/protocol.ts`: `registerAppProtocol({ devUrl, uiRoot, engineHome })` calling `protocol.handle('app', handler)`; handler: parse URL, host !== 'local' → 403; method not GET/HEAD → 405; `/projects/<id>/<rest>` → `isValidProjectId` else 404, `decodeAssetPath` else 403, `resolveInside(join(engineHome, 'out', id), …)` else 403, stat → 404 for missing or directory, else `new Response(Readable.toWeb(createReadStream(abs)), { headers: { 'content-type': contentTypeFor(abs) } })` (HEAD: no body); otherwise, if `devUrl`: `net.fetch(devUrl + stripped + search, { method, headers })` where `stripped` removes a leading `/ui` (so `/ui/` → `/`); else `/ui/` → `index.html`, `/ui/<rest>` → `resolveInside(uiRoot, …)` and stream; add the CSP header to HTML responses (contracts/origin.md; the development variant adds `ws://localhost:5173` and `'unsafe-inline'` for scripts); log every refusal with the URL only
- [ ] T027 [US2] Wire it in `src/main/index.ts`: after `whenReady`, before the window, `registerAppProtocol({ devUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL, uiRoot: join(__dirname, '../renderer'), engineHome })`; remove any dev-URL fallback from T022; the window always loads `app://local/ui/`
- [ ] T028 [US2] Run `npm test`, then `npm run build && npm run test:e2e`, then `npm run dev` and confirm HMR still updates the window (the proxy and the HMR config together)

**Checkpoint**: Stories 1 and 2 pass; the origin is fixed.

---

## Phase 5: User Story 3 - A developer runs the application against a local engine checkout (Priority: P2)

**Goal**: `.env.local` read at startup, the three locations logged with their source, documented defaults when absent; one command starts the dev loop.

**Independent Test**: with `.env.local` present, `npm run dev` prints the `[config]` lines with `(.env.local)`; with it renamed away, the lines say `(default)` and `unset … set it in .env.local`; editing `App.tsx` updates the window.

### Tests for User Story 3

- [ ] T029 [P] [US3] Create `tests/unit/config.test.ts`: `parseEnvFile` (comments, blank lines, quotes, `=` in values, CRLF); `resolveConfig` precedence (environment over file over default), the default home under the given userData, unknown keys reported, `fileFound` false when no text; `describeConfig` produces exactly the lines in contracts/config.md for the set, unset and default cases

### Implementation for User Story 3

- [ ] T030 [US3] In `src/main/index.ts`: in development read `<repo root>/.env.local` (path from `app.getAppPath()`), call `resolveConfig` with `process.env` and `app.getPath('userData')`, log `describeConfig` lines through `log.ts` before the window opens, and pass `config.home` as `engineHome` to the protocol; in a packaged build read the environment only; never write to the home
- [ ] T031 [P] [US3] Write `docs/ARCHITECTURE.md`: the three processes, the origin and its routes (link contracts/origin.md), the bridge (link contracts/bridge.md), configuration and the startup log (link contracts/config.md), what is deliberately absent (engine, capture, installers) with the issue that adds each; present tense for what exists, no private paths or hosts
- [ ] T032 [P] [US3] Extend `README.md` with a "Developing" section: prerequisites, `cp .env.example .env.local`, `npm ci`, `npx install-electron --no`, `npm run dev`, the test commands; link `docs/ARCHITECTURE.md` and `specs/001-electron-skeleton/quickstart.md`
- [ ] T033 [US3] Run `npm run dev` with and without `.env.local` and confirm the log lines match the contract

**Checkpoint**: the daily loop works and is documented.

---

## Phase 6: User Story 4 - Every change is checked automatically on all three platforms (Priority: P2)

**Goal**: `ci.yml` runs lint, typecheck, unit tests, build and the smoke test on Ubuntu, macOS and Windows; the checks are nameable; branch protection is applied and CONTRIBUTING flips.

**Independent Test**: push; three green `ci (<os>)` checks; a deliberately broken title on a branch turns them red.

### Implementation for User Story 4

- [ ] T034 [US4] Create `.github/workflows/ci.yml`: `on: [push (branches: [main]), pull_request]`; `permissions: contents: read`; `jobs.ci` with `name: ci (${{ matrix.os }})`, `strategy.fail-fast: false`, `matrix.os: [ubuntu-22.04, macos-15, windows-latest]`; steps: `actions/checkout@v6`, `actions/setup-node@v6` (`node-version: 22`, `cache: npm`), `npm ci`, `npx install-electron --no`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then the smoke test: on Linux `xvfb-run -a npm run test:e2e`, elsewhere `npm run test:e2e` (`if: runner.os == 'Linux'` / `!= 'Linux'`); upload `test-results/` on failure
- [ ] T035 [P] [US4] Update `CLAUDE.md`: replace "Nothing else yet. Do not invent npm scripts" with the script list and one line each; update "Where things stand"; and add to `.claude/settings.json` allow rules `Bash(npm ci)`, `Bash(npm run lint*)`, `Bash(npm run typecheck*)`, `Bash(npm test*)`, `Bash(npm run test:e2e*)`, `Bash(npm run build*)`, `Bash(npx install-electron*)`
- [ ] T036 [P] [US4] Update `THIRD_PARTY_NOTICES.md`: Electron and React rows no longer "(planned)"; add development tooling rows for electron-vite, Vite, Vitest, Playwright, ESLint, Prettier, TypeScript, electron-builder (present in the repository, not shipped)
- [ ] T037 [US4] Commit and push to both remotes with `bin/preflight` clean; watch the three `ci (<os>)` checks to green; fix and repeat until they are
- [ ] T038 [US4] Flip the workflow in one final direct commit: `CONTRIBUTING.md` "Where things stand" and "Branch and pull request" say `main` now changes only through pull requests; `docs/repository-settings.md` branch-protection boxes ticked with the date; `CLAUDE.md` "Where things stand" likewise; push
- [ ] T039 [US4] Apply branch protection on the mirror through the API: require a pull request, required status checks `ci (ubuntu-22.04)`, `ci (macos-15)`, `ci (windows-latest)`, `gitleaks`, `preflight`, strict (up to date), no force pushes, no deletions; verify by reading the protection back and by observing that a direct push of a throwaway commit is refused, then discard that commit

**Checkpoint**: the repository has a gate; the next change is a pull request.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T040 Negative checks for SC-003, locally: change the window title, run the smoke test, see it fail, restore; introduce a type error, run `npm run typecheck`, see the file and line named, restore
- [ ] T041 [P] Run `bin/preflight`, `pre-commit run --all-files`, `gitleaks dir . --redact` and `bin/test-hooks`; fix anything reported
- [ ] T042 [P] Run the repository's `reviewer` subagent over the feature's diff (correctness, leaks, a second renderer creeping in, child processes without a timeout) and address findings
- [ ] T043 Close A0-09 on both boards with what was tested by hand and on which OS (CONTRIBUTING's definition of done); update the roadmap's Phase 0 status and `CLAUDE.local.md`

---

## Dependencies & Execution Order

- Setup (T001-T007) → Foundational (T008-T012) → Story 1 (T013-T023) → Story 2 (T024-T028) → Story 3 (T029-T033) → Story 4 (T034-T039) → Polish (T040-T043).
- Story 2 depends on Story 1's window and main entry; Story 3 on Story 2's protocol taking `engineHome`; Story 4 on everything passing locally. Stories 1 to 3 are each testable on their own on this machine; Story 4 needs the mirror.
- T039 runs only after T037 is green and T038 is pushed, because protection blocks the direct push T038 needs.

## Parallel Execution Examples

- Setup: T003, T004, T005, T006 together after T001.
- Foundational: T009, T010, T011, T012 together after T008.
- Story 1: T013 and T014 (tests) with T015, T016, T017 (static files) together; then T018-T022 in order.
- Story 2: T024 with T026.
- Story 3: T029 with T031 and T032.
- Story 4: T035 and T036 with T034.

## Implementation Strategy

1. Setup + Foundational + Story 1 = the MVP: a window that opens to an empty Library and passes one smoke test locally. Stop and look at it.
2. Story 2 fixes the origin before anything is built on the wrong one.
3. Story 3 makes the daily loop honest about its configuration.
4. Story 4 turns the checks on and ends direct commits - the last direct commit is the one that says so.
