// The export run's region is named for the run (issue 258): "Export run",
// as cell 02's is "Layout run".
//
// The rule is one sentence: a run's region is a noun naming the run, its
// controls are verbs, and no region shares its name with a control inside
// it. The region was named "Export" around a button named "Export", which a
// screen reader reads as one name for where a person is and what they can
// do there. The sweep's rule for a name said twice (`a11y-names.ts`, issue
// 208) found it, and `tests/e2e/notebook-a11y.spec.ts` shows that rule the
// live screen; what that cannot do is run without the application. This
// does, over what the component itself draws.
//
// Rendered to static markup, as the notebook's other component tests are,
// against a run that is a plain object in the state under test. The names
// read out of the markup are the region's `aria-label` and the text of each
// button inside it, which is how Playwright names a button that has no
// label of its own; they are handed to the sweep's own rule, with no pair
// excused, as the snapshot's text it reads.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ExportRun, { ENCODE_UNFINISHED } from '../../src/renderer/src/ExportRun'
import {
  EXPORT_KEPT,
  ExportRun as Run,
  freshStages,
  stagesAt,
  type ExportBridge,
} from '../../src/renderer/src/engine/exportRun'
import { JobRegistry } from '../../src/renderer/src/engine/runs'
import { UNPROVEN_FRAMES, type ExportProgress, type ExportResult } from '../../src/shared/export'
import { endSentence } from '../../src/shared/jobs'
import type { Stage } from '../../src/renderer/src/ProgressLine'
import type { RunState } from '../../src/shared/layout'
import { describePair, duplicatedNames } from '../support/a11y-names'

/** The export run in one state, drawn as the cell draws it. */
function draw(
  state: RunState,
  stages: Stage[] = freshStages(),
  left = false,
  refused = false,
): string {
  const run = {
    snapshot: {
      state,
      stages,
      message: null,
      announced: null,
      error: null,
      file: 'la-metro-rail.mp4',
      left,
      refused,
    },
    subscribe: () => () => undefined,
    start: () => undefined,
    cancel: () => undefined,
    reveal: () => undefined,
  }
  return renderToStaticMarkup(
    <ExportRun
      run={run as never}
      project={{} as never}
      engine={null}
      choice={{ preset: 'instagram-reel', options: {} }}
    />,
  )
}

/** The region's name, or null where the run draws no region. */
const regionOf = (html: string): string | null =>
  /<section class="export-run" aria-label="([^"]*)">/.exec(html)?.[1] ?? null

/** What each button says, in order: the text after its icon. */
const buttonsOf = (html: string): string[] =>
  [...html.matchAll(/<fig-button\b[^>]*>(.*?)<\/fig-button>/g)].map((match) =>
    match[1].replace(/<span class="icon"[\s\S]*?<\/span>/, ''),
  )

// What a state draws inside the region, which is what the region's name must
// not be: Cancel while it runs; and once it has ended Export again, with
// Reveal before it when a file was written.
const STATES: [RunState, string[]][] = [
  ['running', ['Cancel']],
  ['done', ['Reveal', 'Export']],
  ['failed', ['Export']],
  ['cancelled', ['Export']],
]

describe('the export run, named for the run', () => {
  it.each(STATES)('%s: a region named "Export run", holding %j', (state, buttons) => {
    const html = draw(state)
    expect(regionOf(html)).toBe('Export run')
    expect(buttonsOf(html)).toEqual(buttons)
  })

  it('before any export has run there is no region, only the button', () => {
    const html = draw('idle')
    expect(regionOf(html)).toBeNull()
    expect(buttonsOf(html)).toEqual(['Export'])
  })

  it.each(STATES)('%s: no control inside it is named as the region is', (state) => {
    // Both names are read out of the one drawing, so what the rule judges
    // is the markup itself and not a table written beside it.
    const html = draw(state)
    const region = regionOf(html)
    const buttons = buttonsOf(html)
    expect(region, 'the run draws a region').not.toBeNull()
    expect(buttons.length, 'the run draws a button').toBeGreaterThan(0)
    // The shape Playwright writes the tree in, one node a line, so that the
    // sweep's own rule is what judges the names.
    const snapshot = [
      `- region ${JSON.stringify(region)}:`,
      ...buttons.map((name) => `  - button ${JSON.stringify(name)}`),
    ].join('\n')
    const reading = duplicatedNames(snapshot, [])
    expect(reading.unread, 'every line of the snapshot is read').toEqual([])
    expect(reading.pairs.map(describePair)).toEqual([])
  })

  it('and the rule would have found the old name, so this is not a test of nothing', () => {
    const old = ['- region "Export":', '  - button "Reveal"', '  - button "Export"'].join('\n')
    expect(duplicatedNames(old, []).pairs.map(describePair)).toEqual([
      'region "Export" contains button "Export"',
    ])
  })
})

// What an export that did not finish says beneath its line. Since engine
// v0.18.0 (its issue 79) the file and its sidecar are moved into place from
// `.part` files, the file first, and the engine documents one failure that
// leaves something: the sidecar's own move, after the file's, which leaves
// the new file beside the sidecar the folder had. So a failure while the
// encode ran no longer says "Nothing was written." outright, and a failure
// before it, or a cancel, still does.
describe('the export run, as it ends without a file', () => {
  /** The stages as the run leaves them when it fails at `stage`. */
  const failedAt = (stage: string): Stage[] =>
    stagesAt(freshStages(), stage).map((s) =>
      s.state === 'running' ? { ...s, state: 'failed' as const } : s,
    )
  /** The sentence under the line: the prose status, not the progress message. */
  const prose = (html: string): string | null =>
    /<p class="prose" role="status">([^<]*)<\/p>/.exec(html)?.[1] ?? null

  it('says a failure while it encoded may have left the file without its sidecar', () => {
    // Mutation: the encode's own branch dropped from `unfinishedSentence` -
    // the failure then says "Nothing was written." over a folder that may
    // hold the new file.
    const said = prose(draw('failed', failedAt('encode')))
    expect(said).toBe(ENCODE_UNFINISHED)
    expect(said).toBe(
      'Export again to write the file and its sidecar together. Nothing was written, unless the file reached its folder before its sidecar could.',
    )
  })

  it('says nothing was written for a failure before the encode, and for a cancel', () => {
    expect(prose(draw('failed', failedAt('plan')))).toBe('Nothing was written.')
    expect(prose(draw('failed', failedAt('capture')))).toBe('Nothing was written.')
    expect(prose(draw('cancelled', stagesAt(freshStages(), 'encode')))).toBe(
      'The export was cancelled. Nothing was written.',
    )
  })

  it('says the engine stopped when it stopped while writing, whatever stage it was at', () => {
    expect(prose(draw('failed', failedAt('encode'), true))).toBe(
      'The engine stopped while writing the file. Export again to replace whatever it left.',
    )
  })

  it('says nothing was written for a request the engine refused, though the encode was running', () => {
    // The engine judges `export.encode`'s parameters before its job starts
    // (engine v0.18.0: the source, a destination that is the source, the
    // provenance), so its params error means nothing was written, and an
    // "export again" would only be refused again. Mutation: the `refused`
    // branch dropped from `unfinishedSentence`.
    expect(prose(draw('failed', failedAt('encode'), false, true))).toBe('Nothing was written.')
  })
})

// The end of an export, for a screen reader and for the eye (issue 542).
//
// A reel reports every frame, so the line the eye follows changes hundreds of
// times in a few minutes. A live region that follows it is a running
// commentary, which DESIGN.md section 12 ("nothing else speaks unprompted")
// and WCAG 4.1.3 do not mean by a status message. So the visible line is not
// live, and a hidden polite status beside it changes at a stage and at each
// tenth of the frames. These drive a real run, through a stub bridge, and
// read both lines out of what the component draws after each report.

/** A run that has started on a stub bridge, with a way to report and to end it. */
function started() {
  const listeners = new Set<(p: ExportProgress) => void>()
  let finish!: (v: ExportResult) => void
  const bridge: ExportBridge = {
    run: () => ({
      id: 'tok-1',
      result: new Promise<ExportResult>((resolve) => {
        finish = resolve
      }),
    }),
    cancel: async () => undefined,
    reveal: async () => undefined,
    onProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const run = new Run(bridge)
  run.start(
    { id: 'abcdefghijk1', layout: 'a'.repeat(64) } as never,
    { state: 'ready', version: '0.3.0', protocol: 1 },
    { preset: 'instagram-reel', options: {} },
  )
  /** A report as the main process sends it: a count of frames carries `done` and `of`. */
  const report = (
    stage: ExportProgress['stage'],
    message: string,
    fraction = 0,
    count: { done: number; of: number } | Record<string, never> = {},
  ): void =>
    listeners.forEach((listener) => listener({ id: 'tok-1', stage, fraction, message, ...count }))
  const drawn = (): string =>
    renderToStaticMarkup(
      <ExportRun
        run={run}
        project={{} as never}
        engine={null}
        choice={{ preset: 'instagram-reel', options: {} }}
      />,
    )
  return { run, report, drawn, finish: (v: ExportResult) => finish(v) }
}

/** The sentence the eye follows: not a live region. */
const lineOf = (html: string): string | null =>
  /<p class="progress-message" aria-live="off">([^<]*)<\/p>/.exec(html)?.[1] ?? null

/**
 * The sentence a screen reader is told of the progress: the polite status that
 * is out of sight. Found by its role and read whatever else the tag carries, so
 * a class added or the attributes reordered do not turn every reading into
 * null; a status that is gone does, and the tests below require a reading.
 */
const spokenOf = (html: string): string | null =>
  /<p\b[^>]*\brole="status"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null

describe('the export run, for a screen reader while it captures', () => {
  const FRAMES = 108

  /** Drive a capture of 108 frames and read both lines after the start of it and after each frame. */
  function capture() {
    const { report, drawn } = started()
    report('plan', 'Planning the export.')
    report('capture', `Capturing ${FRAMES} frames.`)
    const before = drawn()
    const lines: (string | null)[] = []
    const spoken: (string | null)[] = []
    for (let done = 1; done <= FRAMES; done++) {
      report('capture', `Captured ${done} of ${FRAMES} frames.`, done / FRAMES, {
        done,
        of: FRAMES,
      })
      const html = drawn()
      lines.push(lineOf(html))
      spoken.push(spokenOf(html))
    }
    return { before, lines, spoken, report, drawn }
  }

  /** How many times a sequence, started from `first`, said something other than the last thing. */
  const changes = (first: string | null, sequence: (string | null)[]): number =>
    sequence.reduce<[number, string | null]>(
      ([n, last], now) => [now === last ? n : n + 1, now],
      [0, first],
    )[0]

  it('shows every frame, in a line that is not a live region', () => {
    // Mutation: the visible line given `role="status"` and `aria-live="polite"`
    // again - the pattern then finds no such line, and every entry is null.
    const { before, lines } = capture()
    expect(lines).toEqual(
      Array.from({ length: FRAMES }, (_, i) => `Captured ${i + 1} of ${FRAMES} frames.`),
    )
    expect(changes(lineOf(before), lines)).toBe(FRAMES)
  })

  it('tells a screen reader no more than the stages plus ten times over those frames', () => {
    // Mutation: `announcement` returning the message as it was sent - the
    // hidden status then changes with every frame, 108 times.
    // Mutation: the hidden status removed - every reading is null, no change
    // is counted, and the ceiling below would hold with nothing announced at
    // all, so the readings are required first.
    const { before, spoken } = capture()
    expect(spokenOf(before), 'a status before the first frame').not.toBeNull()
    expect(
      spoken.every((s) => s !== null),
      'a status after every frame',
    ).toBe(true)
    const stages = freshStages().length
    expect(changes(spokenOf(before), spoken)).toBeLessThanOrEqual(stages + 10)
  })

  it('says a tenth of the frames at a time, and nothing before the first tenth', () => {
    const { before, spoken } = capture()
    const said = spoken.filter((now, i) => now !== (i === 0 ? spokenOf(before) : spoken[i - 1]))
    expect(said).toEqual(
      Array.from({ length: 10 }, (_, i) => `Captured ${(i + 1) * 10} percent of the frames.`),
    )
    // Until the tenth is reached the stage's own sentence stands.
    expect(spoken[0]).toBe(`Capturing ${FRAMES} frames.`)
    expect(spoken[FRAMES - 1]).toBe('Captured 100 percent of the frames.')
  })

  it('says a stage when it starts, in words, and the encode in tenths too', () => {
    const { report, drawn } = capture()
    report('encode', `Encoding ${FRAMES} frames.`)
    expect(spokenOf(drawn())).toBe(`Encoding ${FRAMES} frames.`)
    report('encode', `Encoded 5 of ${FRAMES} frames.`, 5 / FRAMES, { done: 5, of: FRAMES })
    expect(spokenOf(drawn())).toBe(`Encoding ${FRAMES} frames.`)
    report('encode', `Encoded 54 of ${FRAMES} frames.`, 54 / FRAMES, { done: 54, of: FRAMES })
    expect(spokenOf(drawn())).toBe('Encoded 50 percent of the frames.')
    expect(lineOf(drawn())).toBe(`Encoded 54 of ${FRAMES} frames.`)
  })

  it('speaks a report with no count as it was sent, whatever its words', () => {
    // Issue 433, part b: the count is the report's `done` and `of`, never
    // its words. The unproven line reads like a count and carries none.
    const { report, drawn } = capture()
    const unproven = `Captured ${FRAMES} of ${FRAMES} frames. ${UNPROVEN_FRAMES}`
    report('capture', unproven, 1)
    expect(spokenOf(drawn())).toBe(unproven)
    report('encode', `Encoded 54 of ${FRAMES} frames.`, 54 / FRAMES)
    expect(spokenOf(drawn()), 'words alone are no count').toBe(`Encoded 54 of ${FRAMES} frames.`)
  })

  it('has one live region for progress, and it is the hidden one', () => {
    const html = capture().drawn()
    const polite = [...html.matchAll(/<p [^>]*role="status"[^>]*>/g)].map((m) => m[0])
    expect(polite).toEqual(['<p class="visually-hidden" role="status" aria-live="polite">'])
    expect(html).not.toMatch(/<p class="progress-message"[^>]*role=/)
  })

  it('draws a refused start’s sentence in the line and in the hidden status alike', () => {
    // A refused start is a failure with a sentence of its own.
    const refused = new Run({
      run: () => ({ id: 'x', result: new Promise<ExportResult>(() => undefined) }),
      cancel: async () => undefined,
      reveal: async () => undefined,
      onProgress: () => () => undefined,
    })
    refused.start(
      { id: 'p', layout: null } as never,
      { state: 'ready', version: '0', protocol: 1 },
      {
        preset: 'instagram-reel',
        options: {},
      },
    )
    const html = renderToStaticMarkup(
      <ExportRun
        run={refused}
        project={{} as never}
        engine={null}
        choice={{ preset: 'instagram-reel', options: {} }}
      />,
    )
    expect(spokenOf(html)).toBe('Lay the project out before exporting it.')
    expect(lineOf(html)).toBe('Lay the project out before exporting it.')
  })
})

// The finish, heard once (issue 570). Before it, cell 06 drew "Exported
// <file>." in a `role="status"` paragraph inserted with its text already in
// it, which a screen reader may not announce, beside the hidden status that
// is mounted from the start, and the window's job-end line said "<project>:
// Export as <preset>, finished." without the file. Now the job-end line,
// which is heard on every screen, is the one live region that changes at
// the finish, and it names the file; cell 06 shows the sentence and does
// not speak it.
//
// The export is driven to its end through a stub bridge, tracked by a job
// registry as the app's runs are, and the end sentence the registry hands
// out is what `App.tsx` writes into its `data-announces="jobs"` line. The
// live regions are read out of what cell 06 draws before the result and
// after it: an element with a live role or `aria-live` other than "off".
// The project's header line ("The map is drawn from every cell.") is the
// notebook's state, not the export's, and is not drawn here.
describe('the export run, as its finish is heard', () => {
  const FILE = 'la-metro-rail-instagram-reel.mp4'
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  /** Every live region cell 06 draws, by its opening tag and its place among the same tags, with its text. */
  function liveRegions(html: string): Map<string, string> {
    const regions = new Map<string, string>()
    const seen = new Map<string, number>()
    for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
      const [open, tag, attributes] = match
      const live =
        /\brole="(status|alert|log)"/.test(attributes) ||
        /\baria-live="(polite|assertive)"/.test(attributes)
      if (!live || /\baria-live="off"/.test(attributes)) continue
      const start = (match.index ?? 0) + open.length
      const text = html.slice(start, html.indexOf(`</${tag}>`, start))
      // A region holding markup would be read here as its tags; none does.
      expect(text, `${open} holds text alone`).not.toMatch(/</)
      const n = seen.get(open) ?? 0
      seen.set(open, n + 1)
      regions.set(`${open}#${n}`, text)
    }
    return regions
  }

  /** Drive an export to its end, and read the live regions before and after it. */
  async function finished(flags: Partial<ExportResult>) {
    const { run, report, drawn, finish } = started()
    const registry = new JobRegistry()
    registry.setNames([['abcdefghijk1', 'Los Angeles']])
    registry.track(run)
    const ends: string[] = []
    registry.onEnded((job) => ends.push(endSentence(job)))
    report('plan', 'Planning the export.')
    report('capture', 'Capturing 60 frames.')
    report('capture', 'Captured 60 of 60 frames.', 1, { done: 60, of: 60 })
    report('encode', 'Encoding 60 frames.')
    report('encode', 'Encoded 60 of 60 frames.', 1, { done: 60, of: 60 })
    const before = drawn()
    finish({ file: FILE, bytes: 10, frames: 60, ...flags })
    await tick()
    const after = drawn()
    // The window's job-end line, as `App.tsx` holds it: empty until a job
    // ends, then the end sentence.
    const regions = (html: string, jobs: string): Map<string, string> =>
      new Map([...liveRegions(html), ['jobs', jobs]])
    return {
      before: regions(before, ''),
      after: regions(after, ends.join(' ')),
      ends,
      shown: /<p class="prose">([^<]*)<\/p>/.exec(after)?.[1] ?? null,
    }
  }

  /** The regions whose text the finish changed, a region drawn only after it among them. */
  const changed = (before: Map<string, string>, after: Map<string, string>): [string, string][] =>
    [...after].filter(([key, text]) => text !== (before.get(key) ?? ''))

  it.each<[string, Partial<ExportResult>, string]>([
    ['an ordinary finish', {}, ''],
    ['a finish the cancel came too late for', { late: true }, ` ${EXPORT_KEPT}`],
    ['a finish whose frames were not proven fresh', { unproven: true }, ` ${UNPROVEN_FRAMES}`],
    ['both', { late: true, unproven: true }, ` ${EXPORT_KEPT} ${UNPROVEN_FRAMES}`],
  ])('%s: one live region changes, and it names the file', async (_what, flags, beside) => {
    // Mutations, each red here: `role="status"` put back on cell 06's
    // "Exported" line (two regions change); `endSentence` not naming the
    // file, or the job not carrying it (the one region says no file); and
    // the finish's sentences written to the hidden status again (two
    // regions change, for every case but the first).
    const { before, after, ends, shown } = await finished(flags)
    expect(ends, 'the job ends once').toHaveLength(1)
    expect(changed(before, after)).toEqual([
      ['jobs', `Los Angeles: Export as instagram-reel, finished: ${FILE}.${beside}`],
    ])
    // The cell still shows the sentence, where it was, and no live region of
    // its own carries the file's name.
    expect(shown).toBe(`Exported ${FILE}.`)
    const cells = [...after].filter(([key]) => key !== 'jobs')
    expect(cells.length, 'cell 06 draws its hidden status').toBeGreaterThan(0)
    expect(cells.filter(([, text]) => text.includes(FILE))).toEqual([])
  })
})

describe('the export run, with one call to action', () => {
  /** The variant of each button in the markup, by its text. */
  const variants = (html: string): [string, string | null][] =>
    [...html.matchAll(/<fig-button\b([^>]*)>(.*?)<\/fig-button>/g)].map((match) => [
      match[2].replace(/<span class="icon"[\s\S]*?<\/span>/, ''),
      /\bvariant="([^"]*)"/.exec(match[1])?.[1] ?? null,
    ])

  it('holds no primary button once the export has finished, and Reveal is no weaker than Export', () => {
    // Mutation: Reveal's variant put back to "primary" - and, separately,
    // the Export beside it - each leaves a filled button in the finished state.
    const html = draw('done')
    expect(variants(html)).toEqual([
      ['Reveal', 'secondary'],
      ['Export', 'secondary'],
    ])
    expect(html).not.toContain('variant="primary"')
  })

  it.each(['idle', 'running', 'failed', 'cancelled'] as const)(
    '%s: Export, where it is offered, stays the primary button',
    (state) => {
      const found = variants(draw(state)).filter(([name]) => name === 'Export')
      expect(found.length === 0 ? 'none offered' : found).toEqual(
        state === 'running' ? 'none offered' : [['Export', 'primary']],
      )
    },
  )
})
