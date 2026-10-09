// The two pictures cell 04 offers a theme by (A7-13, issue 285): the
// engine's files, made once by its `bin/theme-thumbnails` and kept in
// `src/renderer/src/pictures/`, whose README says how to make them again.
//
// They are plain SVG, so an `<img>` of one can run nothing and read nothing
// of the page around it, and they are drawn with literal colours, because
// an `<img>` is a document of its own where a `var()` has nothing to fall
// back to. A literal is a copy, and a copy drifts: the app's record of the
// engine page's two palettes is `styles/tokens.css` (itself held to the
// page by `tokens.test.ts`), so this test ties each picture's colours to it.
// A pin bump that moves a palette fails here until the pictures are made
// again, which is the whole of how they are kept current (issue 285,
// decision c).
//
// The ground is the palette's `--bg`: the README says the pictures use the
// palette's own `bg`, "which is what the viewer and every export show", and
// not `--map-bg`, the colour the page's furniture sits on, which differs in
// the warm-dark palette. The stations are held to the palette's station
// colours as well, since a palette that moved them and left the ground
// would otherwise pass.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as themePictures from '../../src/renderer/src/themePictures'
import { THEMES, type Theme } from '../../src/shared/project'

const root = resolve(__dirname, '../../src/renderer/src')
const tokens = readFileSync(resolve(root, 'styles/tokens.css'), 'utf8')

/** The picture of a theme, as the engine wrote it. */
const picture = (theme: Theme): string =>
  readFileSync(resolve(root, `pictures/theme-${theme}.svg`), 'utf8')

/** Which of tokens.css's two blocks holds each theme's palette. */
const SELECTOR: Record<Theme, string> = {
  'warm-dark': ':root {',
  sepia: ':root[data-theme="sepia"] {',
}

/** One declaration of a palette block, comments stripped. */
function token(theme: Theme, name: string): string {
  const start = tokens.indexOf(SELECTOR[theme])
  expect(start, `tokens.css has ${SELECTOR[theme]}`).toBeGreaterThanOrEqual(0)
  const body = tokens
    .slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start))
    .replace(/\/\*[\s\S]*?\*\//g, '')
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon !== -1 && declaration.slice(0, colon).trim() === name)
      return declaration.slice(colon + 1).trim()
  }
  throw new Error(`tokens.css has no ${name} in ${SELECTOR[theme]}`)
}

/**
 * What is wrong with a picture of a theme, in words; nothing when it is
 * right. A function of the file's text, so that the test below can hand it
 * a copy with one hex changed and watch it say so.
 */
function problems(theme: Theme, svg: string): string[] {
  const found: string[] = []
  if (!/^(<!--[\s\S]*?-->\s*)?<svg[\s>]/.test(svg)) found.push('is not an <svg> document')
  if (/<script/i.test(svg)) found.push('holds a <script>')
  if (svg.includes('var(')) found.push('holds a var()')
  if (/<text[\s>]/i.test(svg)) found.push('holds a <text>')
  const ground = /<rect id="backdrop"[^>]* fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? null
  if (ground === null) found.push('has no backdrop rectangle with a literal fill')
  else if (ground.toLowerCase() !== token(theme, '--bg'))
    found.push(
      `has the ground ${ground}, and the ${theme} palette's --bg is ${token(theme, '--bg')}`,
    )
  const stations = [
    ...svg.matchAll(/<circle [^>]*\bfill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})"/gi),
  ]
  if (stations.length === 0) found.push('has no station')
  for (const [, fill, stroke] of stations) {
    if (fill.toLowerCase() !== token(theme, '--map-station-fill'))
      found.push(
        `has a station filled ${fill}, not --map-station-fill ${token(theme, '--map-station-fill')}`,
      )
    if (stroke.toLowerCase() !== token(theme, '--map-station-stroke'))
      found.push(
        `has a station outlined ${stroke}, not --map-station-stroke ${token(theme, '--map-station-stroke')}`,
      )
  }
  return [...new Set(found)]
}

describe("the engine's pictures of the map's two themes (A7-13)", () => {
  for (const theme of THEMES) {
    it(`${theme}: plain SVG, and its colours are the palette's`, () => {
      expect(problems(theme, picture(theme))).toEqual([])
    })
  }

  it('are two different drawings of one network, in the two palettes', () => {
    const [warm, sepia] = THEMES.map(picture)
    expect(warm).not.toBe(sepia)
    // The same invented network: the same lines, in the same colours.
    const lines = (svg: string): string[] =>
      [...svg.matchAll(/<g class="line"[^>]*>/g)].map((m) => m[0])
    expect(lines(warm)).toEqual(lines(sepia))
    expect(lines(warm)).toHaveLength(4)
  })

  it('are offered to the app as addresses and nothing else, one for each theme', () => {
    // The app never draws a map (constitution, principle I): all that crosses
    // from the files into the interface is where to find them.
    expect(Object.keys(themePictures)).toEqual(['themePicture'])
    const urls = THEMES.map((theme) => themePictures.themePicture(theme))
    for (const url of urls) expect(url).toEqual(expect.any(String))
    expect(new Set(urls).size, 'two addresses, not one twice').toBe(2)
    for (const url of urls) expect(url).toMatch(/^data:image\/svg\+xml,|\/theme-[a-z-]+\.svg$/)
  })

  describe('the check itself', () => {
    // The mutation the test is for, kept in it: one hex of a copy edited,
    // and the check has to say which file drifted and how.
    it('says so when the ground of a copy is one digit off', () => {
      const bg = token('warm-dark', '--bg')
      const off = bg.slice(0, -1) + (bg.endsWith('e') ? 'f' : 'e')
      const copy = picture('warm-dark').replace(
        /(<rect id="backdrop"[^>]* fill=")#[0-9a-f]{6}"/,
        `$1${off}"`,
      )
      expect(copy).not.toBe(picture('warm-dark'))
      expect(problems('warm-dark', copy)).toEqual([
        `has the ground ${off}, and the warm-dark palette's --bg is ${bg}`,
      ])
    })

    it('says so when a station colour of a copy has moved and the ground has not', () => {
      const copy = picture('sepia').replaceAll('stroke="#2d241d"', 'stroke="#2d241e"')
      expect(problems('sepia', copy).join('\n')).toContain('--map-station-stroke')
    })

    it('says so for a script, a var() and a text element, and for the wrong palette', () => {
      const svg = picture('sepia')
      expect(problems('sepia', svg.replace('</svg>', '<script>1</script></svg>'))).toContain(
        'holds a <script>',
      )
      expect(problems('sepia', svg.replace('fill="none"', 'fill="var(--bg)"'))).toContain(
        'holds a var()',
      )
      expect(problems('sepia', svg.replace('</svg>', '<text>A</text></svg>'))).toContain(
        'holds a <text>',
      )
      // Each file against the other's palette: the ground cannot match both.
      expect(problems('warm-dark', svg)).not.toEqual([])
      expect(problems('sepia', picture('warm-dark'))).not.toEqual([])
    })
  })
})
