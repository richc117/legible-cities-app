# Quickstart: Project

## By hand

```
npm run dev
```

1. The Library shows the empty state with a **New project** button. Press it
   (mouse or keyboard): a dialog with a name and a feed key
   (`la-metro-rail`) opens, focus on the name. Escape closes it and returns
   focus to the button.
2. Create one. The Library lists it with its feed and "not yet chosen" for
   the service day. Quit and relaunch: it is still there.
3. Open it. Rename it; the Library shows the new name. Delete it; the
   confirmation names it; confirm; the Library is empty again.
4. Under the engine home (the `[config]` line names it), `projects/` held
   one folder with `project.json` and now holds none; `feeds/` is untouched.

## The checks

```
npm test            # the store against a temp directory; validators; versioning
npm run build && npm run test:e2e   # the lifecycle from the Library, and the served output of a real project
```

## What "done" looks like

- The five checks green on Linux, macOS and Windows (SC-005).
- Rename touches exactly `name` and `modified` (SC-002, a unit test).
- Delete leaves every other folder byte-identical (SC-003, a unit test).
- The keyboard-only and screen-reader walk (SC-004) recorded in the pull request.
