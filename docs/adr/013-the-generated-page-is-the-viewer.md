# ADR-013: The generated animation page is the viewer, served same-origin

- **Status:** Accepted
- **Date:** 2026-09-06 (written up 2026-09-07, with the skeleton that builds on it)
- **Supersedes:** none
- **Superseded by:** none
- **Amended by:** [ADR-028](028-the-viewer-frame-is-sandboxed.md), which corrects
  this record's premise that a parent can drive a framed page only when the two
  share an origin, and sandboxes the frame. The decision here, that the
  engine's page is the viewer, stands.

## Context

The engine already produces a self-contained animation page: the schematic
map, the linear view, the time chart and the geographic morph, in one file,
with a single seam, `window.__present`. The essay embeds that page in an
iframe and drives it through that seam. An app that drew its own map would
be a second renderer, drifting from the first at whatever rate the bugs
allow, with an export path that only knows about one of them.

A page in an iframe can be driven from its parent only when the two are
same-origin: a cross-origin frame hides `contentWindow`, silently, and the
map simply does not respond.

## Options

**Embed the generated page and drive it through `__present`.** One
renderer; every viewer feature the app needs is a change to the engine's
page, which the site gets for free.

**Render the map in the app** from the engine's data. A second picture of
the same data, and a permanent second implementation to keep honest.

**Load the page from `file://`.** A file origin is opaque; the interface
and the page would not be same-origin, and the seam would be out of reach.

## Decision

The app embeds the engine's generated `<key>.html` in an iframe with
`?present=1&controls=1` and drives it through `iframe.contentWindow.__present`.
Both the app's interface and the project pages are served from one custom
scheme and host, `app://local` - the interface under `/ui/`, project output
under `/projects/<id>/` - so they are same-origin.

## Consequences

No second renderer, ever; the constitution's first principle. Any viewer
feature the app needs is a change to `page.html` in the engine.

The single origin is load-bearing and cannot be retrofitted cheaply, so the
skeleton fixes it before anything else exists: in development the
interface is proxied through the same scheme rather than loaded from the
dev server's URL, so the origin never differs between development and a
packaged build. A path served from a privileged origin is a traversal
surface; project identifiers and paths are validated before a filesystem
path is built (the skeleton's spec, FR-011). Because the frame is
same-origin by design, the page can reach the parent's bridge; main-side
handlers check the sending frame once the bridge grows beyond the
skeleton's one method.
