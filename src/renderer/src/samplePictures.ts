import type { Palette } from './frontDoorPictures'

// The sample cities' pictures (ADR-047, issue 287): `<key>-dark.svg` and
// `<key>-light.svg` for every preset the pinned engine had a stored layout
// for, written by the engine's own script (`bin/thumbnails`, the README
// beside them says which engine, which LOOM and when) and vendored under
// `./samples/`. They are never written by hand and never drawn by the app
// (constitution principle I).
//
// Imported as URLs and not inlined: Vite emits each under the renderer's
// assets, inside the asar, at `app://local/ui/assets/...`, and an `<img>`
// shows it, so engine output stays out of the interface's own document
// (ADR-028). `no-inline` keeps the two smallest from becoming data URIs
// in the script bundle. No protocol route, no extra resource, and nothing is
// fetched to draw a card.
//
// A module of its own because `import.meta.glob` is Vite's: a spec imports
// `frontDoorPictures.ts`, never this.

const files = import.meta.glob('./samples/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>

const NAME = /^\.\/samples\/(.+)-(dark|light)\.svg$/

const pictures = new Map<string, string>()
for (const [path, url] of Object.entries(files)) {
  const match = NAME.exec(path)
  if (match !== null) pictures.set(`${match[1]}\n${match[2]}`, url)
}

/**
 * The picture of the sample city with this registry key in this palette, or
 * null where the engine's script wrote none (a preset with no stored layout
 * at the time): the card then shows its empty area, as it always has.
 */
export function samplePicture(key: string, palette: Palette): string | null {
  return pictures.get(`${key}\n${palette}`) ?? null
}
