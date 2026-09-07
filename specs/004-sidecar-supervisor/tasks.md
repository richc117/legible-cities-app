# Tasks: Sidecar supervisor

**Input**: Design documents from `specs/004-sidecar-supervisor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/bridge.md, contracts/sidecar.md, quickstart.md

**Tests**: wanted (the spec's FR-021 and SC-005, SC-006): unit tests over the framing, the resolution, the supervisor against the stand-in, the IPC layer; a gated test against the real engine; an e2e test of the built app against the stand-in.

**Organization**: by user story. The foundation (types, the pin, the framing, the stand-in) comes first because every story speaks through it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 (the engine is there when the app opens), US2 (ask and get the answer), US3 (comes back when it dies), US4 (nothing outlives the app)

## Path Conventions

Single project: `src/main`, `src/preload`, `src/shared`, `src/renderer/src`, `tests/unit`, `tests/e2e`, `tests/fake-engine`, `vendor/`.

---

## Phase 1: Setup

- [x] T001 Add the `engine` block to `vendor/pins.json` (repo, tag `v0.2.0`, version `0.2.0`, protocol `1`, note) and a unit test `tests/unit/pins.test.ts` that reads the file and checks the block's shape and that `tag` is `v` + `version`
- [x] T002 [P] Add `LEGIBLE_ENGINE_PYTHON` to `src/main/config.ts` (`KEYS`, `Config.enginePython`, `pick`, a value without a path separator kept as a command name, the `describeConfig` line), to `.env.example`, and to `tests/unit/config.test.ts`; update `specs/001-electron-skeleton/data-model.md` and `contracts/config.md` with the key
- [x] T003 [P] Write the stand-in engine `tests/fake-engine/schematic/__init__.py` and `tests/fake-engine/schematic/serve.py` (research.md section 6): framing, `engine.info` from `<SCHEMATIC_HOME>/fake-engine.json`, `graph.build` with four progress notifications and a configurable delay, `$/cancelRequest`, `engine.shutdown`, exit on end-of-input, the misbehaviours (`exit: "at-once" | "after-handshake"`, `garbage`, `ignore_shutdown`, `silent`), pid file `fake-engine.pid`

---

## Phase 2: Foundational

- [x] T004 [P] Write `src/shared/engine.ts`: `EngineState`, `EnginePin`, `EngineError` (class with `code` and `data`), `JobProgress`, `JobLog`, the app's error codes (`-32001` state, `-32002` exit, `-32003` inactive, `-32600` bad call) per data-model.md; extend `src/shared/api.ts` with `engine` in `Api` and the six `engine:*` channels
- [x] T005 [P] Write `src/main/jsonrpc.ts` (research.md section 1): `FrameReader` over a readable stream (`Content-Length` header, blank line, body; malformed header or non-JSON body raises a protocol error), `writeFrame(stream, message)`, and `JsonRpcClient` (numeric ids from 1, `request(method, params) → { id, result }`, `cancel(id)` sending `$/cancelRequest`, `onNotification`, `onClose`/`onError`, `dispose()` rejecting every pending request with a given error)
- [x] T006 [P] Write `tests/unit/jsonrpc.test.ts` over `PassThrough` streams: frames split across chunks and joined in one chunk, a header in either case, unknown headers ignored, a body with multibyte text, a malformed `Content-Length`, a response for an unknown id logged and dropped, notifications delivered in order, cancel sends the right frame, dispose rejects pending
- [x] T007 [P] Write `src/main/interpreter.ts` (research.md sections 2 and 3): `resolveInterpreter({ config, packaged, resourcesPath, platform, exists })` returning `{ interpreter, origin }` or `{ reason }`; `engineCommand(interpreter)`; `engineEnvironment({ config, base, platform, development })` with the allowlist, the four engine keys, `PYTHONUNBUFFERED`, `PYTHONIOENCODING`, and `PYTHONPATH` in development only
- [x] T008 [P] Write `tests/unit/interpreter.test.ts`: the order (explicit key beats the checkout beats the bundle), a command name kept as is, the Windows paths (`Scripts/python.exe`, `python/python.exe`), the reasons name what was looked for and the key, the environment carries only the allowlist plus the engine's keys, `DOCKER_*` passes, `PYTHONPATH` only in development, nothing else leaks (a secret-looking variable in `base` is absent)

**Checkpoint**: the framing and the resolution are proven without a process; the stand-in exists.

---

## Phase 3: User Story 1 - The engine is there when the app opens (Priority: P1) 🎯 MVP

**Goal**: start at ready, handshake against the pin, the state on the first screen; unavailable and mismatched said plainly.

**Independent Test**: launch with the stand-in at 0.2.0 → "Engine ready (0.2.0)"; with a nonexistent interpreter → "Engine unavailable: …"; with the stand-in at 0.1.0 → the dialog names both and the state reads mismatched.

- [x] T009 [US1] Write `src/main/sidecar.ts` (contracts/sidecar.md): the `Sidecar` class with `start()`, `state`, `onState`, spawn (`stdio: 'pipe'`, `windowsHide: true`, `detached` on POSIX, never `shell`), stderr line reader to the log with the last 20 lines kept, the handshake with its bound, the pin comparison, `mismatched` calling a `onMismatch` callback once and shutting the process down, `unavailable` when there is no interpreter; the `restart` and `stop` parts of the state table are T017 and T020 but the state type and the transitions table are written here in full
- [x] T010 [US1] Write `tests/unit/sidecar.test.ts` against the stand-in (skips without a `python3` or `python` on the PATH): start → ready with the version; the log names the interpreter, the versions and the home; a wrong version → mismatched, the callback called once with expected and found, the process gone; a wrong protocol likewise; `exit: "at-once"` and `exit: "after-handshake"` → the reason carries the exit code and the last stderr lines; the handshake bound (`silent`) → the reason says so; a nonexistent interpreter → unavailable with the key in the reason
- [x] T011 [US1] Write `src/main/engine-ipc.ts`: `registerEngineHandlers(ipcMain, sidecar, isTopFrame, send)` with `engine:state`, `engine:request`, `engine:cancel` (T014 fills request and cancel; here `state` and the `engine:state-changed` fan-out) and `tests/unit/engine-ipc.test.ts` with a fake `ipcMain` and a fake sidecar: the three channels registered and nothing else; a non-top frame refused; `engine:state` returns the sidecar's state; a state change is sent to the window
- [x] T012 [US1] Extend `src/preload/index.ts` with `engine.state()` and `engine.onState()` (returns unsubscribe; strips the event), and `src/renderer/src/api.d.ts` if it declares `window.api`
- [x] T013 [US1] Write `src/renderer/src/EngineStatus.tsx` (`role="status"`, `aria-live="polite"`, `aria-label="Engine"`, one sentence per state per quickstart.md, no animation), mount it in a header in `src/renderer/src/App.tsx` shown on both screens, and style the header and the line in `src/renderer/src/styles/app.css` with the existing tokens
- [x] T014 [US1] Wire `src/main/index.ts`: build the sidecar at ready from the configuration (`resolveInterpreter`, `engineEnvironment`, the pin from `vendor/pins.json`), `start()` before `createWindow()`, state changes sent to the window (and the current state sent when the window's page finishes loading, so a state that changed before the page existed is not missed); the mismatch is the page's own `<dialog>` (`MismatchDialog.tsx`), not a native message box (research.md, the traps); `describeConfig` prints the new key

**Checkpoint**: `npm run dev` against the real engine reads "Engine ready (0.2.0)"; against the stand-in at 0.1.0 shows the dialog.

---

## Phase 4: User Story 2 - Ask the engine something and get its answer (Priority: P1)

**Goal**: requests, results, errors, notifications and cancellation pass through unchanged; every request bounded.

**Independent Test**: from the page, `engine.info` equals the engine's answer; `map.build` without a date rejects with the engine's `-32602` and its hint; `graph.build` on the stand-in yields four progress notifications with the request's token; cancel ends with `-32800`; a silent request ends with `-32003` after the (shortened) bound.

- [x] T015 [US2] Extend `src/main/sidecar.ts`: `request(method, params)` (refused with `-32001` unless ready; the inactivity bound reset by the request's notifications, expiry cancelling and settling with `-32003`), `cancel(id)`, `onNotification`; the notification's id is the numeric one here
- [x] T016 [US2] Extend `tests/unit/sidecar.test.ts`: a request before ready → `-32001` with the state's sentence and nothing sent; `engine.info` through the supervisor equals the stand-in's answer; `graph.build` → four `job/progress` in order with the id, then the result; cancel → `-32800`; an engine error (`map.build` without a date on the stand-in) passes through with `code`, `message`, `data`; the inactivity bound (`silent` long request, `inactivityMs: 200`) → `-32003` and a `$/cancelRequest` seen by the stand-in (it records what it received in the home); a notification for an unknown id is logged and dropped
- [x] T017 [US2] Extend `src/main/engine-ipc.ts`: `engine:request` mapping the page's token to the numeric id, resolving `{ ok: true, result }` or `{ ok: false, error }` (never rejecting), forwarding `job/progress` and `job/log` to the window with the token in place of the id, dropping the mapping when the request settles; `engine:cancel` by token; the page's arguments checked (`method` a non-empty string, `params` a plain object or undefined → else `-32600`); extend `tests/unit/engine-ipc.test.ts` accordingly
- [x] T018 [US2] Extend `src/preload/index.ts` with `engine.request()` (mints the token with `crypto.randomUUID()`, returns `{ id, result }` synchronously, converts `{ ok: false }` into a thrown `EngineError` with `code`, `message`, `data`), `engine.cancel()`, `engine.onProgress()`, `engine.onLog()`
- [x] T019 [US2] Write `tests/unit/sidecar-real.test.ts`: skipped unless `.env.local` (or the environment) names `LEGIBLE_ENGINE_CHECKOUT` with `.venv/bin/python` (or `Scripts/python.exe`) present; start → ready with the pinned version; `engine.info` has `protocol: 1` and `engine` equal to the pin; `map.build` without a date → `-32602` and `data.hint` starting "date is required"; `stop()` leaves no process (`kill(pid, 0)` throws)

**Checkpoint**: from the page, `window.api.engine.request('engine.info').result` resolves with the engine's answer.

---

## Phase 5: User Story 3 - The engine comes back when it dies (Priority: P2)

**Goal**: restart with 1, 2, 4 s waits, three consecutive failures then stopped; requests in flight rejected; the interface says so.

**Independent Test**: kill the stand-in's process (pid from the home) → restarting then ready; make it `exit: "after-handshake"` every time → stopped after attempt 4 with the reason.

- [x] T020 [US3] Extend `src/main/sidecar.ts`: on an exit or framing error the app did not ask for, reject every request in flight with `-32002`, move to `restarting(n+1, reason)` or `stopped(reason)` after three consecutive failures, wait `restartDelaysMs[n-2]`, start again; the count resets once a request is answered or the engine has been ready for `stableMs` (a handshake alone does not, or an engine that dies right after it would restart forever); nothing restarts once `stop()` was called
- [x] T021 [US3] Extend `tests/unit/sidecar.test.ts` (`restartDelaysMs: [20, 40, 80]`): kill the process by its pid → states `restarting(2)` then `starting(2)` then `ready`; a request in flight during the kill → `-32002`; `exit: "after-handshake"` on every start → `restarting(2)`, `(3)`, `(4)`, then `stopped` with the exit code in the reason, and a request afterwards → `-32001` with that reason; a good handshake after two failures resets the count (a third later kill is attempt 2 again)
- [x] T022 [US3] Make `EngineStatus.tsx` read "The engine stopped; restarting (attempt n). <reason>" and "Engine stopped: <reason>"; the sentences come from the shared `describeState(state)` in `src/shared/engine.ts` so the log and the screen agree, checked one per state in `tests/unit/sidecar.test.ts`

**Checkpoint**: `pkill -f schematic.serve` during `npm run dev` shows restarting, then ready.

---

## Phase 6: User Story 4 - Nothing outlives the app (Priority: P2)

**Goal**: quit → cancel, shutdown, terminate, kill; the group on POSIX, the tree on Windows; the app exits after.

**Independent Test**: quit with a long request running; three seconds later no engine process; `ignore_shutdown` stand-in is ended by the terminate step.

- [x] T023 [US4] Extend `src/main/sidecar.ts` with `stop()` per contracts/sidecar.md: reject in flight with `-32002`, `engine.shutdown` with `shutdownMs`, terminate (POSIX `process.kill(-pid, 'SIGTERM')`; Windows `spawn('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true })`), `terminateMs`, kill (POSIX `SIGKILL` to the group), resolve when exited; idempotent; logs what it took
- [x] T024 [US4] Extend `tests/unit/sidecar.test.ts` (`shutdownMs: 300`, `terminateMs: 300`): a cooperative stand-in exits on `engine.shutdown` before the bound and `stop()` resolves; an `ignore_shutdown` stand-in is gone after the terminate step and `stop()` resolves within the bounds; after `stop()` the pid is dead (`process.kill(pid, 0)` throws) on all three platforms; a request in flight at `stop()` → `-32002`; a second `stop()` resolves at once
- [x] T025 [US4] Wire the quit sequence in `src/main/index.ts`: `before-quit` prevents the default once, awaits `sidecar.stop()`, sets a flag, quits again; `window-all-closed` on non-macOS goes through the same path; the `second-instance` and `activate` paths are unchanged

**Checkpoint**: quit during a real layout; `pgrep -f schematic.serve` and `docker ps` are empty.

---

## Phase 7: End to end, documentation, polish

- [x] T026 Write `tests/e2e/engine.spec.ts` against the stand-in (skips with a message when no `python3`/`python` is on the PATH): launch with `LEGIBLE_ENGINE_PYTHON` and `PYTHONPATH=tests/fake-engine` → the status region reads ready with the stand-in's version; `page.evaluate` of `engine.request('engine.info')` returns the stand-in's answer; kill the stand-in by the pid in the home → the region reads restarting, then ready, within SC-002's bounds; `engine.request('map.build', {key})` against a stand-in that answers `-32602` passes the hint through; quit → the pid is dead within 3 s; launch with `LEGIBLE_ENGINE_PYTHON=/nowhere/python` → the region reads unavailable and the Library still creates a project
- [x] T027 [P] Update `docs/ARCHITECTURE.md`: the diagram gains the engine process; a section "The engine process" (interpreter, environment, handshake, states, bounds, shutdown, the stand-in); the bridge section gains `engine`; the configuration section gains the key; "Deliberately absent" drops the engine row and gains the typed client (A1-02) and the jobs drawer (A1-03)
- [x] T028 [P] Update the assistant notes ("Where things stand" and the commands, if any change) and `.env.example`'s comment for `SCHEMATIC_LOOM_BIN`/`SCHEMATIC_FFMPEG` ("passed to the engine") and `CLAUDE.local.md`'s "What is next"
- [x] T029 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`; then the reviewer agent over the branch; fix what it finds
- [ ] T030 (the automated part is done; the VoiceOver and Activity Monitor checks are the maintainer's, recorded in the pull request) Do the manual checks in quickstart.md that a machine cannot (VoiceOver; Activity Monitor after a quit during a layout) and record the result in the pull request; open the pull request against `main` closing #14

---

## Dependencies

- Phase 1 and 2 first; within them every `[P]` task is independent.
- US1 (T009–T014) needs T003, T004, T005, T007. US2 (T015–T019) needs US1's T009 and T011. US3 (T020–T022) and US4 (T023–T025) need US1 and are independent of each other and of US2, except that T021 and T024 extend the same test file.
- Phase 7 needs everything.

## Parallel Example

After Phase 2: T009 (the supervisor's start and handshake) and T013 (the status region) and T003 (the stand-in) can proceed in parallel; T010 waits for T009 and T003.

## Implementation Strategy

MVP is Phase 1 + 2 + US1: the app starts the engine and says whether it is there. US2 makes the connection usable; US3 and US4 make it safe. Each phase ends green on the checks before the next starts.
