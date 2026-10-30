// @vitest-environment jsdom
// What a second export would replace, said beside Export (issue 563).
//
// The export's file names are deterministic on purpose, so exporting one
// choice twice writes the same name twice and the second takes the first's
// place. Cell 06 says so where the press is: while a file the folder still
// holds has the name the next export will write, one line says which file,
// when it was made, and that a filename tag keeps both. It is the Export
// button's description and not a live region, so it is read when a person
// reaches the button and never unprompted.
//
// The real `ExportRun` is drawn with the kit; the folder's outputs and the
// planned file are the props the export tab hands it, from the screen's one
// read of the folder and from the preview's plan. `useOutputs`, which makes
// that read, is held to the times it reads at below.

import { afterEach, describe, expect, it } from 'vitest'
import ExportRunPanel from '../../src/renderer/src/ExportRun'
import { ExportRun } from '../../src/renderer/src/engine/exportRun'
import type { ExportOutput, ExportResult } from '../../src/shared/export'
import { KEEP_BOTH, replacedBy, replacesWords } from '../../src/renderer/src/notebook/outputWords'
import { momentWords } from '../../src/renderer/src/dates'
import { answered, BASE, cleanup, READY, renderPanel } from '../support/render'
import { useOutputs } from '../../src/renderer/src/notebook/useOutputs'
import type { RunState } from '../../src/shared/layout'
import type { JSX } from 'react'

afterEach(cleanup)

const FILE = 'la-metro-rail-instagram-reel.mp4'
const MADE = '2026-09-30T02:16:00.000Z'

const row = (over: Partial<ExportOutput> = {}): ExportOutput => ({
  file: FILE,
  preset: 'instagram-reel',
  made: MADE,
  present: true,
  ...over,
})

/** An export run that starts nothing: only the folder and the plan matter here. */
const idle = (): ExportRun =>
  new ExportRun({
    run: () => ({ id: 'export-1', result: new Promise<ExportResult>(() => undefined) }),
    cancel: async () => undefined,
    reveal: async () => undefined,
    onProgress: () => () => undefined,
  })

/** Cell 06's run drawn over a folder holding `rows`, planned to write `planned`. */
async function draw(rows: ExportOutput[] | null, planned: string | null) {
  const view = renderPanel(
    <ExportRunPanel
      run={idle()}
      project={BASE}
      engine={READY}
      choice={{ preset: 'instagram-reel', options: {} }}
      planned={planned}
      outputs={rows}
    />,
  )
  await answered()
  const line = view.host.querySelector('#export-replaces')
  const exportButton = view.host.querySelector('fig-button')
  return { view, line, inner: exportButton?.shadowRoot?.querySelector('button') ?? null }
}

describe('the line beside Export that says what a second export replaces', () => {
  it('says which file, when it was made, and that a filename tag keeps both', async () => {
    const { line, inner } = await draw([row()], FILE)
    const said = `Exporting replaces ${FILE}, made ${momentWords(MADE)}. A filename tag keeps both.`
    expect(line?.textContent).toBe(said)
    expect(replacesWords(row())).toBe(said)
    // The moment keeps its exact value on its element, as every moment does.
    expect(line?.querySelector('time')?.getAttribute('datetime')).toBe(MADE)
    // Export's description, where the kit mirrors it (docs/accessibility.md, F5).
    expect(inner?.getAttribute('aria-description')).toBe(said)
  })

  it('is shown, not spoken: no live region', async () => {
    const { line } = await draw([row()], FILE)
    expect(line).not.toBeNull()
    expect(line?.getAttribute('role')).toBeNull()
    expect(line?.getAttribute('aria-live')).toBeNull()
  })

  it('shows if and only if a present output has the planned name', async () => {
    // Mutation: the `row.present &&` guard dropped from `replacedBy` - the
    // gone row below then says a file it no longer holds would be replaced.
    const shown = async (rows: ExportOutput[] | null, planned: string | null): Promise<boolean> => {
      const { view, line, inner } = await draw(rows, planned)
      const shows = line !== null
      expect(inner?.getAttribute('aria-description') !== null, 'the description follows').toBe(
        shows,
      )
      view.unmount()
      return shows
    }
    expect(await shown([row()], FILE), 'a present row of that name').toBe(true)
    expect(await shown([row({ present: false })], FILE), 'a gone row').toBe(false)
    expect(await shown([row({ file: 'another-name.mp4' })], FILE), 'another name').toBe(false)
    expect(await shown([row({ present: false }), row({ file: 'a.mp4' })], FILE)).toBe(false)
    expect(await shown([], FILE), 'an empty folder').toBe(false)
    expect(await shown(null, FILE), 'a folder not yet read').toBe(false)
    expect(await shown([row()], null), 'no plan for this choice').toBe(false)
  })

  it('finds a name without regard to case', () => {
    // Mutation: the comparison made exact - a folder that is one file for
    // the platform's filesystem and two for ours then says nothing.
    const rows = [row({ file: FILE.toUpperCase() })]
    expect(replacedBy(rows, FILE)?.file).toBe(FILE.toUpperCase())
    expect(replacedBy([row()], FILE.toUpperCase())?.file).toBe(FILE)
  })

  it('finds the output by its name among several', () => {
    const rows = [row({ file: 'a.mp4' }), row({ made: '2026-10-01T00:00:00.000Z' })]
    expect(replacedBy(rows, FILE)?.made).toBe('2026-10-01T00:00:00.000Z')
    expect(replacedBy(null, FILE), 'before the folder is read').toBeUndefined()
    expect(KEEP_BOTH).toBe('A filename tag keeps both.')
  })
})

// Where the screen's one read of the folder is made, and when it is made
// again: when the export run changes state, and when the project is renamed,
// since the folder is named for it. (The destination is cell 06's own, and
// `export-tab.test.tsx` holds the read it asks for.)
describe('the screen’s read of the folder', () => {
  function Reader({ state, name }: { state: RunState; name: string }): JSX.Element {
    const { rows } = useOutputs(BASE.id, state, name)
    return <p id="rows">{rows === null ? 'unread' : rows.map((r) => r.file).join(',')}</p>
  }

  it('reads when the project opens, when a run changes state, and when the project is renamed', async () => {
    // Mutation: `folderKey` taken out of the effect's dependencies - a
    // renamed project is then read from the folder it no longer exports to.
    let calls = 0
    const view = renderPanel(<Reader state="idle" name="Los Angeles" />, {
      api: {
        export: {
          outputs: async () => {
            calls += 1
            return [row()]
          },
        },
      },
    })
    await answered()
    expect(calls, 'once when it opens').toBe(1)
    expect(view.host.querySelector('#rows')?.textContent).toBe(FILE)
    view.rerender(<Reader state="running" name="Los Angeles" />)
    await answered()
    expect(calls, 'again when a run changes state').toBe(2)
    view.rerender(<Reader state="running" name="Los Angeles" />)
    await answered()
    expect(calls, 'not for a draw that changed nothing').toBe(2)
    view.rerender(<Reader state="running" name="Los Angeles 2" />)
    await answered()
    expect(calls, 'again when the project is renamed').toBe(3)
  })

  it('keeps the answer of the latest read when an older one arrives last', async () => {
    // Reads overlap: a run ends as a folder is chosen. Mutation: the
    // `latest` guard dropped from `useOutputs` - the older answer, arriving
    // last, puts the rows of the folder as it was.
    const answers: ((rows: ExportOutput[]) => void)[] = []
    const view = renderPanel(<Reader state="idle" name="Los Angeles" />, {
      api: {
        export: {
          outputs: () => new Promise<ExportOutput[]>((resolve) => answers.push(resolve)),
        },
      },
    })
    view.rerender(<Reader state="running" name="Los Angeles" />)
    await answered()
    expect(answers, 'two reads are out').toHaveLength(2)
    answers[1]([row({ file: 'new.mp4' })])
    await answered()
    answers[0]([row({ file: 'old.mp4' })])
    await answered()
    expect(view.host.querySelector('#rows')?.textContent).toBe('new.mp4')
  })
})
