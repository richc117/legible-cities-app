# Implementation Plan: Local logs and copy diagnostics

**Branch**: `A6-03-logs-diagnostics` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

Two files behind the sink that was built for them, and one button that
gathers what a bug report needs, in the main process, with the home folder
written as `~`. No dependency, no network, no change at any call site.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | Nothing drawn. |
| II. The engine is the source of truth | The engine's versions are its own `engine.info`; its stderr is logged as it came. |
| III. Determinism is a feature | Untouched. |
| IV. No network without a reason | None, and a test reads the new modules for `net`, `http`, `https` and `fetch`. |
| V. Hygiene by tools | Report text crosses inward, bounded and type-checked; the composed text is checked for the home folder before it is written. |
| VI. Accessible by default | One labelled button and a polite status sentence. |
| VII. Records | No decision worth a record: rotation by rename is the conventional shape. |

## Design

**The file sink.** `src/main/log-file.ts`, with no Electron import:
`openLogFile(folder, name, { cap, echo })` returns `{ write(line), close()
}`. It holds a `fs.WriteStream` in append mode and a byte count seeded
from `fs.statSync` when it opens. Before a write that would cross `cap` it
ends the stream, renames `<name>.log` to `<name>.old.log` (replacing any
earlier one), and opens a fresh stream. Lines written before the stream is
open are buffered, and so are lines written during a rotation. Every
failure is caught; after the first, it echoes to stderr and says once that
the file could not be written. `echo` mirrors to stderr in development.
The clock is passed in, so tests control the timestamp.

**Two logs.** `log.ts` keeps `setSink` and gains `setEngineSink`, or a tag
check in one sink. The plan chooses the tag check: lines tagged `engine`
go to `engine.log`, the rest to `main.log`. It keeps `log`'s surface
unchanged. `index.ts` opens both files once `app` has its paths, before
the supervisor starts, and closes both on `will-quit` after the
supervisor's shutdown has logged its last line.

**Moved user data.** Where `LEGIBLE_USER_DATA` moves `userData`,
`app.setAppLogsPath(join(movedUserData, 'logs'))` follows it (development
only, same guard).

**Diagnostics.** `src/main/diagnostics-text.ts`, pure:
`composeDiagnostics({ app, versions, os, engineInfo, mainTail, engineTail,
reports }, home)` returns the text, then `shortenHome(text, home)` replaces
the home folder, with both separators and case-insensitively on win32. A
final `containsHome` check throws rather than copying if anything
survived. `tail(file, 200)` reads at most the last 256 KB of a file and
returns its last 200 lines, or a sentence when the file is missing.
`SettingsService.copyDiagnostics(reports: string[])` gathers the rest
(`app.getVersion()`, `process.versions`, `os.type()`, `os.release()`,
`process.arch`, the engine's `engine.info` through the supervisor when it
is ready, with a timeout) and writes through the same clipboard function
the diagnostics panel's handler uses.

**The bridge.** `api.settings.copyDiagnostics(reports: string[]):
Promise<void>`. The handler accepts at most 20 strings of at most 64 KB
each, and refuses anything else.

**The screen.** `Settings.tsx`: "Copy diagnostics" beside "Open logs
folder", a status sentence after it, and the "for now" sentence replaced
by one naming the two files. The reports are `copyText(name, report)` for
every project whose layout run in `runs.ts` holds a report. That takes an
export from `runs.ts` listing those runs, added without changing the
existing ones.

## Source code

```text
src/main/log.ts                      # route by tag; setSink unchanged
src/main/log-file.ts                 # the rotating file sink (new)
src/main/diagnostics-text.ts         # compose, tail, shortenHome, containsHome (new)
src/main/index.ts                    # open and close the two files; logs path beside moved user data
src/main/settings-ipc.ts             # copyDiagnostics
src/shared/api.ts, src/preload/index.ts   # settings.copyDiagnostics, its channel
src/renderer/src/Settings.tsx        # the button, the sentence
src/renderer/src/engine/runs.ts      # reportsInSession(): an addition, nothing existing changed
tests/unit/{log-file,diagnostics-text,settings-ipc,log}.test.ts
tests/e2e/settings.spec.ts           # the files exist after a request; the copy has no home folder
docs/ARCHITECTURE.md, CLAUDE.md
```

## Must not touch

`src/shared/export.ts`, `src/main/export*.ts`, `src/renderer/src/Export*.tsx`,
`src/renderer/src/ProjectView.tsx`, `src/renderer/src/Viewer.tsx`,
`src/renderer/src/kit/` (A5-01's lane); `vendor/`, `.github/` (A0-06's).
`src/renderer/src/Diagnostics.tsx` and `engine/diagnostics.ts`: read only;
`copyText` is already exported from the latter.
