# Contract: the bridge gains one method

## `api.projects.setTheme(id, theme)`

```ts
/** The two the engine's page draws, and the two the record can hold. */
type Theme = 'warm-dark' | 'sepia'
```

Written the moment a person presses it, not after something has been drawn:
a theme is neither a layout nor a render, so there is nothing to finish
first and nothing to be inconsistent with. The page restyles itself from
its own address. It answers with the record.

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

The export passes the same choice in the engine's own vocabulary:
`themeFor(record.theme)` is `dark` or `light` in `export.plan`'s options,
and the engine turns anything that is not `dark` into `theme=sepia` on the
page it drives. Nothing about the capture path changes.
