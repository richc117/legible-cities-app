// The export tab's logic without React (A5-01, specs/022-export-tab): what
// is offered and how it reads, what an option defaults to and what a change
// does to the choice, and the preview's planning - once when the changes
// stop, and never with an answer older than the newest question.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  byPlatform,
  defaultsFor,
  exportTablesFor,
  forgetExportTables,
  offeredOf,
  plays,
  presetWords,
  PREVIEW_DELAY,
  PreviewPlanner,
  refusalWords,
  sameChoice,
  storyboardWords,
  toggledLines,
  usable,
  withOption,
  withPreset,
  withStoryboard,
  type ExportTables,
  type TablesClient,
} from '../../src/renderer/src/exportChoice'
import type { ExportChoice, ExportPreview } from '../../src/shared/export'
import type { Preset, Storyboard } from '../../src/shared/protocol'

const preset = (over: Partial<Preset> & Pick<Preset, 'name'>): Preset => ({
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
  safe_zones: false,
  note: '',
  ...over,
})

const PRESETS: Preset[] = [
  preset({ name: 'instagram-post', kind: 'still', format: 'png', storyboard: null, height: 1350 }),
  preset({
    name: 'linkedin',
    platform: 'LinkedIn',
    kind: 'still',
    format: 'png',
    storyboard: null,
  }),
  preset({ name: 'instagram-reel', safe_zones: true }),
  preset({ name: 'linkedin-gif', platform: 'LinkedIn', format: 'gif', storyboard: 'morph' }),
  preset({ name: 'portfolio-mp4', platform: 'Portfolio' }),
]

const board = (name: string, views: string, seconds: number): Storyboard => ({
  name,
  views,
  seconds,
  geographic: views.includes('geographic'),
  beats: [],
})

const TABLES: ExportTables = {
  presets: offeredOf(PRESETS),
  storyboards: [
    board('tour', 'map -> linear -> time', 25),
    board('morph', 'map -> linear -> time', 9),
    board('run', 'map', 20),
    board('transform', 'geographic -> map -> linear -> time', 27),
  ],
}

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }

describe('what is offered', () => {
  it('keeps the engine’s presets the app offers, in the engine’s order', () => {
    expect(TABLES.presets.map((p) => p.name)).toEqual([
      'instagram-post',
      'linkedin',
      'instagram-reel',
      'linkedin-gif',
    ])
  })

  it('groups them by platform, each platform where its first preset is', () => {
    expect(
      byPlatform(TABLES.presets).map((g) => [g.platform, g.presets.map((p) => p.name)]),
    ).toEqual([
      ['Instagram', ['instagram-post', 'instagram-reel']],
      ['LinkedIn', ['linkedin', 'linkedin-gif']],
    ])
  })

  it('names a preset with its size and what it makes, and a storyboard with its views and length', () => {
    expect(presetWords(PRESETS[0])).toBe('instagram-post: 1080 by 1350, still, PNG')
    expect(presetWords(PRESETS[2])).toBe('instagram-reel: 1080 by 1920, video, MP4')
    expect(presetWords(PRESETS[3])).toBe('linkedin-gif: 1080 by 1920, GIF')
    expect(storyboardWords(TABLES.storyboards[0])).toBe('tour: map, linear and time, 25 seconds')
    expect(storyboardWords(TABLES.storyboards[2])).toBe('run: map, 20 seconds')
    expect(storyboardWords(board('x', '', 4.4))).toBe('x: one view, 4.4 seconds')
  })

  it('plays a storyboard for a video or a GIF, and not for a still', () => {
    expect(plays(PRESETS[0])).toBe(false)
    expect(plays(PRESETS[2])).toBe(true)
    expect(plays(PRESETS[3])).toBe(true)
  })
})

describe('the choice', () => {
  it('defaults each option to what the engine does without it', () => {
    expect(defaultsFor(PRESETS[0])).toEqual({
      view: 'map',
      labels: true,
      title: true,
      clock: false,
      quality: 'standard',
    })
    expect(defaultsFor(PRESETS[2]).clock).toBe(true)
  })

  it('sends an option only when it differs from the default', () => {
    const reel = PRESETS[2]
    const off = withOption(REEL, reel, { key: 'clock', value: false })
    expect(off.options).toEqual({ clock: false })
    expect(withOption(off, reel, { key: 'clock', value: true }).options).toEqual({})
    expect(withOption(REEL, reel, { key: 'quality', value: 'standard' }).options).toEqual({})
    expect(withOption(REEL, reel, { key: 'view', value: 'linear' }).options).toEqual({
      view: 'linear',
    })
    expect(withOption(REEL, reel, { key: 'at', value: ' 07:30 ' }).options).toEqual({ at: '07:30' })
    const tagged = withOption(REEL, reel, { key: 'tag', value: 'draft' })
    expect(withOption(tagged, reel, { key: 'tag', value: '  ' }).options).toEqual({})
    const kept = withOption(REEL, reel, { key: 'lines', value: ['A'] })
    expect(kept.options).toEqual({ lines: ['A'] })
    expect(withOption(kept, reel, { key: 'lines', value: [] }).options).toEqual({})
    expect(REEL.options, 'the choice changed is a copy').toEqual({})
  })

  it('keeps the options across a preset change, and puts the storyboard back to the preset’s own', () => {
    const chosen: ExportChoice = {
      preset: 'instagram-reel',
      storyboard: 'run',
      options: { clock: false },
    }
    expect(withPreset(chosen, 'linkedin-gif')).toEqual({
      preset: 'linkedin-gif',
      options: { clock: false },
    })
  })

  it('stores a storyboard only when it is not the preset’s own', () => {
    expect(withStoryboard(REEL, PRESETS[2], 'run')).toEqual({ ...REEL, storyboard: 'run' })
    expect(withStoryboard({ ...REEL, storyboard: 'run' }, PRESETS[2], 'tour')).toEqual(REEL)
    expect(withStoryboard(REEL, PRESETS[2], 'not-one')).toEqual(REEL)
  })

  it('falls back to the reel when the engine no longer offers what was saved, and says what', () => {
    expect(usable({ preset: 'x', options: { clock: false } }, TABLES)).toEqual({
      choice: REEL,
      dropped: 'x',
    })
    expect(usable({ ...REEL, storyboard: 'essay-loop' }, TABLES)).toEqual({
      choice: REEL,
      dropped: 'essay-loop',
    })
    const fine: ExportChoice = { preset: 'linkedin-gif', storyboard: 'run', options: {} }
    expect(usable(fine, TABLES)).toEqual({ choice: fine, dropped: null })
    expect(
      usable({ preset: 'instagram-post', storyboard: 'run', options: {} }, TABLES),
      'a storyboard beside a still means nothing and goes quietly',
    ).toEqual({ choice: { preset: 'instagram-post', options: {} }, dropped: null })
  })

  it('compares two choices by what they ask', () => {
    expect(sameChoice(REEL, { options: {}, preset: 'instagram-reel' })).toBe(true)
    expect(sameChoice(REEL, { ...REEL, storyboard: 'run' })).toBe(false)
  })

  it('turns a line on or off in the order the lines are listed', () => {
    const all = ['A', 'B', 'C']
    expect(toggledLines(all, undefined, 'C', true)).toEqual(['C'])
    expect(toggledLines(all, ['C'], 'A', true)).toEqual(['A', 'C'])
    expect(toggledLines(all, ['A', 'C'], 'A', false)).toEqual(['C'])
    expect(toggledLines(all, ['Z', 'C'], 'B', true), 'a line no longer listed stays').toEqual([
      'B',
      'C',
      'Z',
    ])
  })

  it('reads a refusal in the engine’s words', () => {
    expect(
      refusalWords({
        ok: false,
        error: { code: -32000, message: 'm', data: { hint: 'h' } as never },
      }),
    ).toBe('h')
    expect(refusalWords({ ok: false, error: { code: -32000, message: 'm' } })).toBe('m')
  })
})

describe('the preview planner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const deferred = () => {
    const asked: { choice: ExportChoice; resolve: (p: ExportPreview) => void }[] = []
    const answers: [ExportPreview, ExportChoice][] = []
    const planner = new PreviewPlanner(
      (choice) =>
        new Promise<ExportPreview>((resolve) => {
          asked.push({ choice, resolve })
        }),
      (preview, choice) => answers.push([preview, choice]),
    )
    return { planner, asked, answers }
  }
  const ok = (url: string): ExportPreview => ({ ok: true, url, width: 9, height: 16, notes: [] })

  it('plans once when the changes stop', async () => {
    const { planner, asked } = deferred()
    for (const clock of [true, false, true, false]) {
      planner.schedule({ ...REEL, options: { clock } })
      await vi.advanceTimersByTimeAsync(PREVIEW_DELAY / 2)
    }
    expect(asked).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    expect(asked.map((a) => a.choice)).toEqual([{ ...REEL, options: { clock: false } }])
  })

  it('drops an answer that arrives after a newer question', async () => {
    const { planner, asked, answers } = deferred()
    planner.schedule(REEL)
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    planner.schedule({ ...REEL, storyboard: 'run' })
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    expect(asked).toHaveLength(2)
    asked[1].resolve(ok('new'))
    asked[0].resolve(ok('old'))
    await vi.advanceTimersByTimeAsync(0)
    expect(answers.map(([p]) => (p.ok ? p.url : null))).toEqual(['new'])
  })

  it('drops an answer that arrives while a newer change is still waiting to be planned', async () => {
    const { planner, asked, answers } = deferred()
    planner.schedule(REEL)
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    expect(asked).toHaveLength(1)
    planner.schedule({ ...REEL, storyboard: 'run' })
    asked[0].resolve(ok('old'))
    await vi.advanceTimersByTimeAsync(0)
    expect(answers, 'the old answer never reaches the frame').toEqual([])
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    asked[1].resolve(ok('new'))
    await vi.advanceTimersByTimeAsync(0)
    expect(answers.map(([p]) => (p.ok ? p.url : null))).toEqual(['new'])
  })

  it('forgets a waiting plan and a pending answer when cancelled', async () => {
    const { planner, asked, answers } = deferred()
    planner.schedule(REEL)
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    planner.schedule({ ...REEL, storyboard: 'run' })
    planner.cancel()
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY * 2)
    asked[0].resolve(ok('late'))
    await vi.advanceTimersByTimeAsync(0)
    expect(asked).toHaveLength(1)
    expect(answers).toEqual([])
  })

  it('turns a failed question into a refusal rather than losing it', async () => {
    const answers: ExportPreview[] = []
    const planner = new PreviewPlanner(
      () => Promise.reject(new Error('the window has gone')),
      (preview) => answers.push(preview),
    )
    planner.schedule(REEL)
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY)
    expect(answers).toEqual([
      { ok: false, error: { code: -32603, message: 'the window has gone' } },
    ])
  })
})

describe('the engine’s tables', () => {
  afterEach(() => forgetExportTables())

  const client = (fail = false) => {
    const calls: string[] = []
    const answer = {
      'export.presets': { presets: PRESETS },
      'export.storyboards': { storyboards: TABLES.storyboards },
    }
    const stub = {
      request: (method: 'export.presets' | 'export.storyboards') => {
        calls.push(method)
        return {
          result: fail ? Promise.reject(new Error('not now')) : Promise.resolve(answer[method]),
        }
      },
    } as unknown as TablesClient
    return { stub, calls }
  }

  it('asks once while the engine stays up, and keeps only what is offered', async () => {
    const { stub, calls } = client()
    const first = await exportTablesFor(stub)
    await exportTablesFor(stub)
    expect(calls).toEqual(['export.presets', 'export.storyboards'])
    expect(first.presets.map((p) => p.name)).not.toContain('portfolio-mp4')
    forgetExportTables()
    await exportTablesFor(stub)
    expect(calls).toHaveLength(4)
  })

  it('does not keep a refusal', async () => {
    const failing = client(true)
    await expect(exportTablesFor(failing.stub)).rejects.toThrow('not now')
    const working = client()
    await expect(exportTablesFor(working.stub)).resolves.toBeTruthy()
  })
})
