# Contract: the bridge gains one method

## `api.projects.setTheme(id, theme)`

```ts
/** The two the engine's page draws, and the two the record can hold. */
type Theme = 'warm-dark' | 'sepia'
```

Written the moment a person presses it, not after something has been drawn:
a theme is neither a layout nor a render, so there is nothing to finish
first and nothing to be inconsistent with. The page is then told through its
seam and restyles in place (below); the next load carries the theme on its
address. It answers with the record.

It refuses:

- a caller that is not the interface's top frame (`forbidden`);
- a malformed id;
- anything that is not one of the two themes;
- a record a newer version of the app wrote (`read-only`).

It writes `theme` and `modified`, and nothing else.

Nothing here talks to the engine or carries a path.

## What the page and the export are given

The viewer's frame loads the engine's page with `theme=warm-dark` or
`theme=sepia` on the address. The page reads it before paint, so the
frame never shows one theme and then the other; anything it does not
recognise it draws warm-dark.

**As of issue 349 that address is for the next load.** It carries the theme
of the moment it was made, and a press does not change it. A press writes the
record (`api.projects.setTheme`, above) and then the interface calls
`api.viewer.call('map', 'setTheme', theme)`, the page's own method since
engine v0.11.0, which restyles the page in place and answers `true` for the
two names; `setTheme` is in the app's list of the page's methods
(`src/shared/viewer.ts`) and the main process needed no change. A write that
fails sends nothing, and a page that is not there to be told is not an error,
because the next load carries the theme. Every page that loads is given the
project's theme as the first call of its restore, read at the moment it is
sent. A page the engine wrote before v0.11.0 answers "this map cannot do
that", and the frame is then loaded again at the address with the theme.

The export passes the same choice in the engine's own vocabulary:
`themeFor(record.theme)` is `dark` or `light` in `export.plan`'s options,
and the engine turns anything that is not `dark` into `theme=sepia` on the
page it drives. Nothing about the capture path changes.
