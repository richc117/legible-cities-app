import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Theme } from '../../src/shared/project'
import { lacksTheSeam, writeThenRestyle } from '../../src/renderer/src/themeWrites'
import { MISSING_METHOD } from '../../src/shared/viewer'

// The theme switch's own logic (A4-03, specs/021-theme): what a written
// theme does to the map on screen. A press that arrives while the record is
// being written is simply a second write since spec 037, whose order the
// bridge and the store keep; what the switch keeps meanwhile is the
// chooser's (`theme-chooser.test.ts`).

/** A promise this test settles by hand, so a write can be held open. */
function deferred(): { promise: Promise<void>; settle: () => void; fail: (why: Error) => void } {
  let settle!: () => void
  let fail!: (why: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    settle = () => resolve()
    fail = reject
  })
  return { promise, settle, fail }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('writeThenRestyle', () => {
  it('writes the record first and then tells the page, with the same theme', async () => {
    const order: string[] = []
    await writeThenRestyle(
      'sepia',
      async (theme) => {
        order.push(`write ${theme}`)
      },
      async (theme) => {
        order.push(`restyle ${theme}`)
      },
    )
    expect(order).toEqual(['write sepia', 'restyle sepia'])
  })

  it('tells the page nothing until the record has been written', async () => {
    const held = deferred()
    const restyle = vi.fn(async () => undefined)
    const run = writeThenRestyle('sepia', () => held.promise, restyle)
    await tick()
    expect(restyle, 'the write is still going').not.toHaveBeenCalled()
    held.settle()
    await run
    expect(restyle).toHaveBeenCalledOnce()
  })

  it('sends nothing, and says why, when the record cannot be written', async () => {
    const restyle = vi.fn(async () => undefined)
    await expect(
      writeThenRestyle(
        'sepia',
        async () => {
          throw new Error('the record could not be written')
        },
        restyle,
      ),
    ).rejects.toThrow('the record could not be written')
    expect(restyle, 'a map restyled for a theme the record does not hold').not.toHaveBeenCalled()
  })

  it('is not an error when the page is not there to be told', async () => {
    // The frame between two documents, or no map yet: the viewer's bridge
    // rejects, and the next document carries the theme.
    await expect(
      writeThenRestyle(
        'sepia',
        async () => undefined,
        () => Promise.reject(new Error('the map is not on the screen')),
      ),
    ).resolves.toBeUndefined()
    await tick()
  })

  it('is not an error when the bridge throws before it can ask', async () => {
    await expect(
      writeThenRestyle(
        'sepia',
        async () => undefined,
        () => {
          throw new Error('no bridge')
        },
      ),
    ).resolves.toBeUndefined()
  })

  it('does not wait for the page, which may never answer', async () => {
    // A page whose main thread is blocked answers nothing at all. Waiting
    // for it would hold the switch's write loop, and every press after.
    const never = new Promise<unknown>(() => {})
    await expect(
      writeThenRestyle(
        'sepia',
        async () => undefined,
        () => never,
      ),
    ).resolves.toBeUndefined()
  })

  it('sends one call for each theme written, in the order the writes were answered', async () => {
    // Two presses inside one round trip: both written at once, answered in
    // the order they were sent (spec 037), and the page told in that order.
    const told: Theme[] = []
    const first = deferred()
    const second = deferred()
    const restyle = async (chosen: Theme): Promise<void> => {
      told.push(chosen)
    }
    const one = writeThenRestyle('sepia', () => first.promise, restyle)
    const two = writeThenRestyle('warm-dark', () => second.promise, restyle)
    first.settle()
    await tick()
    second.settle()
    await Promise.all([one, two])
    expect(told).toEqual(['sepia', 'warm-dark'])
  })
})

// The hook is a React hook and is not rendered here; the line that sends the
// call to the map's frame is read, so a screen that wrote the record and
// forgot the page fails here before it fails on a runner
// (`tests/e2e/theme.spec.ts` is the proof it arrives).
// A page the engine wrote before v0.11.0 has no `setTheme`, and nothing is
// coming that would carry the theme to it: the one refusal that is answered.
describe('a page with no setTheme', () => {
  it('is recognised by the dispatcher’s own sentence, whole, and by nothing else', () => {
    expect(lacksTheSeam(new Error(MISSING_METHOD))).toBe(true)
    for (const other of [
      'the map is not on the screen',
      'the map is still loading',
      'the map did not answer',
      'the map could not do that',
      '',
      `${MISSING_METHOD}, really`,
    ])
      expect(lacksTheSeam(new Error(other)), other).toBe(false)
    // A thing thrown that is not an error is not the dispatcher's sentence.
    for (const other of [MISSING_METHOD, null, undefined, 7, { message: MISSING_METHOD }])
      expect(lacksTheSeam(other), String(other)).toBe(false)
  })

  it('falls back once, after the record is written, when the page says it cannot', async () => {
    const order: string[] = []
    await writeThenRestyle(
      'sepia',
      async () => {
        order.push('write')
      },
      () => Promise.reject(new Error(MISSING_METHOD)),
      () => order.push('fall back'),
    )
    await tick()
    expect(order).toEqual(['write', 'fall back'])
  })

  it('does not fall back for any other refusal', async () => {
    const fallBack = vi.fn()
    for (const why of [
      'the map is not on the screen',
      'the map is still loading',
      'the map did not answer',
    ])
      await writeThenRestyle(
        'sepia',
        async () => undefined,
        () => Promise.reject(new Error(why)),
        fallBack,
      )
    await writeThenRestyle(
      'sepia',
      async () => undefined,
      () => {
        throw new Error(MISSING_METHOD)
      },
      fallBack,
    )
    await tick()
    expect(fallBack, 'every other failure stays swallowed').not.toHaveBeenCalled()
  })

  it('does not fall back when the page took the theme, or when the record was not written', async () => {
    const fallBack = vi.fn()
    await writeThenRestyle(
      'sepia',
      async () => undefined,
      async () => true,
      fallBack,
    )
    await expect(
      writeThenRestyle(
        'sepia',
        async () => {
          throw new Error('the record could not be written')
        },
        () => Promise.reject(new Error(MISSING_METHOD)),
        fallBack,
      ),
    ).rejects.toThrow('the record could not be written')
    await tick()
    expect(fallBack).not.toHaveBeenCalled()
  })

  it('is not an error when the fallback itself throws', async () => {
    await expect(
      writeThenRestyle(
        'sepia',
        async () => undefined,
        () => Promise.reject(new Error(MISSING_METHOD)),
        () => {
          throw new Error('no state to set')
        },
      ),
    ).resolves.toBeUndefined()
    await tick()
  })
})

describe('the project screen’s setTheme', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/renderer/src/notebook/useProjectState.ts'),
    'utf8',
  )

  it('writes through writeThenRestyle, and the restyle is setTheme on the map’s frame', () => {
    expect(source).toMatch(/\bwriteThenRestyle\(/)
    expect(source, 'the call that restyles the page in place').toMatch(
      /viewer\.call\(\s*'map',\s*'setTheme'/,
    )
    expect(
      source,
      'the theme is remembered the moment the record’s answer arrives, before the page is told',
    ).toMatch(
      /projects\.setTheme\(id, chosen\)\s*\n\s*rememberTheme\(id, record\.theme\)\s*\n\s*setState/,
    )
    // Wherever the jobs of a deleted project are forgotten, so is its theme:
    // the delete's two signals, and no others.
    const forgetting = source.match(/\bforgetProjectJobs\(id\)/g) ?? []
    expect(forgetting, 'the two places a project is deleted').toHaveLength(2)
    expect(source.match(/\bforgetProjectJobs\(id\)\s*\n\s*forgetTheme\(id\)/g) ?? []).toHaveLength(
      2,
    )
    expect(source, 'and the fallback for a page that cannot be told').toMatch(
      /setThemeReloads\(\s*\(count\)\s*=>\s*count \+ 1\s*\)/,
    )
  })
})
