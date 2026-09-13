# Tasks: Jobs, in an inspector that spans projects

- [ ] T001 `src/shared/jobs.ts`: the job shape and the two caps; unit test.
- [ ] T002 `LayoutRun`, `ExportRun`, `FeedAdd`: `job()`, started and ended
      times, a bounded log buffer from `onLog` for the run's own request
      ids; existing snapshots unchanged; unit tests per run.
- [ ] T003 `runs.ts`: `jobs()`, `subscribeToJobs()` that sees runs created
      later, `runningCount()`, the finished list capped at twenty, dropped
      on project delete; unit tests.
- [ ] T004 `jobs.copyLog` on the bridge: bounded in main, redacted and
      home-shortened, then the clipboard; unit tests including a feed URL
      and a home path.
- [ ] T005 `Jobs.tsx` and `Inspector.tsx`: the list, each job's progress
      line, message, Cancel, hint, detail disclosure, Copy log and its
      sentence; focus handling; unit tests of the pure parts.
- [ ] T006 `App.tsx`: the header toggle with the running count, the region,
      the narrow-window overlay closing on Escape, the polite announcement.
- [ ] T007 Styles from tokens; contrast pairs; `docs/DESIGN.md` section 9
      sentence, 8.2 rules, the deliberately-absent row for the left rail
      and the fields.
- [ ] T008 ADR-036 and its row in `docs/adr/README.md`.
- [ ] T009 The stand-in: the route-type failure on request, `job/log` lines,
      a record of ending its child on cancel.
- [ ] T010 End-to-end `tests/e2e/jobs.spec.ts`: an export followed from
      Settings; a layout run and an export in two projects listed together;
      cancel from the inspector during `octi` and the stand-in's record; the
      route-type failure's hint and detail; Copy log with a feed URL and the
      home folder absent; twenty-one finished jobs keep twenty; keyboard
      and focus. Written, not run, by the lane.
- [ ] T011 ARCHITECTURE and CLAUDE.md's "Where things stand".
- [ ] T012 Lint, typecheck, unit and the build.
