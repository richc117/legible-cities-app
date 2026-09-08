# ADR-028: The viewer frame is sandboxed, and driven from the main process

- **Status:** Accepted
- **Date:** 2026-09-08
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-013](013-the-generated-page-is-the-viewer.md), whose premise
  about how a framed page can be driven is corrected below. That record stays
  Accepted: its decision, that the engine's page is the viewer, is unchanged.

## Context

The engine writes a self-contained page for each project and the app embeds
it. Before writing the viewer we checked what an embedded page can reach.
It can reach everything.

A page served from the project branch, loaded in an iframe by the
interface, has no `window.api` of its own, because the preload runs only in
the top frame. It reads `parent.api` as an object and **calls it
successfully**: `projects.list()` returned the real project list and
`engine.state()` returned the engine's state. The main-process frame check
does not see this, because the bridge's functions execute in the top frame
that exposed them, so `event.senderFrame` is the main frame. This was run,
not reasoned about.

The page is not trusted content. The engine embeds each project's line and
station names in it, and those come from a GTFS feed, which is third-party
data fetched over the network. The engine writes that text into a
`<script type="application/json">` element with Python's JSON encoder,
which escapes neither `<` nor `/`, so a route named with a closing script
tag ends the element early and the rest becomes live markup. We confirmed
that against the real page template: the injected element landed outside the
data block, as markup, with its handler intact. That is an engine defect
with its own issue; it is named here because it is what turns "the page
could misbehave" into a path a feed can walk.

The project branch is also served with no Content-Security-Policy at all.

## Options

Four were investigated, each then handed to someone told to break it.

**Hide the bridge inside the origin** — delete `window.api` after the app
captures it, hand it out under an unguessable name, or refuse bridge calls
while a project page is loaded. Dead, and dead for one reason rather than
four: same-origin is the browser's unit of trust, and the parent-child
scripting relation is symmetric. A framed page can write a script element
into its parent's document and run code in the parent's realm, reaching
whatever the parent still holds. There is no privilege separation to build
inside one origin. Refusing calls while the viewer is up also breaks the
app, which needs the bridge exactly then, for jobs, colours and export.

**Give project pages a second origin** and talk by messages. This looked
right and is wrong, for a reason worth recording. A frame with a real, non
opaque origin keeps the right to navigate the top frame. With one user
gesture, which the viewer's own play button supplies, the frame replaces
the top document; the preload runs again on the new main frame whatever its
origin; and the frame check then *accepts* the attacker, because it really
is the main frame now. Verified against the Electron the app pins.

**Give the viewer its own web contents**, with no preload, driven from the
main process. This holds: a separate web contents has no parent, no opener
and no `ipcRenderer`, and the same hostile page that reads `parent.api` in
an iframe finds nothing. It costs about seven hundred lines, and three
things that will be lived with for years: a native view that ignores
z-index, so every dialog now and in future must hide it; bounds in device
independent pixels against a layout measured in CSS pixels, which drift
silently the moment someone uses the zoom items in the default menu; and a
web contents that survives both removal from the view tree and the window's
destruction, so the engine's animation keeps running after its window is
gone unless it is closed by hand. It also takes the page out of the
document, and with it the focus order and the screen reader's reading
order, which the constitution asks for with the feature rather than after.

**Sandbox the frame** with `allow-scripts` and never `allow-same-origin`,
so the page runs at an opaque origin, and drive it from the main process.

## Decision

We sandboxed the frame.

The project page is loaded in an iframe carrying exactly
`sandbox="allow-scripts"`. It runs at an opaque origin, so it cannot read
`parent`, cannot touch the parent's document, and cannot navigate the top
frame; the attack that defeated a second origin is refused by the browser,
which we confirmed for every route we could find: assigning the top
location, replacing it, opening with a `_top` target, and clicking a link
targeting `_top`.

The app drives the page from the main process with
`webFrameMain.executeJavaScript`, through a typed module that names the
methods the page exposes. The same change gives the project branch a
Content-Security-Policy of its own, denies `window.open` on the window, and
guards navigation.

The engine's page is not changed. It is byte for byte what the engine
writes today.

## Three premises this corrects

ADR-013 said that a page in an iframe can be driven by its parent only when
the two share an origin, and made one origin load-bearing for that reason.
That is false, and the error steered every option above.

**`webFrameMain.executeJavaScript` is a browser-process injection into the
frame's main world, and the sandbox does not stop it.** It returned the
page's own state object from an opaque-origin frame and drove the page's
view, labels and clock. So the app never needed to share an origin with the
page; it needed a way to reach into it, and the main process has one that
the renderer does not.

Because that premise was wrong, ADR-013 also rejected `file://` on
reasoning that no longer holds. We are not revisiting that here, but the
reasoning should not be reused.

One origin is still what the app has, and the project branch still serves
from it. It is no longer what makes the viewer work.

## Consequences

What this costs. The boundary is one attribute value. `allow-scripts`
alone is safe; adding `allow-same-origin` to it reopens everything at once,
silently, and a frame granted both can even remove its own sandbox
attribute. Nothing in the type system prevents that, so a test asserts the
attribute's exact value and that a script inside the frame cannot reach the
bridge, and the renderer's rules forbid the second flag by name.

The seam becomes asynchronous: reading the page's state is now a round trip
through the main process rather than a property access. That is fine for a
button and wrong for a live clock, which will need the main process to poll
if anything ever wants one.

The project branch's policy must be written fresh rather than reusing the
interface's, because the interface's forbids being framed at all and would
block the viewer. It must also allow inline scripts, because the page is
deliberately one self-contained file, so it does not defend against the
page's own script. It is a second line, not the line.

The frame can still send messages outward. The sandbox does not close that;
not listening does. Nothing in the app listens, and an origin check would
not help, because a sandboxed frame still reports the serving origin to
itself while its messages arrive marked null.

Driving by a string of code is a step away from the typed boundary the
constitution asks for. It is bounded by a fixed dispatcher and a method
name checked against the page's own list, and the page's interface was
never a typed contract in the first place.

What to watch. Never reuse the interface's policy on the project branch.
Never compare origin strings to identify the frame; hold the frame itself
and assert it is not the main frame before injecting. Re-measure the
capture path before the capture record is written, because the relationship
between CSS pixels and a captured rectangle is what that record turns on,
and the drawing frame is now sandboxed. And the engine's own escaping
defect is a separate issue: this record closes the app's half of the path,
not the engine's.
