import type { DrawnFrom } from '../../shared/project'

// The pictures on the front door's cards (ADR-047, issue 287). Every one is
// a file the engine wrote, shown in an image: a project's is the thumbnail
// `map.build` wrote beside its page, a sample city's is one the engine's
// script made and the app ships (`samplePictures.ts`). Nothing here draws a
// map (constitution principle I); this module only says which file.
//
// Pure, so the rules are tested without a window: which palette the
// interface is wearing, where a project's picture is, and whether a picture
// that failed to load is shown again.

/**
 * The engine's two palettes, by the names its files use (`thumb_dark`,
 * `thumb_light`; `<key>-dark.svg`). The interface's Night is the dark one
 * and Parchment the light one, so the front door reads as one gallery in the
 * theme the person chose for the app, whatever theme each project's own map
 * wears (ADR-047).
 */
export type Palette = 'dark' | 'light'

/**
 * The palette the interface wears, from the document's `data-theme`: the
 * warm-dark defaults live on bare `:root` and "sepia" is Parchment
 * (docs/DESIGN.md, section 3; `theme.ts` writes the attribute).
 */
export function paletteOfTheme(attribute: string | undefined): Palette {
  return attribute === 'sepia' ? 'light' : 'dark'
}

/** What a project's picture is found by: its folder, its feed's name, and what it was drawn from. */
type Pictured = {
  id: string
  feed: string
  drawn: DrawnFrom | null
}

/**
 * A short, stable mark of what the thumbnails are drawn from beyond the
 * layout's `made`: the engine draws them in the project's colours, its
 * default colour and its line order, and a cheap edit redraws the map with
 * the layout, and so `made`, unchanged. FNV-1a over the fields, the colours
 * sorted by label; it is a cache key and not a secret, so a collision costs
 * nothing worse than one picture shown late.
 *
 * `style` and `lines` are left out: at engine v0.12.0 the thumbnail takes no
 * style (`thumbnail.draw` scales its own) and the record has no `lines`
 * field yet. When the per-line hidden flag of ADR-053 lands in the record it
 * must join this, or a redraw that hides a line leaves the old picture on
 * the card until the document reloads.
 */
function fingerprint(drawn: DrawnFrom): string {
  const colours = Object.keys(drawn.colors)
    .sort()
    .map((label) => `${label}=${drawn.colors[label]}`)
  const text = [
    drawn.layout,
    drawn.date ?? '',
    drawn.defaultColor,
    colours.join(','),
    drawn.lineOrder.join(','),
  ].join('|')
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * Where a project's picture is, or null for a project the map has not been
 * drawn for: the engine's thumbnail in the interface's palette, beside the
 * page, through the project route that serves the page's files
 * (`<feed>-thumb-<palette>.svg`, which is how the engine names it).
 *
 * The query is what makes a redraw refresh the picture, as `redraw` does the
 * page: an image whose address has not changed is reused for as long as the
 * document lives, and the screen is not reloaded between a redraw and the
 * Library. `made` is the layout's, so a map laid out again changes it; the
 * rest of what the engine draws the thumbnail from is in `drawn`, for the
 * cheap edits that redraw without a new layout. The route resolves the path
 * alone and ignores both.
 */
export function projectPictureAddress(project: Pictured, palette: Palette): string | null {
  const { drawn } = project
  if (drawn === null) return null
  return (
    `app://local/projects/${project.id}/${project.feed}-thumb-${palette}.svg` +
    `?made=${encodeURIComponent(drawn.made ?? '')}&drawn=${fingerprint(drawn)}`
  )
}

/**
 * The picture to draw: the one asked for unless that very address has
 * already failed to load, when the card shows its empty area instead. A
 * project drawn before the engine wrote thumbnails, or whose files are gone,
 * has an address that answers "not found"; a new address (the map was drawn
 * again) is tried afresh.
 */
export function pictureToShow(picture: string | null, failed: string | null): string | null {
  return picture !== null && picture !== failed ? picture : null
}
