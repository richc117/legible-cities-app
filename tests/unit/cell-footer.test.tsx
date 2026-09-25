// The provenance footer (A5.5-11): what the three cells that have
// provenance say in it, what the other three say instead - nothing - and
// what none of them may ever print.
//
// The builders are pure functions beside their component, so a layout with
// no `built`, a window of one day, a day a person picked and an engine that
// has not answered yet are a table here rather than four states of a
// running app. The strip itself is rendered to static markup, as the
// cell's own test is: what is asserted is what the component draws.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CellFooter, {
  carriesPath,
  drawableFacts,
  exportFacts,
  exportFooter,
  frameFacts,
  frameFooter,
  processFacts,
  SIDECAR_NOTE,
} from '../../src/renderer/src/notebook/CellFooter'
import type { EngineInfo } from '../../src/shared/protocol'
import type { ProjectRecord, ServiceWindow } from '../../src/shared/project'

const renderer = resolve(__dirname, '../../src/renderer/src')

const LAYOUT = 'd1deeb11f0c4ab93e2f5d0a7b6c5e4d3c2b1a09876543210fedcba9876543210'

const INFO: EngineInfo = {
  engine: '0.8.3',
  protocol: 1,
  python: '3.12.7',
  loom: { commit: '6c38a2f1d0e9b8a7c6d5e4f3a2b1c0d9e8f7a6b5', backend: 'native' },
  ffmpeg: 'ffmpeg',
  // The one absolute path `engine.info` carries. It has no business on a
  // screen, and the strip is the place a later branch would reach for it.
  home: '/Volumes/Work/legible-cities/engine',
}

const WINDOW: ServiceWindow = {
  start: '2026-03-01',
  end: '2026-06-30',
  busiest: '2026-03-17',
  anchor: '2026-03-10',
}

type Process = Pick<ProjectRecord, 'layout' | 'made' | 'built' | 'mode' | 'agency'>

const project = (over: Partial<Process> = {}): Process => ({
  layout: LAYOUT,
  made: '2026-09-13T14:03:00+00:00',
  built: { mode: 'rail', agency: 'LACMTA' },
  mode: 'rail',
  agency: 'LACMTA',
  ...over,
})

const terms = (facts: { term: string }[]): string[] => facts.map((fact) => fact.term)

const draw = (node: ReturnType<typeof frameFooter>): string =>
  node === undefined ? '' : renderToStaticMarkup(node)

describe('cell 02’s provenance', () => {
  it('names the layout’s eight characters, when it was made, and what it was made with', () => {
    const facts = processFacts(project(), null)
    expect(terms(facts)).toEqual(['Layout', 'Made', 'Built with'])
    expect(facts[0].value).toBe('d1deeb11')
    expect(facts[2].value).toBe('rail, LACMTA')
  })

  it('keeps the exact moment on the element and shows it in the person’s locale', () => {
    // The builder hands the strip the record's ISO value and the strip
    // renders it; a builder cannot hand it an element (`Fact.value`).
    expect(processFacts(project(), null)[1].value).toEqual({ iso: '2026-09-13T14:03:00+00:00' })
    const html = renderToStaticMarkup(<CellFooter facts={processFacts(project(), null)} />)
    // React writes the attribute as it is spelled in JSX; HTML reads it
    // case-insensitively, so the test does too.
    expect(html).toMatch(/<time datetime="2026-09-13T14:03:00\+00:00"/i)
    // The locale rendering is the machine's, so what is asserted is that it
    // is not the ISO string shown raw.
    expect(html).toContain(new Date('2026-09-13T14:03:00+00:00').toLocaleString())
  })

  it('says nothing about a layout that does not exist, or about facts the record lacks', () => {
    expect(processFacts(project({ layout: null }), INFO)).toEqual([])
    expect(terms(processFacts(project({ made: null, built: null }), null))).toEqual(['Layout'])
  })

  it('names the engine and LOOM as this moment’s, in the term, and neither before they answer', () => {
    expect(terms(processFacts(project(), null))).not.toContain('Engine now')
    const facts = processFacts(project(), INFO)
    // The tense is in the term and not in a comment: the three above these
    // describe the stored layout and these two describe this moment, and a
    // bare "Engine" in a provenance strip says the layout was made by it.
    // "Now" and not "running", because nothing named LOOM is running while
    // this is read - it is a binary the engine shells out to per layout.
    expect(terms(facts)).toEqual(['Layout', 'Made', 'Built with', 'Engine now', 'LOOM now'])
    expect(facts[3].value).toBe('0.8.3')
    // The commit as git writes it short, beside the backend that built it.
    expect(facts[4].value).toBe('native, 6c38a2f')
  })

  it('says what Settings says when the host reported no LOOM commit', () => {
    const facts = processFacts(project(), { ...INFO, loom: { commit: null, backend: 'docker' } })
    expect(facts[4].value).toBe('docker, the host reported no commit')
  })

  it('leaves A2-02’s moved-inputs sentence to the panel that acts on it', () => {
    // `LayoutRun` renders it inside this same cell, beside the button it
    // tells a person to press ("so lay out to draw with ..."), so a strip
    // that said it too would put those words on screen twice in one cell.
    // The strip carries the facts; the panel carries the sentence.
    const layoutRun = readFileSync(join(renderer, 'LayoutRun.tsx'), 'utf8')
    expect(layoutRun, 'the panel still says it').toContain('the choice has changed since, so')
    const footer = readFileSync(join(renderer, 'notebook/CellFooter.tsx'), 'utf8')
      .split('\n')
      // Its own comments say why it is not here, and are not the strip.
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n')
    expect(footer).not.toContain('the choice has changed since')
    expect(footer).not.toContain('lay out to draw with')
    // And the fact under the sentence stays: what the layout was made with.
    expect(terms(processFacts(project({ built: { mode: 'rail', agency: null } }), null))).toContain(
      'Built with',
    )
  })
})

describe('cell 03’s provenance', () => {
  it('names the day and the three answers the engine gave beside it', () => {
    const facts = frameFacts({ date: '2026-03-17', service: WINDOW })
    expect(terms(facts)).toEqual([
      'Service day',
      'The feed covers',
      'The engine’s busiest weekday',
      'Counted from',
    ])
    expect(facts[0].value).toBe('2026-03-17')
    expect(facts[1].value).toBe('2026-03-01 to 2026-06-30')
    expect(facts[2].value).toBe('2026-03-17')
    expect(facts[3].value).toBe('2026-03-10')
  })

  it('says the same four things for a day the person picked, and credits no one', () => {
    // Whose choice the day was is not said at all, because it cannot be
    // read off the record: the day and the engine's answer are drawn as
    // themselves and a person compares them.
    const facts = frameFacts({ date: '2026-04-02', service: WINDOW })
    expect(terms(facts)).toEqual([
      'Service day',
      'The feed covers',
      'The engine’s busiest weekday',
      'Counted from',
    ])
    expect(facts[0].value).toBe('2026-04-02')
    expect(facts[2].value).toBe('2026-03-17')
  })

  it('does not credit the engine’s own day to the person after a second layout run', () => {
    // The case this cell exists to get right. Every layout run asks
    // `feeds.service` again with today as the anchor and writes the fresh
    // window, keeping the day (`projects-store.test.ts`, "replaces the
    // window on a later run, keeping the day"), so a day the engine chose
    // in March sits beside a busiest weekday counted from September. A
    // strip that inferred from `busiest === date` would say "by you".
    const later = {
      start: '2026-03-01',
      end: '2026-11-30',
      busiest: '2026-09-15',
      anchor: '2026-09-08',
    }
    const facts = frameFacts({ date: '2026-03-17', service: later })
    const said = facts.map((fact) => `${fact.term}: ${String(fact.value)}`).join(' | ')
    expect(said).not.toContain('by you')
    expect(said).not.toContain('by the engine')
    // Both answers are there to be compared, and neither is dropped
    // because it stopped matching the day.
    expect(facts[2].value).toBe('2026-09-15')
    expect(facts[3].value).toBe('2026-09-08')
  })

  it('draws none of the panel’s own sentence, whose words its terms share', () => {
    // `ServiceDay` says "the busiest weekday, counted from A, is B" as
    // prose in this same cell (pinned here, as the A2-02 test pins
    // `LayoutRun`'s). The strip names the same two facts as two terms and
    // never draws that clause, in a term or in a value.
    const serviceDay = readFileSync(join(renderer, 'ServiceDay.tsx'), 'utf8')
    expect(serviceDay, 'the panel still says it').toContain('the busiest weekday, counted from')
    const drawn = frameFacts({ date: '2026-03-17', service: WINDOW })
      .map((fact) => `${fact.term} ${String(fact.value)}`)
      .join(' ')
    expect(drawn.toLowerCase()).not.toContain('busiest weekday, counted from')
  })

  it('says a window of one day as one day', () => {
    const one = { ...WINDOW, start: '2026-03-17', end: '2026-03-17' }
    expect(frameFacts({ date: '2026-03-17', service: one })[1].value).toBe('one day, 2026-03-17')
  })

  it('draws no footer at all before a layout run has answered a window', () => {
    expect(frameFacts({ date: '2026-03-17', service: null })).toEqual([])
    expect(frameFooter({ date: '2026-03-17', service: null })).toBeUndefined()
    expect(frameFooter({ date: null, service: WINDOW })).toBeUndefined()
    expect(frameFooter(null)).toBeUndefined()
  })
})

describe('cell 06’s provenance', () => {
  it('names the file the export wrote, and what the engine wrote beside it', () => {
    const facts = exportFacts({ state: 'done', file: 'los-angeles-reel.mp4' })
    expect(terms(facts)).toEqual(['Exported'])
    expect(facts[0].value).toBe('los-angeles-reel.mp4')
    expect(draw(exportFooter({ state: 'done', file: 'los-angeles-reel.mp4' }))).toContain(
      SIDECAR_NOTE,
    )
  })

  it('draws no footer for an export that wrote nothing', () => {
    for (const state of ['idle', 'running', 'cancelled', 'failed'] as const) {
      expect(exportFooter({ state, file: null }), state).toBeUndefined()
      // And not on the name alone: the file is the deliverable of an export
      // that finished, and a run that was cancelled or failed left nothing
      // for it to be the provenance of.
      expect(exportFooter({ state, file: 'los-angeles-reel.mp4' }), state).toBeUndefined()
    }
    // A run that ended well but reported no name has nothing to show either.
    expect(exportFooter({ state: 'done', file: null })).toBeUndefined()
  })
})

describe('a footer prints no absolute path, on any platform', () => {
  // `bin/preflight` reads the repository, not what the app prints at
  // runtime, so this is the only thing standing between a person's home
  // folder and a screenshot of a cell.
  const paths = [
    '/Volumes/Work/exports/legible-cities-reel.mp4',
    'C:\\Exports\\legible-cities-reel.mp4',
    '/srv/exports/legible-cities/reel.mp4',
  ]
  for (const path of paths) {
    it(`refuses the row rather than rewriting it: ${path}`, () => {
      expect(carriesPath(path)).toBe(true)
      const html = draw(exportFooter({ state: 'done', file: path }))
      expect(html).not.toContain(path)
      // Refused, not rewritten: the row is absent, and the words "a file"
      // are never put in a field's place (see below for why).
      expect(html).not.toContain('a file')
      expect(html).not.toContain('Exported')
    })
  }

  it('leaves a value alone that only looks like one, and never invents "a file"', () => {
    // `withoutPaths` is written for the engine's sentences and replaces
    // what it matches with the words "a file". A record's `agency` is
    // unvalidated beyond its length and comes from a feed's `agency_id`, so
    // running values through it would draw an operator called `LA / Metro`
    // as "rail, LA a file Metro" - while `LayoutRun` prints the real name
    // four lines above. A field rewritten is a field falsified.
    const separators = processFacts(
      project({ built: { mode: 'rail', agency: 'LA / Metro' } }),
      null,
    )
    expect(separators[2].value).toBe('rail, LA / Metro')
    const html = renderToStaticMarkup(<CellFooter facts={separators} />)
    expect(html).toContain('rail, LA / Metro')
    expect(html).not.toContain('a file')
    // And the one that really would show a path is dropped whole, rather
    // than drawn as a sentence about a file.
    const slashed = processFacts(project({ built: { mode: 'rail', agency: '/LACMTA' } }), null)
    expect(slashed[2].value).toBe('rail, /LACMTA')
    expect(drawableFacts(slashed).map((fact) => fact.term)).toEqual(['Layout', 'Made'])
  })

  it('does not print the engine home, wherever a value comes from', () => {
    const facts = processFacts(project(), INFO)
    const html = renderToStaticMarkup(<CellFooter facts={facts} note={INFO.home} />)
    expect(html).not.toContain(INFO.home)
    expect(JSON.stringify(facts)).not.toContain(INFO.home)
    // A note is a sentence, which is what `withoutPaths` is for, so it is
    // rewritten rather than refused.
    expect(html).toContain('a file')
  })
})

describe('which cells reach for a footer at all', () => {
  // **A guard, not a guarantee.** It reads source text, so what it holds is
  // that the next branch to want a footer does not get one by copying the
  // nearest cell that has one: cells 01, 04 and 05 have no provenance, and
  // a strip under the line colours saying "changed just now" is chrome
  // pretending to be information (A5.5-11). What each cell actually
  // *renders* is held by `tests/e2e/layout.spec.ts`, which lays a project
  // out and reads the strips off the screen.
  const cells = join(renderer, 'notebook/cells')
  const withFooter = {
    'ProcessCell.tsx': 'processFooter(',
    'FrameCell.tsx': 'frameFooter(',
    'ExportCell.tsx': 'exportFooter(',
  }
  const without = ['DataCell.tsx', 'StyleCell.tsx', 'LinesCell.tsx']

  for (const [file, builder] of Object.entries(withFooter)) {
    it(`${file} draws its own`, () => {
      const source = readFileSync(join(cells, file), 'utf8')
      // Its own builder, named: `toContain('CellFooter')` is satisfied by
      // the import line alone, and would pass on `footer={undefined}` or on
      // one cell handing another cell's strip to `Cell`.
      expect(source).toMatch(new RegExp(`footer=\\{${builder.replace('(', '\\(')}`))
    })
  }

  for (const file of without) {
    it(`${file} draws none`, () => {
      const source = readFileSync(join(cells, file), 'utf8')
      expect(source).not.toContain('CellFooter')
      expect(source).not.toMatch(/footer=\{/)
    })
  }

  it('the sample page draws the real strip and imitates none of it', () => {
    // `?cell-preview` is what `tests/e2e/notebook.spec.ts` walks. It drew a
    // hand-written `<span>Engine 0.8.3, LOOM 6c38a2f</span>` before this
    // branch, which is how a sample page and the component it stands for
    // drift apart without anything failing.
    const preview = readFileSync(join(renderer, 'notebook/CellPreview.tsx'), 'utf8')
    // The same three builders the cells call, and cell 02's own
    // composition rather than a second one assembled here.
    for (const builder of ['processStrip(', 'frameFooter(', 'exportFooter(']) {
      expect(preview, builder).toContain(builder)
    }
    expect(preview).not.toMatch(/<span>[^<]*LOOM[^<]*<\/span>/)
  })
})
