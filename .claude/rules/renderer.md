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

**The viewer's frame is sandboxed, and that is not negotiable.** It carries
`sandbox="allow-scripts"` and nothing else. **Never add `allow-same-origin`
beside it.** One word gives the page back the interface's realm, and a page
in that realm reads `window.api` and calls it: that was demonstrated against
this app before A3-02 closed it, with a page that listed every project and
read the engine's state. A frame holding both flags can also remove its own
sandbox attribute.

The page is not ours and is not trusted. It carries line and station names
from a transit feed, and the engine's own escaping lets a name containing a
closing script tag become live markup (engine issue E17).

The app does not drive the page from here. `iframe.contentWindow` is
unreachable across the opaque origin, and it never needed to be reachable:
the main process injects into the frame's main world, which the sandbox does
not stop. Ask through `window.api.viewer`; the driving happens in
`src/main/viewer.ts`. ADR-013 said one origin was required for this and was
wrong; ADR-028 records the correction. `tests/e2e/viewer.spec.ts` asserts the
sandbox's exact value and drives a hostile page at every route out.

## Components

Keep components pure and push logic into functions that can be called
without rendering: framing arithmetic, colour handling, settings shape.
Those functions are what `vitest` tests. Reserve end-to-end tests for the
things only a running app shows.

## The design system and the kit

Every colour, size and duration is a token from `docs/DESIGN.md`, declared
in the four token files under `src/renderer/src/styles/`; a literal in a
component file fails `tests/unit/no-literals.test.ts`, and every new text
or control pair goes into `tests/unit/contrast.test.ts`. The control kit is
FigUI3's MIT core only, imported from `kit/index.ts` and nowhere else, and
it stays in `devDependencies`: the packager copies every production
dependency whole, so a kit in `dependencies` ships the PolyForm-licensed
editor and lab bundles that the import guard cannot see (A2-00 found this
by listing the asar; a unit test now keeps it out). Use the wrappers in
`kit/`, not the elements: React 19 sets a prop as a property when the
element declares the field, and the kit reads attributes, so `type`,
`disabled`, `placeholder` and the value go through refs; the kit forwards
only `aria-label`, `-labelledby` and `-describedby` to its inner button,
so a state attribute is mirrored by hand. The kit gives every `<dialog>`
`inset: auto`, which parks a modal in the corner unless the app's rules
restore `inset: 0; margin: auto`. Its shadow styles need `style-src
'unsafe-inline'`; `script-src` stays `'self'`. Playwright emulates the
colour scheme per page, so an end-to-end test chooses the theme with
`page.emulateMedia`, never `nativeTheme`. A button that disables itself
on press drops focus, because Chromium blurs a disabled element: hand
focus somewhere first, as the service day's "Use the busiest weekday"
hands it to the date control (A3-04). The stand-in engine reads its
control file once, at start, so a test that needs one slow call has to be
slow from the first call, not rewrite the file mid-session. A `<dialog>`'s
cancel event is cancelable only while the window holds an unspent
activation: the first Escape spends it and the second closes the dialog
whatever `preventDefault` says, so a close handler must tell the parent
whenever the element closed on its own (A2-01). The platform's file
chooser cannot be driven by a test; replace `dialog.showOpenDialog` in the
main process through Playwright's `app.evaluate`, so the app's own handler
runs. A record is read after the Library lists it, never straight after
Create: Windows renames it into place slowly enough to be read mid-write.

## Accessibility is not a later pass

Keyboard reachable, labelled controls, visible focus, contrast that holds in
the warm dark theme, and `prefers-reduced-motion` respected by anything that
animates. It is in the project's principles because retrofitting it is worse
than writing it.
