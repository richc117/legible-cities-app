# Contract: the feeds bridge, and the gate in front of the registry

## `api.feeds.pickZip()`

```ts
interface PickedZip {
  /** The path the engine is handed back, as feeds.add's source. */
  path: string
  /** What the page shows. */
  name: string
}
pickZip(): Promise<PickedZip | null>
```

Opens the platform's file chooser, parented to the window, filtered to
`.zip`. Null when the person cancelled. A path answered is remembered by
the main process until one `feeds.add` with it is let through.

## The guard

Every engine request from the page passes a guard on the main side
before the supervisor sees it; a refusal is answered as a bad call (code
-32600, kind `params`) with the sentence as its hint. Two methods are
guarded:

- `feeds.add`: `source` must be an `http://` or `https://` URL naming a
  public host (the machine itself, loopback, link-local and the private
  ranges are refused: "a feed address must name a public host, not this
  machine or its network"), or a path `pickZip` answered that no accepted
  add has spent. Any other path is refused: "a feed is added from a file
  chosen in the app, or from a URL".
- `feeds.remove`: `key` must not be the feed of any project in the store:
  "One project uses this feed; delete the project first." or "N projects
  use this feed; delete them first."

Everything else passes untouched; the typed client bounds it.

## What crosses

Inward: a path the main process itself answered, and a URL a person typed.
Outward: the path and its name, once, to the page that asked. Nothing is
opened on the main side; the engine reads the zip.
