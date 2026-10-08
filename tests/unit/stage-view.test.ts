// The geographic pane's own arithmetic, and the stage cache. No React.

import { describe, expect, it } from 'vitest'
import {
  MAX_SCALE,
  MIN_SCALE,
  NUDGE,
  STAGES,
  STAGE_SANDBOX,
  STEP,
  fit,
  forgetAllStages,
  keyed,
  pan,
  stageFor,
  zoomAt,
} from '../../src/renderer/src/engine/stages'
import type { RenderStageParams, RenderStageResult } from '../../src/shared/protocol'

describe('the pane keeps the point under the pointer still when it zooms', () => {
  it('zooms about a point and clamps the scale', () => {
    const view = { x: 10, y: 20, scale: 1 }
    const at = { x: 110, y: 220 }
    const zoomed = zoomAt(view, 2, at)
    expect(zoomed.scale).toBe(2)
    // The drawing point that was under `at` stays under it.
    const before = { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale }
    const after = { x: (at.x - zoomed.x) / zoomed.scale, y: (at.y - zoomed.y) / zoomed.scale }
    expect(after).toEqual(before)
    expect(zoomAt(view, 100, at).scale).toBe(MAX_SCALE)
    expect(zoomAt(view, 0.001, at).scale).toBe(MIN_SCALE)
  })

  it('fits a drawing whole and centred, and copes with nothing', () => {
    const view = fit({ width: 1600, height: 960 }, { width: 800, height: 500 })
    expect(view.scale).toBe(0.5)
    expect(view.x).toBe(0)
    expect(view.y).toBe(10)
    expect(fit({ width: 0, height: 0 }, { width: 800, height: 500 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    })
  })

  it('takes plus, minus and the arrows, and nothing else', () => {
    const view = { x: 0, y: 0, scale: 1 }
    const pane = { width: 800, height: 500 }
    expect(keyed(view, '+', pane)?.scale).toBe(STEP)
    expect(keyed(view, '=', pane)?.scale).toBe(STEP)
    expect(keyed(view, '-', pane)?.scale).toBeCloseTo(1 / STEP)
    expect(keyed(view, 'ArrowLeft', pane)).toEqual(pan(view, NUDGE, 0))
    expect(keyed(view, 'ArrowDown', pane)).toEqual(pan(view, 0, -NUDGE))
    expect(keyed(view, 'a', pane)).toBeNull()
    expect(keyed(view, 'Enter', pane)).toBeNull()
  })
})

describe('the view', () => {
  it("names the two stages by the engine's names, and its frame takes no permission", () => {
    expect(STAGES.map((s) => s.stage)).toEqual(['gtfs2graph', 'loom'])
    expect(STAGE_SANDBOX).toBe('')
  })
})

describe('the stage cache', () => {
  it('asks once per layout, set, stage and width, and forgets a refusal', async () => {
    forgetAllStages()
    let asked = 0
    const client = {
      request: (_m: 'render.stage', params: { layout: string; stage: string; width?: number }) => {
        asked += 1
        return {
          result:
            params.layout === 'bad'
              ? Promise.reject(new Error('no'))
              : Promise.resolve({
                  layout: params.layout,
                  stage: params.stage,
                } as RenderStageResult),
        }
      },
    }
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600)
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600)
    expect(asked).toBe(1)
    await stageFor(client, 'la', 'l1', 'made-1', 'loom', 1600)
    await stageFor(client, 'la', 'l1', 'made-2', 'gtfs2graph', 1600)
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 800)
    expect(asked, 'another stage, another set, another width').toBe(4)
    await expect(stageFor(client, 'la', 'bad', null, 'loom', 1600)).rejects.toThrow('no')
    await new Promise((r) => setTimeout(r, 0))
    await expect(stageFor(client, 'la', 'bad', null, 'loom', 1600)).rejects.toThrow('no')
    expect(asked).toBe(6)
  })
})

describe('the stage cache and the service day (issue 105)', () => {
  const answer = { layout: 'l1', stage: 'gtfs2graph' } as RenderStageResult

  it('sends the day when there is one and leaves the field out when there is none', async () => {
    forgetAllStages()
    const sent: RenderStageParams[] = []
    const client = {
      request: (_m: 'render.stage', params: RenderStageParams) => {
        sent.push(params)
        return { result: Promise.resolve(answer) }
      },
    }
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600)
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600, null)
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600, '2026-06-16')
    expect(sent).toHaveLength(2)
    // The engine refuses a null: the field is absent, never null.
    expect('date' in sent[0], 'no day, no field').toBe(false)
    expect(sent[1].date).toBe('2026-06-16')
  })

  it('asks again for another day, since the minutes are of a day', async () => {
    forgetAllStages()
    let asked = 0
    const client = {
      request: () => {
        asked += 1
        return { result: Promise.resolve(answer) }
      },
    }
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600, '2026-06-16')
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600, '2026-06-16')
    expect(asked, 'the same day is asked once').toBe(1)
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600, '2026-06-17')
    await stageFor(client, 'la', 'l1', 'made-1', 'gtfs2graph', 1600)
    expect(asked, 'another day, and no day, are asked for in their own right').toBe(3)
  })
})
