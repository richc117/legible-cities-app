// The geographic pane's text alternative (issue 105, spec 031): the engine's
// `description` of a stage graph turned into the sentences of User Stories 1
// and 2, with nothing worked out on this side (FR-007). Each sentence is
// held to the spec's own words, so a change of wording fails here and not in
// front of a screen reader.
//
// The fixture is invented and small; every line of it is one of the cases
// the spec names. The lines are deliberately not in alphabetical order: the
// engine's order is the order drawn, and a module that sorted them would
// fail the test that holds that.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NetworkInWords } from '../../src/renderer/src/StageView'
import {
  UNNAMED,
  WORDS_GROUP,
  WORDS_SUMMARY,
  networkWords,
  paneName,
  readDescription,
} from '../../src/renderer/src/networkWords'
import type { StageDescription } from '../../src/shared/protocol'

type Line = StageDescription['lines'][number]

const line = (over: Partial<Line> & Pick<Line, 'label'>): Line => ({
  termini: [],
  stations: [],
  meets: [],
  branches: [],
  trip: null,
  ...over,
})

/** A line from the first of its stations to the last, meeting nothing. */
const run = (label: string, stations: string[], over: Partial<Line> = {}): Line =>
  line({ label, termini: [stations[0], stations[stations.length - 1]], stations, ...over })

const BLUE = run('Blue', ['Daly City', 'Balboa Park', 'Bay Fair', 'Dublin / Pleasanton'], {
  meets: [
    { station: 'Balboa Park', lines: ['Green'] },
    { station: 'Bay Fair', lines: ['Green', 'Orange'] },
  ],
})

const RED = run('Red', ['Richmond', 'MacArthur', 'San Bruno'], {
  meets: [{ station: 'MacArthur', lines: ['Orange', 'Yellow'] }],
  branches: [{ at: 'San Bruno', stations: ['Millbrae'] }],
})

const LOOP = line({
  label: 'BridgeA',
  termini: ['Kestrel'],
  stations: ['Kestrel', 'Linnet', 'Merlin', 'Osprey'],
})

const SOLO = line({
  label: 'Solo',
  termini: ['Wren'],
  stations: ['Wren'],
  meets: [{ station: 'Wren', lines: ['Blue'] }],
})

const PIECES = run('S', ['Alder', 'Birch'], {
  branches: [
    { at: null, stations: ['Cedar', 'Elm', 'Fir'] },
    { at: 'Elm', stations: ['Gum'] },
  ],
})

const GHOST = run('Ghost', ['', 'Yarrow', 'Zinnia'], {
  meets: [{ station: '', lines: ['Blue'] }],
})

const HUB = run('Hub', ['Alpha', 'Beta', 'Gamma'], {
  meets: [
    { station: 'Alpha', lines: ['Blue'] },
    { station: 'Beta', lines: ['Blue', 'Red', 'Green'] },
    { station: 'Gamma', lines: ['Red'] },
  ],
})

const FIXTURE: StageDescription = {
  extent: {
    minutes: 104,
    line: 'Yellow',
    from: 'San Francisco International Airport',
    to: 'Antioch',
  },
  // Not in alphabetical order, on purpose.
  lines: [RED, BLUE, LOOP, SOLO, PIECES, GHOST, HUB],
}

const sentenceOf = (label: string, description: StageDescription = FIXTURE): string => {
  const found = networkWords(description).lines.find((l) => l.label === label)
  if (found === undefined) throw new Error(`no line ${label} in the words`)
  return found.sentence
}

describe('the extent sentence', () => {
  it('says the longest trip, its line and its two ends', () => {
    expect(networkWords(FIXTURE).extent).toBe(
      'On the day drawn, the longest trip on one line takes 104 minutes: the Yellow from San Francisco International Airport to Antioch.',
    )
  })

  it('is absent when the engine sent no extent, and nothing stands in its place', () => {
    // No service day, or no trip that day: the engine's null, left out.
    const words = networkWords({ ...FIXTURE, extent: null })
    expect(words.extent).toBeNull()
    expect(words.lines).toHaveLength(FIXTURE.lines.length)
  })

  it('reads a round trip for a trip that ends where it began', () => {
    const words = networkWords({
      ...FIXTURE,
      extent: { minutes: 31, line: 'BridgeA', from: 'Kestrel', to: 'Kestrel' },
    })
    expect(words.extent).toBe(
      'On the day drawn, the longest trip on one line takes 31 minutes: the BridgeA, a round trip from Kestrel.',
    )
  })

  it('names a station the feed does not name', () => {
    const words = networkWords({
      ...FIXTURE,
      extent: { minutes: 12, line: 'Ghost', from: '', to: 'Zinnia' },
    })
    expect(words.extent).toContain(`the Ghost from ${UNNAMED} to Zinnia.`)
  })

  it('says one minute in the singular', () => {
    const words = networkWords({
      ...FIXTURE,
      extent: { minutes: 1, line: 'Blue', from: 'A', to: 'B' },
    })
    expect(words.extent).toContain('takes 1 minute: the Blue')
  })
})

describe('a line that runs from one end to another', () => {
  it('names its ends, counts its stations and says where it meets other lines', () => {
    expect(sentenceOf('Blue')).toBe(
      'Blue: from Daly City to Dublin / Pleasanton, 4 stations; meets Green at Balboa Park, and Green and Orange at Bay Fair.',
    )
  })

  it('says it meets no other line when the engine lists no meeting', () => {
    const quiet = run('Quiet', ['A', 'B'])
    expect(sentenceOf('Quiet', { extent: null, lines: [quiet] })).toBe(
      'Quiet: from A to B, 2 stations; meets no other line.',
    )
  })

  it('keeps every meeting the engine lists, in the order it lists them', () => {
    // Three entries, one of them with three lines: the commas close the list
    // and are never confused with the ones inside an entry.
    expect(sentenceOf('Hub')).toBe(
      'Hub: from Alpha to Gamma, 3 stations; meets Blue at Alpha, Blue, Red and Green at Beta, and Red at Gamma.',
    )
  })

  it('names every other line at an interchange, so none is dropped (SC-004)', () => {
    // The mutation this test exists for: a `meets` entry, or one of the
    // lines in an entry, dropped. Every other line the fixture names is in
    // the sentence, and so is every station it names.
    for (const l of FIXTURE.lines) {
      const sentence = sentenceOf(l.label)
      for (const meeting of l.meets) {
        for (const other of meeting.lines)
          expect(sentence, `${l.label} meets ${other}`).toContain(other)
        expect(sentence, `${l.label} meets at ${meeting.station}`).toContain(
          meeting.station === '' ? UNNAMED : meeting.station,
        )
      }
    }
    expect(sentenceOf('Red')).toContain('meets Orange and Yellow at MacArthur.')
  })
})

describe('the shapes a line can take', () => {
  it('a branch adds where it leaves and where it ends, and counts its stations', () => {
    expect(sentenceOf('Red')).toBe(
      'Red: from Richmond to San Bruno, 4 stations, with a branch from San Bruno to Millbrae; meets Orange and Yellow at MacArthur.',
    )
  })

  it('a loop is a loop of so many stations through its one terminus', () => {
    expect(sentenceOf('BridgeA')).toBe(
      'BridgeA: a loop of 4 stations through Kestrel; meets no other line.',
    )
  })

  it('a line of one station says so', () => {
    expect(sentenceOf('Solo')).toBe('Solo: one station, Wren; meets Blue at Wren.')
  })

  it('a separate section is told apart from a branch, and each is told in the order sent', () => {
    expect(sentenceOf('S')).toBe(
      'S: from Alder to Birch, 6 stations, and a separate section from Cedar to Fir, with a branch from Elm to Gum; meets no other line.',
    )
  })

  it('a separate section of one station is not told as from it to itself', () => {
    const one = run('T', ['A', 'B'], { branches: [{ at: null, stations: ['C'] }] })
    expect(sentenceOf('T', { extent: null, lines: [one] })).toBe(
      'T: from A to B, 3 stations, and a separate section of one station, C; meets no other line.',
    )
  })

  it('a station with no name reads as an unnamed station, wherever it falls', () => {
    expect(sentenceOf('Ghost')).toBe(
      `Ghost: from ${UNNAMED} to Zinnia, 3 stations; meets Blue at ${UNNAMED}.`,
    )
    expect(UNNAMED).toBe('an unnamed station')
    const branchy = run('U', ['A', 'B'], { branches: [{ at: '', stations: [''] }] })
    expect(sentenceOf('U', { extent: null, lines: [branchy] })).toContain(
      `with a branch from ${UNNAMED} to ${UNNAMED};`,
    )
  })

  it('a name of only spaces is unnamed too', () => {
    const blank = run('V', ['  ', 'B'])
    expect(sentenceOf('V', { extent: null, lines: [blank] })).toContain(`from ${UNNAMED} to B`)
  })
})

describe('the list: one item per line, in the engine order', () => {
  it('keeps the order the engine sent and sorts nothing', () => {
    expect(networkWords(FIXTURE).lines.map((l) => l.label)).toEqual([
      'Red',
      'Blue',
      'BridgeA',
      'Solo',
      'S',
      'Ghost',
      'Hub',
    ])
  })

  it('has exactly one sentence per line and lists no station at the top (FR-005)', () => {
    const words = networkWords(FIXTURE)
    expect(words.lines).toHaveLength(FIXTURE.lines.length)
    // A station that is not an end, an interchange or a branch's end appears
    // in no sentence: Bay Fair is an interchange, Linnet is not.
    expect(words.lines.map((l) => l.sentence).join(' ')).not.toContain('Linnet')
  })

  it('puts a forty-line network under forty-two sentences at the top (SC-002)', () => {
    const forty: StageDescription = {
      extent: FIXTURE.extent,
      lines: Array.from({ length: 40 }, (_, i) => run(`L${i}`, ['A', 'B', 'C'])),
    }
    const words = networkWords(forty)
    const sentences = [words.extent ?? '', ...words.lines.map((l) => l.sentence)]
    // One extent sentence, and one item per line each holding one: a
    // sentence is a string that ends in a full stop, and none holds two.
    for (const s of sentences) expect(s.match(/\.(?=\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1)
    const stops = sentences.reduce((n, s) => n + (s.match(/\.(?=\s|$)/g)?.length ?? 0), 0)
    expect(stops, 'sentences at the top').toBeLessThan(42)
  })

  it('names the disclosures as the spec does', () => {
    expect(WORDS_SUMMARY).toBe('The network in words')
    expect(WORDS_GROUP).toBe("The network's extent and its lines")
    const blue = networkWords(FIXTURE).lines.find((l) => l.label === 'Blue')
    expect(blue?.disclosure).toBe('Stations on Blue, in order')
    expect(blue?.group, 'one name is not heard twice').not.toBe(blue?.disclosure)
  })
})

describe('the stations in order (User Story 2)', () => {
  it('lists a line’s stations as the engine sent them, termini first and last', () => {
    const blue = networkWords(FIXTURE).lines.find((l) => l.label === 'Blue')
    expect(blue?.stations).toEqual(['Daly City', 'Balboa Park', 'Bay Fair', 'Dublin / Pleasanton'])
    expect(blue?.further).toEqual([])
  })

  it('lists each branch and separate section after the run, headed', () => {
    const pieces = networkWords(FIXTURE).lines.find((l) => l.label === 'S')
    expect(pieces?.stations).toEqual(['Alder', 'Birch'])
    expect(pieces?.further).toEqual([
      { heading: 'A separate section, in order', stations: ['Cedar', 'Elm', 'Fir'] },
      { heading: 'Branch from Elm, in order', stations: ['Gum'] },
    ])
  })

  it('names an unnamed station in the list too', () => {
    const ghost = networkWords(FIXTURE).lines.find((l) => l.label === 'Ghost')
    expect(ghost?.stations).toEqual([UNNAMED, 'Yarrow', 'Zinnia'])
  })
})

describe('a name is text, whatever it holds (FR-008)', () => {
  it('passes markup through as the characters it is', () => {
    const hostile = '<img src=x onerror="alert(1)"> & </script>'
    const words = networkWords({
      extent: null,
      lines: [run('X', [hostile, 'B'], { meets: [{ station: hostile, lines: ['Y'] }] })],
    })
    expect(words.lines[0].sentence).toBe(
      `X: from ${hostile} to B, 2 stations; meets Y at ${hostile}.`,
    )
    expect(words.lines[0].stations[0]).toBe(hostile)
  })
})

describe('the pane’s name (FR-002)', () => {
  const stage = { label: 'gtfs2graph', gloss: 'as the feed draws its routes' }

  it('is the stage, its gloss and the counts', () => {
    expect(paneName(stage, { stations: 3, lines: ['A', 'B'] })).toBe(
      'The gtfs2graph stage, as the feed draws its routes: 2 lines, 3 stations',
    )
  })

  it('counts lines and then stations, and reads one of either in the singular', () => {
    expect(paneName(stage, { stations: 1, lines: ['A'] })).toBe(
      'The gtfs2graph stage, as the feed draws its routes: 1 line, 1 station',
    )
  })

  it('follows the stage shown', () => {
    expect(
      paneName(
        { label: 'loom', gloss: 'lines sorted onto shared track' },
        { stations: 3, lines: [] },
      ),
    ).toBe('The loom stage, lines sorted onto shared track: 0 lines, 3 stations')
  })
})

describe('a description that did not come as one (the older pin)', () => {
  it('is none when it is absent or not an object', () => {
    for (const value of [undefined, null, 'words', 3, [], true]) {
      expect(readDescription(value), String(value)).toBeNull()
    }
  })

  it('is none when its lines are not a list, or a line or an extent is malformed', () => {
    expect(readDescription({ extent: null })).toBeNull()
    expect(readDescription({ extent: null, lines: {} })).toBeNull()
    expect(readDescription({ extent: null, lines: [null] })).toBeNull()
    expect(readDescription({ extent: { minutes: '9' }, lines: [] })).toBeNull()
    expect(readDescription({ extent: undefined, lines: [] })).toBeNull()
    expect(readDescription({ extent: null, lines: [{ ...BLUE, termini: 'Daly City' }] })).toBeNull()
    // The nested checks, each reached with the rest of the line well formed.
    expect(
      readDescription({ extent: null, lines: [{ ...BLUE, stations: ['A', 1] }] }),
      'a station that is not a name',
    ).toBeNull()
    expect(
      readDescription({ extent: null, lines: [{ ...BLUE, meets: [{ station: 'X' }] }] }),
      'a meeting with no lines',
    ).toBeNull()
    expect(
      readDescription({ extent: null, lines: [{ ...BLUE, label: null }] }),
      'a line with no label',
    ).toBeNull()
    expect(
      readDescription({ extent: null, lines: [{ ...BLUE, meets: [{ station: 1 }] }] }),
    ).toBeNull()
    expect(
      readDescription({ extent: null, lines: [{ ...BLUE, branches: [{ at: 3, stations: [] }] }] }),
    ).toBeNull()
  })

  it('is the description itself when it is one', () => {
    expect(readDescription(FIXTURE)).toBe(FIXTURE)
    expect(readDescription({ extent: null, lines: [] })).toEqual({ extent: null, lines: [] })
  })

  it('is whole or none: one bad line draws no words for the rest', () => {
    expect(readDescription({ extent: null, lines: [BLUE, { label: 'Broken' }] })).toBeNull()
  })
})

describe('the disclosure as drawn (FR-003, FR-005, FR-008)', () => {
  const draw = (
    description: StageDescription,
    { open = false, lines = [] as string[] } = {},
  ): string =>
    renderToStaticMarkup(
      createElement(NetworkInWords, {
        words: networkWords(description),
        open,
        onToggle: () => {},
        openLines: new Set(lines),
        onToggleLine: () => {},
      }),
    )

  it('is one closed disclosure named "The network in words", with no heading of its own', () => {
    const html = draw(FIXTURE)
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*The network in words<\/button>/)
    expect(html, 'its disclosed group is hidden while it is closed').toMatch(
      /<div[^>]*role="group"[^>]*aria-label="The network&#x27;s extent and its lines"[^>]*hidden=""/,
    )
    expect(html, 'the section’s own h3 already heads it').not.toMatch(/<h[1-6]/)
  })

  it('opens onto the extent and a list with one item per line, and no station', () => {
    const html = draw(FIXTURE, { open: true })
    expect(html).toContain('On the day drawn, the longest trip on one line takes 104 minutes')
    expect(html.match(/<li class="network-line"/g)).toHaveLength(FIXTURE.lines.length)
    expect(html, 'no station list is open until a person opens one').not.toContain('<ol')
    // Each line's own disclosure is there and closed.
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(FIXTURE.lines.length)
    expect(html.match(/aria-expanded="true"/g), 'and the outer one is the open one').toHaveLength(1)
    expect(html).toContain('Stations on Blue, in order')
  })

  it('opens one line’s stations as an ordered list of names, and only that line’s', () => {
    const html = draw(FIXTURE, { open: true, lines: ['Blue'] })
    expect(html.match(/<ol class="network-stations">/g)).toHaveLength(1)
    const items = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1])
    expect(items).toEqual(['Daly City', 'Balboa Park', 'Bay Fair', 'Dublin / Pleasanton'])
  })

  it('draws a line’s branch after its run, headed', () => {
    const html = draw(FIXTURE, { open: true, lines: ['S'] })
    expect(html.match(/<ol class="network-stations">/g)).toHaveLength(3)
    expect(html).toContain('A separate section, in order')
    expect(html).toContain('Branch from Elm, in order')
  })

  it('draws no extent paragraph when the engine sent none', () => {
    expect(draw({ ...FIXTURE, extent: null }, { open: true })).not.toContain('network-extent')
  })

  it('draws a name as text and never as markup', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const html = draw(
      { extent: null, lines: [run('X', [hostile, 'B'])] },
      { open: true, lines: ['X'] },
    )
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('is drawn by a file that sets no markup and never touches the frame’s sandbox', () => {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/StageView.tsx'), 'utf8')
    expect(source).not.toContain('dangerouslySetInnerHTML')
    expect(source).not.toContain('allow-same-origin')
    // The frame is still hidden from assistive technology, and the glass is.
    expect(source.match(/aria-hidden="true"/g)).toHaveLength(2)
    expect(source).toContain('sandbox={STAGE_SANDBOX}')
    // Closed until a person opens it: the component holds the state, and it
    // starts false (the draw above only shows what a given `open` draws).
    expect(source).toMatch(/const \[wordsOpen, setWordsOpen\] = useState\(false\)/)
  })
})
