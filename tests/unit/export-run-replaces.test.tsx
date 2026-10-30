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
// The real `ExportRun` is drawn with the kit, on a stub bridge whose
// `export.outputs` answers the folder as the test says; the planned file is
// the prop the export tab hands it from the preview's plan.

import { afterEach, describe, expect, it } from 'vitest'
import ExportRunPanel from '../../src/renderer/src/ExportRun'
import { ExportRun } from '../../src/renderer/src/engine/exportRun'
import type { ExportOutput, ExportResult } from '../../src/shared/export'
import { KEEP_BOTH, replacedBy, replacesWords } from '../../src/renderer/src/notebook/outputWords'
import { momentWords } from '../../src/renderer/src/dates'
import { answered, BASE, cleanup, READY, renderPanel } from '../support/render'

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
async function draw(rows: ExportOutput[], planned: string | null) {
  const view = renderPanel(
    <ExportRunPanel
      run={idle()}
      project={BASE}
      engine={READY}
      choice={{ preset: 'instagram-reel', options: {} }}
      planned={planned}
    />,
    { api: { export: { outputs: async () => rows } } },
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
    const shown = async (rows: ExportOutput[], planned: string | null): Promise<boolean> => {
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
    expect(await shown([row()], null), 'no plan for this choice').toBe(false)
  })

  it('finds the output by its name among several', () => {
    const rows = [row({ file: 'a.mp4' }), row({ made: '2026-10-01T00:00:00.000Z' })]
    expect(replacedBy(rows, FILE)?.made).toBe('2026-10-01T00:00:00.000Z')
    expect(replacedBy(null, FILE), 'before the folder is read').toBeUndefined()
    expect(KEEP_BOTH).toBe('A filename tag keeps both.')
  })
})
