# Tasks: Project

**Input**: `specs/003-project/` - plan.md, research.md, data-model.md, contracts/, quickstart.md, spec.md (clarified 2026-09-07).

**Tests**: wanted. Unit tests for the record validators and defaults and for the store against a temporary directory; the Playwright Electron smoke test extended over the lifecycle and the served output of a real project (FR-017, SC-005, SC-006). Each story's tests come before its implementation.

**Organisation**: by user story. Story 1 (create and find again) is the MVP; Story 2 adds the lifecycle; Story 3 ties the origin to real projects; Story 4 is the accessibility walk.

## Format: `[ID] [P?] [Story] Description`

## Path Conventions

As the skeleton: `src/shared/`, `src/main/`, `src/preload/`, `src/renderer/src/`, `tests/unit/`, `tests/e2e/`. See plan.md "Project Structure".

---

## Phase 1: Setup

- [ ] T001 Read `specs/003-project/contracts/record.md` and `data-model.md`; no scaffolding needed - the toolchain is the skeleton's. Confirm `npm test` and `npm run test:e2e` are green on `main` before touching anything.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the record type and the bridge contract every story uses.

- [ ] T002 Create `src/shared/project.ts` (pure): `RECORD_VERSION = 1`; `ProjectRecord`, `ProjectSummary`, `CreateProjectInput`, `DeleteResult` per data-model.md and contracts/bridge.md; `DEFAULT_STYLE`, `DEFAULT_COLOR = '#888888'`, `DEFAULT_THEME = 'warm-dark'`; validators `validateName`, `validateFeedKey`, `validateMode`, `validateAgency` returning `null` or the person-facing message from contracts/bridge.md; `ID_PATTERN = /^[a-z][a-z0-9]{11}$/`; `parseRecord(json: unknown): { record: ProjectRecord; readOnly: boolean } | { error: string }` filling defaults for missing optional fields, refusing a missing `id`/`name`/`feed`/`version`, marking `readOnly` when `version > RECORD_VERSION`; `summarise(record, readOnly): ProjectSummary`
- [ ] T003 Update `src/shared/api.ts`: `Api.projects` with `list`, `get`, `create`, `rename`, `delete` typed per contracts/bridge.md; remove `library`; `CHANNELS` gains `projectsList: 'projects:list'`, `projectsGet`, `projectsCreate`, `projectsRename`, `projectsDelete`
- [ ] T004 [P] Create `tests/unit/project.test.ts`: validators (blank, whitespace-only, 121 characters, valid; feed key forms; mode forms; agency length); `parseRecord` on a full record, a record missing optional fields (defaults filled), a record with `version: 2` (readOnly), a record missing `id` (error), non-object input (error); `summarise`

**Checkpoint**: `npm run typecheck` passes with the preload and renderer temporarily broken by the removed `library` (fixed in Story 1); `tests/unit/project.test.ts` green.

---

## Phase 3: User Story 1 - Create a project and find it again (Priority: P1) 🎯 MVP

**Goal**: a project created from the Library persists under the engine home and is listed after a relaunch.

**Independent Test**: create in the Library, relaunch, see it; the unit tests prove the store.

### Tests for User Story 1

- [ ] T005 [P] [US1] Create `tests/unit/projects-store.test.ts` against `mkdtemp` roots: `create` writes `projects/<id>/project.json` matching contracts/record.md (pretty, trailing newline) with a valid id and identical `created`/`modified`; `list` returns summaries newest first and skips a folder with no record, a folder with invalid JSON and a record missing `id`, each logged through an injected logger; `get` returns the record and `readOnly: true` for `version: 2`; a leftover `project.json.tmp` is ignored by `list` and `get`; the id never matches a reserved device name (assert `isValidProjectId` from `src/main/paths.ts` over 200 generated ids); two creates with the same name yield two projects
- [ ] T006 [P] [US1] Extend `tests/e2e/smoke.spec.ts` (keep the existing assertions): from the empty Library press the create button (`getByRole('button', { name: /new project/i })`), assert the dialog is open (`getByRole('dialog')`) with focus on the name field, type a name, keep the default feed key, confirm; assert the Library lists it with the feed key and "not yet chosen"; assert `projects/<id>/project.json` exists under the test's `SCHEMATIC_HOME` and parses with `version: 1`; close the app, relaunch with the same `SCHEMATIC_HOME`, assert the entry is still listed

### Implementation for User Story 1

- [ ] T007 [US1] Create `src/main/projects.ts`: `class ProjectStore { constructor(root: string, log: (m: string) => void) }` with `list()`, `get(id)`, `create(input)`, `rename(id, name)`, `delete(id)`; private `dir(id)`, `file(id)`, `writeAtomic(id, record)` (write `project.json.tmp`, `rename`), `newId()` (12 chars `[a-z][a-z0-9]{11}` from `randomBytes`, rejected and regenerated if `isValidProjectId` says no); `list` uses `readdir` with `withFileTypes`, reads each `project.json`, applies `parseRecord`, skips and logs failures by folder name; every id from the caller passes `ID_PATTERN` and `isValidProjectId` before any path is built
- [ ] T008 [US1] Create `src/main/ipc.ts` replacing `src/main/library.ts`: `registerProjectHandlers(ipcMain, store, isTopFrame)` with one `ipcMain.handle` per channel; each validates its arguments with the shared validators before calling the store and rejects with the contract's message; `isTopFrame(event)` refuses a call whose `senderFrame` is not the main window's top frame (contracts/bridge.md). Delete `src/main/library.ts`
- [ ] T009 [US1] Update `src/main/index.ts`: construct `new ProjectStore(join(config.home, 'projects'), (m) => log.warn('projects', m))` after config, pass it and a `isTopFrame` closure over `mainWindow` to `registerProjectHandlers`
- [ ] T010 [US1] Update `src/preload/index.ts`: expose `projects.{list,get,create,rename,delete}` as thin `ipcRenderer.invoke` wrappers typed as `Api`; nothing else
- [ ] T011 [P] [US1] Create `src/renderer/src/CreateProjectDialog.tsx`: a `<dialog aria-labelledby aria-describedby>` opened with `showModal()` through a ref when `open` is true; fields Name (required, autofocus) and Feed key (default `la-metro-rail`, with a sentence that the list of feeds arrives later); client-side messages from the shared validators shown inline with `aria-describedby` on the field; Cancel (closes) and Create (calls `onCreate`, shows a main-side error message if the promise rejects); Escape cancels via the `cancel` event; `onClose` when the dialog closes so the opener regains focus
- [ ] T012 [US1] Create `src/renderer/src/Library.tsx`: loads `projects.list()` on mount and after every change; heading, the **New project** button, the empty state (`role="status"`, keeps the skeleton's sentence when empty), and a list of entries as buttons (`aria-label` "Open <name>") showing name, feed key, and `date ?? 'not yet chosen'`; `onOpen(id)`
- [ ] T013 [US1] Update `src/renderer/src/App.tsx`: local state `{ screen: 'library' } | { screen: 'project'; id }`; renders `Library` or `ProjectView` (T016); keep `main` as the landmark
- [ ] T014 [US1] Extend `src/renderer/src/styles/app.css` with list, button, form field, message and dialog styles from tokens only (`--bg-soft`, `--border`, `--muted`, `--focus`, the type and spacing tokens); `dialog::backdrop` from `--bg` at reduced opacity; no literal colours
- [ ] T015 [US1] Run `npm test`, `npm run build && npm run test:e2e`, then `npm run dev` and create a project by keyboard only

**Checkpoint**: Story 1 passes locally.

---

## Phase 4: User Story 2 - Open, rename and delete (Priority: P1)

**Goal**: the lifecycle from the project view.

**Independent Test**: open, rename, relaunch, delete; the unit tests prove rename touches two fields and delete leaves the rest byte-identical.

### Tests for User Story 2

- [ ] T016 [P] [US2] Extend `tests/unit/projects-store.test.ts`: `rename` changes exactly `name` and `modified` (compare every other field; `created` unchanged); `rename` refuses a `version: 2` record with `read-only`; `delete` removes `projects/<id>/` and `out/<id>/` (pre-created with a file) and leaves a sibling project and `feeds/` byte-identical (hash the tree before and after); `delete` of an unknown id rejects `not found`; `delete` when `out/<id>/` does not exist succeeds with an empty `failed`
- [ ] T017 [P] [US2] Extend `tests/e2e/smoke.spec.ts`: open the created project (`getByRole('button', { name: /open/i })`), assert the view shows the name, feed key, mode `all`, "not yet chosen" and "not laid out yet"; rename it through the inline form, assert the heading and, back in the Library, the entry; delete it: the confirmation dialog names it, focus is inside it, Cancel returns to the view, Delete returns to an empty Library; assert `projects/` is empty on disk

### Implementation for User Story 2

- [ ] T018 [P] [US2] Create `src/renderer/src/ConfirmDialog.tsx`: a labelled `<dialog>` with a title, a sentence, Cancel (autofocus, the safe default) and a confirm button whose label is passed in; Escape cancels; focus returns to the opener
- [ ] T019 [US2] Create `src/renderer/src/ProjectView.tsx`: loads `projects.get(id)`; shows name as `h1`, a definition list of feed, mode, agency ("none"), service day ("not yet chosen"), layout ("not laid out yet"), theme, created and modified; a Back button; a Rename form (text field prefilled, Save, Cancel; validator messages inline; disabled when `readOnly` with a sentence saying the project was made by a newer version); a Delete button opening `ConfirmDialog` with "Delete <name>? This removes the project and its generated output. The feed stays."; on confirm calls `projects.delete`, shows any `failed` folders in words, then `onBack()`
- [ ] T020 [US2] Wire rename and delete results back into the Library (re-list on return) in `src/renderer/src/App.tsx`
- [ ] T021 [US2] Run `npm test`, `npm run build && npm run test:e2e`, then `npm run dev`: rename and delete by keyboard only

**Checkpoint**: Stories 1 and 2 pass locally.

---

## Phase 5: User Story 3 - Output served only from the project's folder (Priority: P1)

**Goal**: the skeleton's origin routing exercised against a real project.

**Independent Test**: the smoke test writes a file under `out/<id>/` of a project it created through the interface and fetches it; refusals unchanged.

- [ ] T022 [US3] Extend `tests/e2e/smoke.spec.ts`: after creating the project, write `<home>/out/<id>/index.html` from the test (the id read from `projects/`), fetch `/projects/<id>/index.html` from the page and expect 200 `text/html`; fetch `/projects/<id>/..%2fsecret.txt` and expect 403 with no `/` in the body; fetch `/projects/<id>x/index.html` (unknown) and expect 404; after delete, fetch the same file and expect 404
- [ ] T023 [US3] No handler change expected; if the test finds one, fix `src/main/protocol.ts` and add the case to `tests/unit/paths.test.ts`

---

## Phase 6: User Story 4 - Keyboard and screen reader (Priority: P2)

**Goal**: principle VI over the first screens with controls.

**Independent Test**: keyboard-only create, open, rename, delete; VoiceOver over the same.

- [ ] T024 [US4] Walk the Library and the project view with Tab, Shift+Tab, Enter, Escape only: every control reached in reading order, focus visible (the `--focus` outline), dialogs trap focus and return it; fix any gap in `src/renderer/src/*.tsx` or `app.css`
- [ ] T025 [US4] Run VoiceOver over the same flow on this Mac: dialog purpose, fields and buttons announced, the status region announced on change; record the result in the pull request; note Narrator as A6-04's
- [ ] T026 [US4] Reduced motion: with the system setting on, open and close both dialogs and change the list; nothing animates (the skeleton's global rule); if `<dialog>` animates by default, add it to the reduced-motion rule in `app.css`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T027 [P] Update `docs/ARCHITECTURE.md`: the bridge section (five methods, `senderFrame` check, no paths cross), a "Projects" section (the record, its folders, versioning), and the "Deliberately absent" table (A1-05 removed; `date` and `layout` set by A3-01)
- [ ] T028 [P] Update `specs/001-electron-skeleton/contracts/bridge.md` with a one-line pointer that `library.list()` was replaced by `projects.list()` in `specs/003-project`
- [ ] T029 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `bin/preflight`, `pre-commit run --all-files`; fix what they report
- [ ] T030 Commit on `A1-05-project`, push to `github`, open the pull request with the template (issue, spec, what was tested by hand and on which OS, the diff searched for paths); wait for the five checks; address review findings; squash-merge; pull `main`; push `main` to `origin`; close A1-05 on both boards

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T004) → Story 1 (T005–T015) → Story 2 (T016–T021) → Story 3 (T022–T023) → Story 4 (T024–T026) → Polish (T027–T030).
- Story 2 needs Story 1's store and screens; Story 3 needs a created project; Story 4 needs both screens.

## Parallel Execution Examples

- Foundational: T004 with T003.
- Story 1: T005, T006, T011 and T014 together after T002/T003; then T007 → T008 → T009 → T010 → T012 → T013.
- Story 2: T016, T017 and T018 together; then T019 → T020.
- Polish: T027 with T028.

## Implementation Strategy

1. Story 1 is the MVP: a project that exists after a relaunch. Stop and look.
2. Story 2 completes the object's life; Story 3 costs one test; Story 4 is a walk with the keyboard and a screen reader before the pull request.
3. One pull request for the issue; the five checks are the gate.
