# Implementation Plan: Settings

**Branch**: `A1-04-settings` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

One settings file under the user-data folder, read before the configuration
resolves so a stored folder sits between `.env.local` and the default. A
`settings` bridge whose methods take no path at all: the main process opens
the chooser, remembers the answer, and applies it through the same
remembered-path guard A2-01 built for feeds, so the page has nothing to
forge. A Settings screen beside the Library and the project, with the two
folders and the engine home's size, the theme, the versions from
`engine.info`, "Open logs folder", and "Reset engine data" behind a
confirmation the main process can still refuse - which it does while an
export or an engine request is in flight, and for any home that is a root,
the user's home folder or an ancestor of the user-data folder.

## Constitution Check

| Principle | Reading |
|---|---|
| II | The versions are the engine's own answer, shown as given; a null field is said in words, never guessed at. |
| III | Nothing here touches a stored layout. The reset is the one destructive act and it says what it destroys. |
| IV | No new outbound call. |
| V | No path in any committed file: the tests build their folders under the platform's temporary directory, and the screen shows a path only in the running app. |
| VI | One column, labelled controls, the heading focused on arrival, the confirmation the page's own `<dialog>` with Cancel focused, nothing that animates. |

## Decisions

1. **The bridge carries no path inward.** `feeds.add` had to hand the page
   a path because the engine is asked with it; nothing here does. So
   `chooseEngineFolder()` opens the dialog and applies the answer in one
   call, and the page never holds a path it could send back. The
   remembered-path guard is kept behind it anyway, exported and tested, so
   the rule holds for any route added later.
2. **The environment still wins.** Both folders resolve environment, then
   `.env.local`, then the stored setting, then the default - one new tier in
   `resolveConfig`, one new `Source`. The suite steers the export with
   `LEGIBLE_EXPORT_FOLDER` and the app with `SCHEMATIC_HOME`; both keep
   working, and the screen says when a folder is not its to change.
3. **The export folder is read at each export, the engine home at each
   start.** `Exporter` takes a function rather than a string. The engine
   home is threaded through the sidecar's environment, the project store,
   the served roots, the capture's session and the frames root before the
   window exists, so it changes at the next start and the screen says so.
4. **The reset's gate is the trusted side's.** The screen disables nothing
   on a guess: the main process refuses while `Exporter` has a live export
   or the sidecar has a request in flight, and the confirmation shows that
   sentence. A layout run is an engine request, so it is covered by the
   same check.

## Source code

```text
src/shared/settings.ts                        # the shape, the defensive reader, the view, the pure formatting
src/shared/api.ts, src/preload/index.ts       # api.settings; channels
src/main/picked.ts                            # PickedPaths, moved out of feeds-ipc and shared
src/main/settings.ts                          # the store, the folder walk, the reset and its guard
src/main/settings-ipc.ts                      # the service, the dialogs, the handlers
src/main/config.ts                            # the stored tier and the `settings` source
src/main/export.ts                            # exportFolder as a function
src/main/sidecar.ts                           # Sidecar.inFlight
src/main/index.ts                             # the user-data override, the wiring
src/renderer/src/Settings.tsx, theme.ts, App.tsx, main.tsx
src/renderer/src/styles/app.css
tests/unit/{settings,settings-store,settings-ipc}.test.ts; tests/e2e/settings.spec.ts
docs/ARCHITECTURE.md, docs/DESIGN.md, CLAUDE.md
```
