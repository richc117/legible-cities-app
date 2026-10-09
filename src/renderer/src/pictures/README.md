# Theme thumbnails

Two pictures of the map's two themes, for the desktop app's style cell to
choose by. The app never draws a map, so these are the engine's.

| File | Theme | Ground |
| --- | --- | --- |
| `theme-warm-dark.svg` | Warm dark | `#15120f` |
| `theme-sepia.svg` | Sepia | `#f7efe1` |

Made by engine 0.12.0 on 2026-10-08.

They show what a theme looks like, not any project's map. Both are the same
drawing of an invented network (four lines, twelve stations, no labels, on a
16 by 10 grid like no city), drawn directly by the engine's renderer, with
the furniture's colours resolved to literals so they hold up inside an
`<img>`. The ground is the palette's own `bg`, which is what the viewer and
every export show.

The viewBox is 16:10, padded and never cropped:

    viewBox="-31.00 -31.38 510.00 318.75"

## Making them again

From a checkout of the engine at the tag the app pins:

    bin/theme-thumbnails <folder>

It needs no Docker, no feed and no `data/` folder, and it writes these three
files into the folder, which it creates if it is missing. The SVGs carry no
date, so a second run changes only the line above that names it. Run it again
when the engine's drawing or the palettes change: the files do not follow
them on their own.
