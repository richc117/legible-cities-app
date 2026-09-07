---
paths:
  - "src/renderer/**"
---

# The renderer process

There is no application code yet; these rules exist so the first commit that
adds `src/renderer/` does not have to rediscover them. See `CLAUDE.md` for
the short form and `docs/adr/` for why.

## No Node APIs

`contextIsolation` is on, `nodeIntegration` off, `sandbox` on. Nothing here
imports `fs`, `path`, `child_process` or `electron`. Everything that touches
the filesystem, a process, or the network goes through `window.api`, which
the preload bridge defines and the main process implements. If the renderer
needs something the bridge does not expose, the change is a new bridge
method, not an import.

## The map is not ours to draw

The engine emits a self-contained animation page and that page is the
viewer. It lives in an iframe and is driven only through `window.__present`.
Never render a map, a line, a station or a schematic in React: a second
renderer is how two pictures of the same data start to disagree, and the
export path only knows about the engine's one. React draws the chrome around
the iframe - panels, forms, progress, lists.

The iframe and the app must stay on the same origin (`app://local`) or
`contentWindow` is unreachable and the page ignores the app. See ADR-013.

## Components

Keep components pure and push logic into functions that can be called
without rendering: framing arithmetic, colour handling, settings shape.
Those functions are what `vitest` tests. Reserve end-to-end tests for the
things only a running app shows.

## Accessibility is not a later pass

Keyboard reachable, labelled controls, visible focus, contrast that holds in
the warm dark theme, and `prefers-reduced-motion` respected by anything that
animates. It is in the project's principles because retrofitting it is worse
than writing it.
