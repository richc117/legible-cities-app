// @vitest-environment jsdom
// Cell 06's composition (issue 433, part b): the sentences it says in
// place of the form - a read-only project, one not laid out, the engine
// away, the tables on their way, a saved choice that fell back - Export
// held while the engine refuses the choice, and the form locked, its focus
// handed to the cell's heading, as an export starts. The kit is real; the
// focus row focuses a native checkbox, which jsdom can see. The engine's
// tables are answered by a stand-in client in place of the bridge's.

import { act, createRef, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportTab from '../../src/renderer/src/ExportTab'
import { ExportRun } from '../../src/renderer/src/engine/exportRun'
import { forgetExportTables, PREVIEW_DELAY } from '../../src/renderer/src/exportChoice'
import { EngineError } from '../../src/shared/engine'
import type { ExportChoice, ExportPreview, ExportResult } from '../../src/shared/export'
import type { Preset, Storyboard } from '../../src/shared/protocol'
import type { ProjectRecord } from '../../src/shared/project/types'
import { answered, BASE, byName, cleanup, READY, renderPanel } from '../support/render'

/** The engine's two tables as a stand-in client answers them, or never. */
const engine = vi.hoisted(() => ({ answers: true as boolean | Error }))

const REEL_ROW: Preset = {
  name: 'instagram-reel',
  platform: 'Instagram',
  width: 1080,
  height: 1920,
  kind: 'video',
  format: 'mp4',
  view: 'map',
  labels: true,
  storyboard: 'tour',
  fps: 30,
  max_bytes: null,
  frame_top: 0.46,
  safe_zones: true,
  note: '',
}
const TOUR: Storyboard = { name: 'tour', views: 'map', seconds: 25, geographic: false, beats: [] }

vi.mock('../../src/renderer/src/engine/runs', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/engine/runs')>()),
  engineClient: () => ({
    request: (method: string) => ({
      result:
        engine.answers instanceof Error
          ? Promise.reject(engine.answers)
          : !engine.answers
            ? new Promise(() => undefined)
            : Promise.resolve(
                method === 'export.presets' ? { presets: [REEL_ROW] } : { storyboards: [TOUR] },
              ),
    }),
  }),
}))

afterEach(() => {
  cleanup()
  forgetExportTables()
  engine.answers = true
  vi.useRealTimers()
})

type Project = ProjectRecord & { readOnly: boolean }
const PROJECT: Project = { ...BASE, readOnly: false }

/** An export run on a bridge whose export never finishes. */
const exporter = (): ExportRun =>
  new ExportRun({
    run: () => ({ id: 'export-1', result: new Promise<ExportResult>(() => undefined) }),
    cancel: async () => undefined,
    reveal: async () => undefined,
    onProgress: () => () => undefined,
  })

/** Cell 06's panel under a heading of its own, as the cell draws it. */
async function draw(
  over: { project?: Project; engine?: typeof READY | null; preview?: ExportPreview } = {},
) {
  const run = exporter()
  const heading = createRef<HTMLHeadingElement>()
  const project = over.project ?? PROJECT
  const preview = vi.fn(
    async (): Promise<ExportPreview> =>
      over.preview ?? { ok: true, url: 'app://local/p', width: 540, height: 960, notes: [] },
  )
  function Cell({ engine = over.engine === undefined ? READY : over.engine }): JSX.Element {
    return (
      <section>
        <h3 ref={heading} tabIndex={-1}>
          06 Export
        </h3>
        <ExportTab
          project={project}
          engine={engine}
          run={run}
          layingOut={false}
          active
          inspect={async () => {
            throw new Error('not read here')
          }}
          onChoice={async () => undefined}
          onPreview={() => undefined}
          handback={heading}
        />
      </section>
    )
  }
  const chooseDestination = vi.fn(async () => ({ ...project, destination: '/srv/exports' }))
  const view = renderPanel(<Cell />, { api: { export: { preview, chooseDestination } } })
  await answered()
  const start = (choice: ExportChoice = project.export): void =>
    act(() => run.start(project, READY, choice))
  /** The engine as it is now, the panel drawn again. */
  const engineNow = async (engine: typeof READY | null): Promise<void> => {
    view.rerender(<Cell engine={engine} />)
    await answered()
  }
  return { view, run, heading, start, preview, engineNow }
}

const text = (): string => (document.querySelector('.export-tab')?.textContent ?? '').trim()

describe('cell 06’s composition', () => {
  it('says why a read-only project shows nothing to choose', async () => {
    await draw({ project: { ...PROJECT, readOnly: true } })
    expect(text()).toBe(
      'This project was made by a newer version of the app, so its export cannot be changed or made here.',
    )
    expect(document.querySelector('.export-tab > p')?.className).toBe('prose')
    expect(document.querySelector('form')).toBeNull()
  })

  it('says a project not laid out has no map to export', async () => {
    await draw({ project: { ...PROJECT, layout: null } })
    expect(text()).toBe(
      'There is no map to export yet. Lay the project out first, and its export is previewed here.',
    )
    expect(document.querySelector('form')).toBeNull()
  })

  it('says the engine is away, and offers nothing to export', async () => {
    await draw({ engine: null })
    const status = document.querySelector('.export-tab > [role="status"]')
    expect(status?.textContent).toBe(
      'The engine is not running, so nothing can be planned or exported until it is.',
    )
    expect(document.querySelector('form')).toBeNull()
    expect(() => byName('button', 'Export')).toThrow('no button named "Export"')
  })

  it('says the presets are being asked for while the engine has not answered', async () => {
    engine.answers = false
    await draw()
    const status = document.querySelector('.export-tab > [role="status"]')
    expect(status?.className).toBe('hint')
    expect(status?.textContent).toBe('Asking the engine for its presets.')
    expect(document.querySelector('form')).toBeNull()
  })

  it('says the engine’s refusal of its presets, without a path', async () => {
    // Issue 433, part b, the audit's finding 3: the sentence is
    // `runFailureSentence`'s. Mutation: the hint read as it came - the path
    // is then said.
    engine.answers = new EngineError(-32000, 'm', {
      kind: 'io',
      detail: 'd',
      hint: 'The table at /srv/schematic/presets.json could not be read.',
    })
    await draw()
    const alert = document.querySelector('.export-tab > [role="alert"]')
    expect(alert?.className).toBe('message error')
    expect(alert?.textContent).toBe('The table at a file could not be read.')
    expect(document.querySelector('form')).toBeNull()
  })

  it('says which saved name the engine no longer offers', async () => {
    await draw({
      project: {
        ...PROJECT,
        export: { preset: 'instagram-reel', storyboard: 'gone' as never, options: {} },
      },
    })
    const notice = document.querySelector('.export-tab > .notice')
    expect(notice?.getAttribute('role')).toBe('status')
    expect(notice?.textContent).toBe(
      'The export this project was set to, gone, is no longer offered by the engine. This is the Instagram reel with the engine’s defaults until another is chosen.',
    )
  })

  it('draws the form, the destination inside it, and the run after it', async () => {
    await draw()
    const tab = document.querySelector('.export-tab')
    const form = tab?.querySelector(':scope > form.export-choices')
    expect(form?.querySelector('.field.export-destination')).not.toBeNull()
    // An idle run is its Export button alone; the region comes with a start.
    expect(form?.nextElementSibling?.className).toBe('focus-region')
    expect(byName('button', 'Export')).toBeTruthy()
    expect(byName('button', 'Choose folder')).toBeTruthy()
  })

  it('shows the folder a press answered after the engine has gone and come back', async () => {
    // The form is not drawn while the engine is away, and the record the
    // panel was given is not read again for a folder. Mutation: the folder
    // held by the field itself rather than above the form - it is then made
    // afresh from that record, and says the app's own folder again.
    const { engineNow } = await draw()
    act(() => byName('button', 'Choose folder').click())
    await answered()
    const where = (): string | null | undefined =>
      document.getElementById('export-destination-where')?.textContent
    expect(where()).toBe('/srv/exports')
    await engineNow(null)
    expect(document.querySelector('form'), 'no form while the engine is away').toBeNull()
    await engineNow(READY)
    expect(where()).toBe('/srv/exports')
  })

  it('holds Export while the engine refuses the choice, and says why under the choosers', async () => {
    vi.useFakeTimers()
    const { preview } = await draw({
      preview: {
        ok: false,
        error: {
          code: -32602,
          message: 'm',
          data: { kind: 'params', detail: 'd', hint: 'This feed has no geography.' },
        },
      },
    })
    const exportButton = (): HTMLButtonElement => byName('button', 'Export') as HTMLButtonElement
    expect(exportButton().disabled, 'before the plan answers').toBe(false)
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY))
    await answered()
    expect(preview).toHaveBeenCalledTimes(1)
    const alert = document.querySelector('form.export-choices [role="alert"]')
    expect(alert?.textContent).toBe('This feed has no geography.')
    expect(exportButton().disabled).toBe(true)
  })

  it('locks the choices as an export starts, and hands their focus to the heading', async () => {
    // Mutation: `locked` not passed to the form (its own `project.readOnly`
    // in its place) - the controls stay enabled while the export goes.
    const { start, heading } = await draw()
    const names = byName('checkbox', 'Station names') as HTMLInputElement
    act(() => names.focus())
    expect(document.activeElement).toBe(names)
    start()
    expect(document.activeElement, 'focus is on the cell’s heading').toBe(heading.current)
    for (const fieldset of document.querySelectorAll('form.export-choices fieldset'))
      expect((fieldset as HTMLFieldSetElement).disabled, fieldset.className).toBe(true)
    expect(byName('combobox', 'Preset').closest('fig-dropdown')?.hasAttribute('disabled')).toBe(
      true,
    )
    expect(
      (byName('textbox', 'Alt text for the file’s sidecar') as HTMLTextAreaElement).disabled,
    ).toBe(true)
    expect(document.querySelector('.export-tab')?.getAttribute('aria-busy')).toBe('true')
    expect(
      document
        .querySelector('.export-tab > .focus-region > section.export-run')
        ?.getAttribute('aria-label'),
    ).toBe('Export run')
    expect(text()).toContain(
      'The choices wait until the export that is going has finished: it was planned from them.',
    )
  })
})
