// @vitest-environment jsdom
// Cell 06's preview, planned (ADR-046, spec 029 FR-004; issue 433, part
// b): `export.preview` is asked once the choice has settled, never while
// the cell is closed, a run rewrites the page, an export is under way, or
// the tables or the layout are missing; a refusal belongs to the choice it
// was for; and an answer that comes after the cell has closed reaches no
// frame. Driven through the hook in a component that does nothing else,
// with the clock faked, and the bridge's `export.preview` a stub whose
// answers the test gives.

import { act, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useExportPreview,
  type PreviewPlanning,
} from '../../src/renderer/src/export/useExportPreview'
import {
  offeredOf,
  PREVIEW_DELAY,
  type ExportTables,
  type PreviewAddress,
} from '../../src/renderer/src/exportChoice'
import type { ExportChoice, ExportPreview } from '../../src/shared/export'
import type { Preset } from '../../src/shared/protocol'
import { answered, BASE, cleanup, renderPanel } from '../support/render'

/**
 * While `on`, the planner's `cancel` does nothing, so an answer already on
 * its way is not dropped by the planner: the one row that sets it holds the
 * hook's own `active` check alone. Every other row has the real planner.
 */
const leaky = vi.hoisted(() => ({ on: false }))

vi.mock('../../src/renderer/src/exportChoice', async (original) => {
  const real = await original<typeof import('../../src/renderer/src/exportChoice')>()
  class PreviewPlanner extends real.PreviewPlanner {
    cancel(): void {
      if (!leaky.on) super.cancel()
    }
  }
  return { ...real, PreviewPlanner }
})

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
const TABLES: ExportTables = { presets: offeredOf([REEL_ROW]), storyboards: [] }

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }
const DRAFT: ExportChoice = { preset: 'instagram-reel', options: { quality: 'draft' } }
const HIGH: ExportChoice = { preset: 'instagram-reel', options: { quality: 'high' } }

type Given = Parameters<typeof useExportPreview>[0]

const ok = (
  url: string,
  notes: string[] = [],
  file = 'la-metro-rail-instagram-reel.mp4',
): ExportPreview => ({
  ok: true,
  url,
  width: 540,
  height: 960,
  notes,
  file,
})

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  leaky.on = false
})

/** The hook, drawn with `given` laid over an open cell of a laid-out project that can plan. */
function draw(given: Partial<Given> = {}) {
  const asked: { choice: ExportChoice; resolve: (preview: ExportPreview) => void }[] = []
  const preview = vi.fn(
    (_id: string, choice: ExportChoice) =>
      new Promise<ExportPreview>((resolve) => asked.push({ choice, resolve })),
  )
  const onPreview = vi.fn<(address: PreviewAddress) => void>()
  let state!: PreviewPlanning
  function Harness(props: Given): JSX.Element | null {
    state = useExportPreview(props)
    return null
  }
  let props: Given = {
    project: { ...BASE, readOnly: false },
    asked: REEL,
    active: true,
    ready: true,
    tables: TABLES,
    layingOut: false,
    exporting: false,
    onPreview,
    ...given,
  }
  const view = renderPanel(<Harness {...props} />, { api: { export: { preview } } })
  return {
    asked,
    preview,
    onPreview,
    get state() {
      return state
    },
    /** Drawn again with these props changed. */
    redraw(patch: Partial<Given>) {
      props = { ...props, ...patch }
      view.rerender(<Harness {...props} />)
    },
  }
}

const settle = async (): Promise<void> => {
  await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY))
}

describe('cell 06’s preview, planned', () => {
  it('asks once the choice has settled, and once for two quick changes', async () => {
    const drawn = draw()
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY - 1))
    expect(drawn.preview, 'not before the delay').not.toHaveBeenCalled()
    drawn.redraw({ asked: DRAFT })
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY / 2))
    drawn.redraw({ asked: HIGH })
    await settle()
    expect(drawn.preview.mock.calls).toEqual([[BASE.id, HIGH]])
  })

  it('plans again for the layout laid out again under the same id', async () => {
    // Issue 433, part c: the choice is read through an effect event, so the
    // effect's dependencies are what the comment names and nothing checks
    // them but this and the row above. Mutation
    // (`export-preview-planning.mutations.json`): `made` dropped from them -
    // the layout laid out again is never planned.
    const project = { ...BASE, readOnly: false }
    const drawn = draw({ project })
    await settle()
    drawn.asked[0].resolve(ok('app://local/p?first'))
    await answered()
    drawn.redraw({ project: { ...project, made: '2026-10-27T09:00:00+00:00' } })
    await settle()
    expect(drawn.preview.mock.calls).toEqual([
      [BASE.id, REEL],
      [BASE.id, REEL],
    ])
  })

  it('hands the address to the frame at the preset’s own size, with its safe zones', async () => {
    const drawn = draw()
    await settle()
    drawn.asked[0].resolve(ok('app://local/p?x', ['A note.']))
    await answered()
    expect(drawn.onPreview.mock.calls).toEqual([
      [{ url: 'app://local/p?x', width: 1080, height: 1920, safe: true }],
    ])
    expect(drawn.state.notes).toEqual(['A note.'])
  })

  it('keeps the file the plan named for the choice it was for, and for no other (issue 563)', async () => {
    // Cell 06 says beside Export which file an export would replace, from
    // this file. A choice changed a moment ago has not been planned, and a
    // tag typed into it names another file, so the old name must not be
    // said for it. Mutation (`export-preview-planning.mutations.json`): the
    // file handed on whatever choice it was planned for - the changed
    // choice still has the old name.
    const drawn = draw()
    expect(drawn.state.file, 'nothing planned yet').toBeNull()
    await settle()
    drawn.asked[0].resolve(ok('app://local/p?x'))
    await answered()
    expect(drawn.state.file).toBe('la-metro-rail-instagram-reel.mp4')
    drawn.redraw({ asked: DRAFT })
    expect(drawn.state.file, 'a choice not yet planned').toBeNull()
    await settle()
    drawn.asked[1].resolve(ok('app://local/p?y', [], 'la-metro-rail-instagram-reel-draft.mp4'))
    await answered()
    expect(drawn.state.file).toBe('la-metro-rail-instagram-reel-draft.mp4')
    drawn.redraw({ asked: HIGH })
    await settle()
    drawn.asked[2].resolve({
      ok: false,
      error: { code: -32000, message: 'refused', data: { kind: 'export', detail: 'x', hint: 'y' } },
    })
    await answered()
    expect(drawn.state.file, 'a refusal names no file').toBeNull()
  })

  it.each<[string, Partial<Given>]>([
    ['the cell is closed', { active: false }],
    ['a run rewrites the page', { layingOut: true }],
    ['an export is under way', { exporting: true }],
    ['the tables are not read', { tables: null }],
    ['the engine is away', { ready: false }],
    ['there is no layout', { project: { ...BASE, layout: null, readOnly: false } }],
    ['the project is read-only', { project: { ...BASE, readOnly: true } }],
  ])('asks nothing while %s', async (_, given) => {
    // Mutation: `!layingOut` taken out of `canPlan` - the run's row asks.
    const drawn = draw(given)
    await settle()
    await settle()
    expect(drawn.preview).not.toHaveBeenCalled()
  })

  it('forgets a plan waiting for its delay when a run starts', async () => {
    const drawn = draw()
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY / 2))
    drawn.redraw({ layingOut: true })
    await settle()
    expect(drawn.preview).not.toHaveBeenCalled()
  })

  it('ties a refusal to the choice it was for, and lets it go when the choice changes', async () => {
    const drawn = draw()
    await settle()
    drawn.asked[0].resolve({
      ok: false,
      error: {
        code: -32602,
        message: 'm',
        data: { kind: 'params', detail: 'd', hint: 'Refused.' },
      },
    })
    await answered()
    expect(drawn.state.refused).toBe(true)
    expect(drawn.state.refusal?.sentence).toBe('Refused.')
    expect(drawn.onPreview, 'the last good address stays').not.toHaveBeenCalled()
    drawn.redraw({ asked: DRAFT })
    expect(drawn.state.refused, 'at once, before the next plan answers').toBe(false)
    drawn.redraw({ asked: REEL })
    expect(drawn.state.refused, 'and again for the choice it was for').toBe(true)
  })

  it('says a refusal in the sentence every run’s failure is said in, without a path', async () => {
    // Issue 433, part b, the audit's finding 3: `refusalWords` is
    // `runFailureSentence`. Mutation: it reads the hint as it came - the
    // path is then said.
    const drawn = draw()
    await settle()
    drawn.asked[0].resolve({
      ok: false,
      error: {
        code: -32000,
        message: 'm',
        data: {
          kind: 'io',
          detail: 'd',
          hint: 'The page at /srv/schematic/out/la.html was not read.',
        },
      },
    })
    await answered()
    expect(drawn.state.refusal?.sentence).toBe('The page at a file was not read.')
  })

  it('drops an answer that comes after the cell has closed', async () => {
    // Two guards hold this: the planner cancelled as `canPlan` goes false,
    // and the answer's own `active` check. Mutations: each taken out alone
    // leaves this passing; both taken out together fail it. The next row
    // holds the `active` check alone.
    const drawn = draw()
    await settle()
    expect(drawn.asked).toHaveLength(1)
    drawn.redraw({ active: false })
    drawn.asked[0].resolve(ok('app://local/late'))
    await answered()
    expect(drawn.onPreview).not.toHaveBeenCalled()
    expect(drawn.state.notes).toEqual([])
  })

  it('drops a late answer by the cell being closed, whatever the planner does', async () => {
    // The `active` check is for an answer that lands between the commit
    // that closes the cell and that commit's effects, where the planner's
    // cancel has not run yet; no test can place an answer there, so the
    // planner's cancel is made to do nothing instead. Mutation: `if
    // (!active) return` removed - the late address reaches the frame.
    leaky.on = true
    const drawn = draw()
    await settle()
    expect(drawn.asked).toHaveLength(1)
    drawn.redraw({ active: false })
    drawn.asked[0].resolve(ok('app://local/late', ['A late note.']))
    await answered()
    expect(drawn.onPreview).not.toHaveBeenCalled()
    expect(drawn.state.notes).toEqual([])
  })
})
