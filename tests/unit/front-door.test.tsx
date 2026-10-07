import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import Card from '../../src/renderer/src/Card'
import { iconMarkup } from '../../src/renderer/src/icons/Icon'
import Library, {
  INTRODUCTION,
  PROJECTS_NONE,
  ProjectCards,
  SAMPLES_AWAY,
  SAMPLES_NONE,
  SAMPLES_UNREAD,
  projectFacts,
  samplesSentence,
  whereItRuns,
} from '../../src/renderer/src/Library'
import SampleCities, {
  sampleFacts,
  sampleName,
  sampleStatus,
} from '../../src/renderer/src/SampleCities'
import { drawnFrom, summarise, type ProjectRecord } from '../../src/shared/project'
import type { FeedRecord } from '../../src/shared/protocol'

// The screen's run helpers reach for the bridge when they are made. A
// static render runs no effect, so nothing is asked of it; every property is
// a function that answers nothing, which is all a constructor can touch.
beforeAll(() => {
  const nothing: unknown = new Proxy(() => undefined, {
    get: () => nothing,
    apply: () => undefined,
  })
  vi.stubGlobal('window', { api: nothing })
})

const feed = (patch: Partial<FeedRecord> = {}): FeedRecord => ({
  key: 'la-metro-rail',
  name: 'LA Metro Rail',
  city: 'Los Angeles',
  network: 'Metro Rail',
  url: 'https://example.org/gtfs.zip',
  mode: 'all',
  label_pattern: null,
  label_strip: null,
  agency: null,
  geographic: true,
  notes: [],
  headways: false,
  source: 'preset',
  cached: false,
  ...patch,
})

const RECORD: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: '2026-09-11T09:00:00.000Z',
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/** A project as the list summarises it, drawn from everything above the export. */
const project = (
  patch: Partial<ProjectRecord> = {},
  readOnly = false,
): ReturnType<typeof summarise> => {
  const record = { ...RECORD, ...patch }
  return summarise({ ...record, drawn: drawnFrom(record) }, readOnly)
}

const projects = (list: ReturnType<typeof summarise>[], feeds: FeedRecord[] = []): string =>
  renderToStaticMarkup(
    <ProjectCards projects={list} feeds={feeds} onNew={() => undefined} onOpen={() => undefined} />,
  )

/** Each list item's markup, in document order. */
const items = (html: string): string[] =>
  [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1])

/** The picture area's markup, from each card in `html`. */
const pictures = (html: string): string[] =>
  [
    ...html.matchAll(/<span class="card-picture">([\s\S]*?<\/svg><\/span>|<img[^>]*>)<\/span>/g),
  ].map((m) => m[1])

describe('the front door', () => {
  it('draws the sentence a delete could not fully carry out, whatever else it holds', () => {
    const notice = 'The project was deleted, but its folder could not be removed: in use.'
    const html = renderToStaticMarkup(<Library notice={notice} onOpen={() => undefined} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain(notice)
  })

  it('has one first-level heading', () => {
    const html = renderToStaticMarkup(<Library notice={null} onOpen={() => undefined} />)
    expect(html.match(/<h1\b/g)).toHaveLength(1)
  })

  it('introduces the app in one sentence', () => {
    expect(INTRODUCTION.match(/[.!?](\s|$)/g)).toHaveLength(1)
  })
})

describe('what the samples region says when it has no presets to draw', () => {
  it('says the engine is not ready only when it is not', () => {
    expect(samplesSentence(false, 'unread')).toBe(SAMPLES_AWAY)
    expect(samplesSentence(false, 'listed')).toBe(SAMPLES_AWAY)
  })

  it('says nothing while the first read is on its way', () => {
    expect(samplesSentence(true, 'unread')).toBeNull()
  })

  it('says the read failed when it did, and that there are none when there are none', () => {
    expect(samplesSentence(true, 'failed')).toBe(SAMPLES_UNREAD)
    expect(samplesSentence(true, 'listed')).toBe(SAMPLES_NONE)
  })
})

describe('a sample city’s card', () => {
  it('carries its facts in the order it draws them, from the registry alone', () => {
    expect(sampleFacts(feed())).toEqual(['Los Angeles · Metro Rail', 'not downloaded yet'])
    expect(sampleFacts(feed({ cached: true, city: '', network: '', mode: '' }))).toEqual([
      'downloaded',
    ])
    expect(sampleStatus(feed({ cached: true }))).toBe('downloaded')
  })

  // ADR-047: what the mode keeps is configuration, and leaves the card. The
  // name is the card's words joined by commas, so it leaves the name too.
  it('says less than a row did: what its mode keeps is not on it or in its name', () => {
    const tram = feed({ mode: 'tram,rail', cached: true })
    expect(sampleName(tram)).toBe('LA Metro Rail, Los Angeles · Metro Rail, downloaded')
    const html = renderToStaticMarkup(
      <SampleCities presets={[tram]} sentence={null} onOpen={() => undefined} />,
    )
    expect(html).not.toMatch(/keeps|tram/)
  })

  it('is one card in the front door’s grid, one button each, its status a chip', () => {
    const html = renderToStaticMarkup(
      <SampleCities
        presets={[feed(), feed({ key: 'b', name: 'B', cached: true })]}
        sentence="x"
        onOpen={() => undefined}
      />,
    )
    expect(html).toContain('<ul class="cards" aria-label="Presets">')
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html.match(/<button type="button" class="card"/g)).toHaveLength(2)
    expect(html).toContain('<span class="card-chip">not downloaded yet</span>')
    expect(html).toContain('<span class="card-chip">downloaded</span>')
    // Found by its name, as the tests and the checklist find a card.
    expect(html).toContain('<li aria-label="LA Metro Rail">')
    expect(html).not.toContain('x</p>')
  })
})

describe('a card', () => {
  const TRAIN = iconMarkup('train', 24)

  // ADR-047, as of 6 Oct 2026: one `train` glyph at 24px, hidden from
  // assistive technology, and nothing else - no name of its own, no image.
  it('draws an empty picture area: the train glyph alone, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<Card name="Somewhere" onClick={() => undefined} />)
    const [area, ...more] = pictures(html)
    expect(more).toEqual([])
    expect(area).toBe(`<span class="icon icon-24" aria-hidden="true">${TRAIN}</span>`)
    expect(html).not.toMatch(/role=|aria-label|<img|alt=/)
  })

  it('shows the engine’s picture as an image with an empty alternative, and no glyph', () => {
    const html = renderToStaticMarkup(
      <Card name="Somewhere" picture="app://local/x.svg" onClick={() => undefined} />,
    )
    expect(pictures(html)).toEqual(['<img src="app://local/x.svg" alt=""/>'])
    expect(html).not.toContain('class="icon')
  })

  // The clamp is the stylesheet's (`.card-name`), so the whole name is in
  // the document for a screen reader and a reflow, and in the name it says.
  it('keeps a long name whole in the document and in its accessible name', () => {
    const name = 'Metropolitan'.repeat(10)
    const html = renderToStaticMarkup(
      <Card name={name} label={`Open ${name}`} onClick={() => undefined} />,
    )
    expect(html).toContain(`<span class="card-name">${name}</span>`)
    expect(html).toContain(`aria-label="Open ${name}"`)
  })

  it('is described by its facts, one to a line, and its chip after them', () => {
    const html = renderToStaticMarkup(
      <Card
        name="Somewhere"
        facts={['here', 'how far']}
        chip="read-only"
        factsId="f"
        onClick={() => undefined}
      />,
    )
    expect(html).toContain('aria-describedby="f"')
    expect(html).toContain(
      '<span class="card-facts" id="f"><span class="card-fact">here</span><span class="card-fact">how far</span><span class="card-chip">read-only</span></span>',
    )
  })
})

describe('Your projects', () => {
  const PLUS = iconMarkup('add', 24)

  it('puts the New project card first, named by what it says, with the plus where a picture would be', () => {
    const html = projects([project({ id: 'a', name: 'A' }), project({ id: 'b', name: 'B' })])
    const [first, ...rest] = items(html)
    expect(first).toBe(
      `<button type="button" class="card card-new"><span class="card-picture"><span class="icon icon-24" aria-hidden="true">${PLUS}</span></span><span class="card-name">New project</span></button>`,
    )
    expect(rest.map((item) => /aria-label="([^"]*)"/.exec(item)?.[1])).toEqual(['Open A', 'Open B'])
    // The one New project there is: no toolbar's, no empty state's.
    expect(html.match(/New project/g)).toHaveLength(1)
  })

  it('is one grid of the same card as the samples’', () => {
    const html = projects([project()])
    expect(html).toContain('<ul class="cards" aria-label="Projects">')
    expect(html.match(/<button type="button" class="card[" ]/g)).toHaveLength(2)
    // Every picture area holds one hidden glyph: the plus, then the train.
    expect(pictures(html)).toEqual([
      `<span class="icon icon-24" aria-hidden="true">${PLUS}</span>`,
      `<span class="icon icon-24" aria-hidden="true">${iconMarkup('train', 24)}</span>`,
    ])
  })

  it('with no projects, holds the New project card and the quiet line, once', () => {
    const html = projects([])
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html.split(PROJECTS_NONE)).toHaveLength(2)
    expect(html).toContain(`<p class="hint">${PROJECTS_NONE}</p>`)
    expect(html).toContain('class="projects projects-none"')
  })

  it('with one project, the document does not hold the quiet line', () => {
    const html = projects([project()])
    expect(html).not.toContain(PROJECTS_NONE)
    expect(html).not.toContain('projects-none')
  })

  it('names a project’s card "Open <name>", described by where it runs and how far it has got', () => {
    const html = projects([project({}, true)], [feed()])
    expect(html).toContain('aria-label="Open Los Angeles"')
    expect(html).toContain('aria-describedby="card-kq7x2mzp4dna-facts"')
    expect(html).toContain(
      '<span class="card-facts" id="card-kq7x2mzp4dna-facts"><span class="card-fact">Los Angeles · Metro Rail</span><span class="card-fact">finished up to 05 Lines</span><span class="card-chip">read-only</span></span>',
    )
    // A card says less than a row did (ADR-047).
    expect(html).not.toMatch(/Service day|Opened|Made |Feed la-metro-rail/)
  })

  it('keeps a long name whole in the document and in the card’s name', () => {
    const name = 'Metropolitan'.repeat(10)
    const html = projects([project({ name })])
    expect(html).toContain(`<span class="card-name">${name}</span>`)
    expect(html).toContain(`aria-label="Open ${name}"`)
  })

  it('says where a project runs from the listed feed, or by its key until it is listed', () => {
    expect(whereItRuns('la-metro-rail', [feed()])).toBe('Los Angeles · Metro Rail')
    expect(whereItRuns('la-metro-rail', [])).toBe('Feed la-metro-rail')
    expect(whereItRuns('mine', [feed({ key: 'mine', city: '', network: '' })])).toBe('Feed mine')
    expect(projectFacts(project({ layout: null, made: null, built: null }), [], null)).toEqual([
      'Feed la-metro-rail',
      'finished up to 01 Data; not laid out yet',
    ])
  })
})

// Nothing on a card moves (ADR-047, DESIGN.md section 7): no transition and
// no animation in any of the cards' rules, so an empty picture area can never
// become a shimmer, which says loading about a state that will not load.
// Reduced motion turns everything off besides (app.css); the end-to-end
// sweep checks the running app.
describe('the cards', () => {
  const panels = readFileSync(
    resolve(__dirname, '../../src/renderer/src/styles/panels.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('declare no motion of their own', () => {
    const rules = [...panels.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) =>
      /\.cards?\b|\.card-|\.projects-none/.test(selector),
    )
    expect(rules.length).toBeGreaterThan(5)
    for (const [, selector, body] of rules)
      expect(body, selector.trim()).not.toMatch(/\b(transition|animation)(-[a-z]+)?\s*:/)
    expect(panels).not.toMatch(/@keyframes/)
  })

  /**
   * The declarations of the one top-level rule whose selector is exactly
   * `selector`: one inside an at-rule begins straight after its `{`.
   */
  const declared = (selector: string): string => {
    const found = [...panels.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (m) => m[1].trim().replace(/\s+/g, ' ') === selector && panels[(m.index ?? 0) - 1] !== '{',
    )
    expect(found, selector).toHaveLength(1)
    return found[0][2]
  }

  // The kit's unlayered button rules (components.css, "Button") stand on
  // every native button the app declares nothing on, and two of them
  // outrank a class: a press's brand fill, and the small left padding of a
  // button whose descendant's first child is an svg, which the picture
  // area's glyph is (issue 273, issue 274). A card restates both.
  it('keep their own ground on a press, and their own edge beside the glyph', () => {
    expect(declared('.card:active, .card:hover:active')).toMatch(
      /background:\s*var\(--surface-hover\);[^}]*color:\s*var\(--text\)/,
    )
    const padding = /padding:\s*(var\(--[a-z0-9-]+\))/.exec(declared('.card'))?.[1]
    expect(padding).toBe('var(--space-4-3)')
    expect(declared('button:is(.card):not([icon]):has(svg:first-child)')).toMatch(
      new RegExp(`padding-left:\\s*${padding?.replace(/[()]/g, '\\$&')};`),
    )
  })

  // ADR-047's quiet line sits beside the New project card, in the tracks
  // after the first; where only one card fits to a row there are none, and
  // the line goes under the card rather than into a track the grid would
  // make, squeezing the card. A container query cannot read a token, so its
  // figure is written out; it is two cards and the gap between them, worked
  // out here from the tokens themselves, so a token that moves fails here
  // rather than leaving the query quietly wrong.
  it('put the quiet line under the New project card when one card fills the row', () => {
    const scale = readFileSync(
      resolve(__dirname, '../../src/renderer/src/styles/scale.css'),
      'utf8',
    )
    const token = (name: string, unit: 'rem' | 'px'): number => {
      const value = new RegExp(`${name}:\\s*([\\d.]+)${unit};`).exec(scale)?.[1]
      expect(value, `${name} in ${unit}`).toBeDefined()
      return Number(value)
    }
    const two =
      2 * token('--card-min-width', 'rem') + token('--space-4-3', 'px') / token('--root-size', 'px')
    expect(declared('.projects-none')).toMatch(
      /minmax\(var\(--card-min-width\), 1fr\)[\s\S]*gap:\s*var\(--space-4-3\)/,
    )
    expect(declared('.projects')).toMatch(/container-type:\s*inline-size/)
    expect(declared('.projects-none > .hint')).toMatch(/grid-column:\s*2 \/ -1/)
    const query =
      /@container \(width < ([\d.]+)rem\) \{\s*\.projects-none > \.hint \{([^}]*)\}/.exec(panels)
    expect(Number(query?.[1]), 'two cards and their gap, in rem').toBe(two)
    expect(query?.[2]).toMatch(/grid-column:\s*1 \/ -1/)
  })
})
