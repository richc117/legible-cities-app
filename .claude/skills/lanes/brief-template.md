# Lane <CODE>: <issue title>

You are building one issue of this repository on your own branch, in your
own worktree, while other agents build other issues in theirs. Another
session coordinates: it reviews your work, runs the end-to-end suite and
merges. You write the change, run the checks listed below, commit, and
report.

- **Issue:** <CODE> (#<N>), <one-sentence summary>
- **Branch:** `<CODE>-<slug>`, already checked out
- **Worktree:** `<absolute path>`. Every shell command starts with
  `cd <absolute path> &&`, because the working directory resets between
  commands.
- **Assigned numbers:** spec `specs/<NNN-name>/`; decision record
  <ADR-NNN, or "none">. Take no other number.

## Read first, in this order

1. `CLAUDE.md`
2. `.claude/rules/<main.md and/or renderer.md>` - these do not load on
   their own in a worktree
3. `.specify/memory/constitution.md`
4. `specs/<NNN-name>/spec.md`, `plan.md`, `tasks.md`
5. The pattern to copy: `<file>`, `<file>`

## What you may touch

- <files and directories>

## What you must not touch

- `main`, and every other branch
- The other lanes' files: <named, by path>
- Any `.env*` file, `package.json` dependencies, `package-lock.json`

## The rules from CLAUDE.md

- **One renderer.** The engine emits a self-contained animation page; the
  app embeds it in an iframe and drives it only through `window.__present`.
- **The page the app embeds is contained, not trusted.** The viewer's frame
  carries `sandbox="allow-scripts"` and nothing else; never add
  `allow-same-origin`. The app drives the page from the main process, not
  through `contentWindow`.
- **Never write inside the app bundle.**
- **Child processes**: argument arrays, never shell strings; `windowsHide:
  true`; a timeout; stderr captured to the log; a clean shutdown on quit.
- **The sidecar protocol is a contract.** JSON-RPC 2.0 over stdio, types
  generated from the engine's JSON Schema.
- **Capture is deterministic, per project.** A stored layout is read, never
  re-run; `setCapture(true)` before any wait, `settle()` before the first
  frame, the clock stepped by `1/fps`, two animation frames before every
  capture, renders compared in RGB at a channel tolerance of 8.
- **Frames come from an offscreen window through the debugger**: navigate
  first and emulate second; `Page.captureScreenshot` at a CSS-pixel clip;
  the export in a session of its own.
- **Renderer**: no Node APIs; everything through the preload bridge.
  `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- **Interface changes are drawn in the design system.** `docs/DESIGN.md` is
  the source; tokens in the four stylesheets under
  `src/renderer/src/styles/`; controls are the wrappers in
  `src/renderer/src/kit/`.

## The checks

Run each, and paste its last lines into the report:

```
cd <absolute path> && npm run lint
cd <absolute path> && npm run typecheck
cd <absolute path> && npm test
cd <absolute path> && npm run build
```

Never run anything that launches Electron: `npm run test:e2e`, `dev`,
`start`, `dist`.

## Commits

Commit as `cd <absolute path> && git commit`, never `git -C`. The
repository's command guard protects neither form in a worktree; the
commit-time hooks do, so never skip them. Imperative subject under 72
characters; the body says why. End with
`Co-Authored-By: <the model> <noreply@anthropic.com>` and nothing else: no
session trailer, no link to a tool session, no closing keyword. Never
`--no-verify`; if a hook refuses, fix the cause or stop and report it.

## The ten hazards

1. The e2e lock: never run `test:e2e`, `dev`, `start` or `dist`; a second
   Electron exits at once and breaks the other lane's run. (Nothing
   enforces this: `settings.json` allows `test:e2e` because step 6 needs
   it. It rests on the agent.)
2. Never rebase, merge, reset or force; never push and never open a pull
   request; never touch `main`.
3. End-to-end tests are written, not run; list them so. A test that changes
   a setting sets `LEGIBLE_USER_DATA`; waits are deadlines, never turn
   counts.
4. Never `npm install`; never add, remove or bump a dependency. Stop and
   report instead.
5. Never read or write a `.env*` file (the deny rule does not reach a
   sibling worktree, so this rests on the agent); the `*-real` tests skip
   here by design.
6. `Co-Authored-By` only; no session trailer; no closing keyword; never
   `--no-verify`.
7. No colour, size or duration literal outside the four token stylesheets;
   no invented palette or typeface; new text or control pairs into the
   contrast test; new components into `docs/DESIGN.md` section 8.2.
8. Only the assigned spec directory and decision number; never run
   `/speckit-specify`, `/spec` or `/adr`; resolve no `[NEEDS
   CLARIFICATION]`.
9. The working directory resets between commands, so prefix each with
   `cd`; the rules files do not load in a worktree, so read them; probe
   scripts carry the lane code in their name and are deleted before
   staging.
10. A claim of green without the command's output is not a report; reviewer
    findings are leads to verify, not verdicts.

## The report

- What was built, against the spec's acceptance criteria, one line each
- The files touched (`git diff main...HEAD --stat`)
- The four checks, each with its last lines of output
- Every end-to-end test written, each marked "written, not run"
- Anything left undone, any question you stopped on, any
  `[NEEDS CLARIFICATION]` you met
- Anything you found that is outside this lane
