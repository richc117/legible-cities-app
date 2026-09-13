# Tasks: Local logs and copy diagnostics

- [x] T001 `log-file.ts`: the rotating sink (append stream, byte count from
      the existing file, rename to `.old.log` before crossing the cap,
      buffering before open and during rotation, failures caught and
      reported once). Unit tests: rotation at the cap, exactly two files,
      the last line before close written, a folder that cannot be written.
- [x] T002 `log.ts` routes `engine`-tagged lines to the engine sink; unit
      test that every existing call shape still works.
- [x] T003 `index.ts`: both files opened before the supervisor starts,
      closed after its shutdown; logs path beside `LEGIBLE_USER_DATA` in
      development.
- [x] T004 `diagnostics-text.ts`: compose, tail (bounded read), shortenHome
      (both separators, win32 case), containsHome. Unit tests including a
      home folder in a log line, a Windows-shaped home, a missing log.
- [x] T005 `copyDiagnostics` in the settings service, the channel, the
      preload and the handler (at most 20 reports of 64 KB each); unit tests.
- [x] T006 `reportsInSession()` in `runs.ts`, over `copyText` from `engine/diagnostics.ts`.
- [x] T007 Settings: the button, the status sentence, the new sentence
      about the two files.
- [x] T008 End-to-end in `tests/e2e/settings.spec.ts`: with
      `LEGIBLE_USER_DATA` set, both files exist after an engine request and
      a quit; "Copy diagnostics" gives text with the versions and no home
      folder. Written, not run, by the lane.
- [x] T009 ARCHITECTURE and CLAUDE.md's "Where things stand".
- [x] T010 Lint, typecheck, unit and the build.
