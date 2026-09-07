# Quickstart: the Electron skeleton

What to run to see the feature work, and what each run proves. Commands are
the `package.json` scripts; `CLAUDE.md` lists them too.

## Prerequisites

- Node.js 22 or later and npm.
- Optional, for the development loop and the tokens test: the engine checked
  out beside this repository, and a `.env.local` copied from `.env.example`
  with `LEGIBLE_ENGINE_CHECKOUT` pointing at it.

## Install

```
npm ci
```

Fetches Electron for the current platform. No other download happens at
run time (FR-034).

## The window (User Story 1)

```
npm run dev
```

Expected: one window titled `Legible Cities` with a Library that says, in
words, that there are no projects yet. The terminal shows the `[config]`
lines from `contracts/config.md`. Quit from the app's own menu or Ctrl/Cmd+Q;
the process ends. Edit `src/renderer/src/App.tsx` and save: the window
updates without a restart (User Story 3).

## The origin (User Story 2)

With the window open, in the renderer's devtools console:

```js
location.origin            // "app://local"
fetch("/projects/../x")    // 403, body "forbidden" - never a path
fetch("/projects/nope/a")  // 404, body "not found"
```

The unit tests cover the full traversal matrix without a window:

```
npm test
```

## The checks (User Story 4)

```
npm run lint       # style
npm run typecheck  # types
npm test           # unit: path validation, config parsing, tokens drift
npm run build      # the built app under out/
npm run test:e2e   # Playwright launches the built app, asserts the title, quits it
```

On Linux the end-to-end test needs a display server: `xvfb-run -a npm run
test:e2e`. `.github/workflows/ci.yml` runs all of the above on Ubuntu,
macOS and Windows for every push and pull request; the job names distinguish
the platforms.

## What "done" looks like

- `ci` green on all three platforms for a change, and red when the window
  title or a type is broken on purpose (SC-002, SC-003).
- `bin/preflight` and `pre-commit run --all-files` clean over the new files
  (SC-008).
- A full launch-and-quit makes no outbound request (SC-006; check with the
  system's network monitor).
- Branch protection applied from `docs/repository-settings.md` and
  `CONTRIBUTING.md` flipped to pull requests (FR-030).
