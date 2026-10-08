import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Theme } from '../../src/shared/project'
import { nextWrite, writeThenRestyle, writeThrough } from '../../src/renderer/src/themeWrites'

// The theme switch's own logic (A4-03, specs/021-theme): what a press does
// at this moment, and what happens to a press that arrives while the record
// is being written. The end-to-end suite cannot make that gap on purpose -
// the write is one hop and one small file, with no engine in the path - so
// the deterministic version of it lives here.

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

describe('nextWrite', () => {
  it('writes a theme the project is not already in', () => {
    expect(nextWrite('sepia', 'warm-dark', false)).toBe('write')
  })

  it('does nothing for the theme the project is already in', () => {
    expect(nextWrite('sepia', 'sepia', false)).toBe('none')
  })

  it('keeps a press that lands while a write is in flight, whichever it is', () => {
    expect(nextWrite('sepia', 'warm-dark', true)).toBe('keep')
    // Kept even when it matches the record: the record is the theme of the
    // write that has landed, not of the one still going.
    expect(nextWrite('sepia', 'sepia', true)).toBe('keep')
  })
})

describe('writeThrough', () => {
  it('writes the one press when nothing else arrives', async () => {
    const written: Theme[] = []
    await writeThrough(
      'sepia',
      async (theme) => {
        written.push(theme)
      },
      () => null,
    )
    expect(written).toEqual(['sepia'])
  })

  it('applies the press that arrived while the first was writing', async () => {
    const written: Theme[] = []
    const first = deferred()
    let kept: Theme | null = null
    const run = writeThrough(
      'sepia',
      async (theme) => {
        written.push(theme)
        if (theme === 'sepia') await first.promise
      },
      () => {
        const next = kept
        kept = null
        return next
      },
    )
    await tick()
    expect(written, 'the first is out and the second has nowhere to be yet').toEqual(['sepia'])
    kept = 'warm-dark'
    first.settle()
    await run
    expect(written).toEqual(['sepia', 'warm-dark'])
  })

  it('ends on a press that only repeats what has just been written', async () => {
    const written: Theme[] = []
    let kept: Theme | null = 'sepia'
    await writeThrough(
      'sepia',
      async (theme) => {
        written.push(theme)
      },
      () => {
        const next = kept
        kept = null
        return next
      },
    )
    expect(written, 'one write, not two of the same').toEqual(['sepia'])
  })

  it('takes the last press, and everything asked for in order', async () => {
    const written: Theme[] = []
    const asked: Theme[] = ['warm-dark', 'sepia']
    await writeThrough(
      'sepia',
      async (theme) => {
        written.push(theme)
      },
      () => asked.shift() ?? null,
    )
    expect(written).toEqual(['sepia', 'warm-dark', 'sepia'])
  })

  it('gives up on the first failure, with the error, and writes no more', async () => {
    const written: Theme[] = []
    const take = vi.fn(() => 'warm-dark' as Theme)
    await expect(
      writeThrough(
        'sepia',
        async (theme) => {
          written.push(theme)
          throw new Error('the record could not be written')
        },
        take,
      ),
    ).rejects.toThrow('the record could not be written')
    expect(written).toEqual(['sepia'])
    expect(take, 'nothing kept is taken up by a run that has failed').not.toHaveBeenCalled()
  })
})

// A written theme restyles the map's page in place instead of reloading the
// frame (issue 349): the record first, then one call to the page, which
// nothing waits for and nothing it says is an error.
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

  it('sends one call for each theme written, in the order they were written', async () => {
    const told: Theme[] = []
    const asked: Theme[] = ['warm-dark']
    await writeThrough(
      'sepia',
      (theme) =>
        writeThenRestyle(
          theme,
          async () => undefined,
          async (chosen) => {
            told.push(chosen)
          },
        ),
      () => asked.shift() ?? null,
    )
    expect(told).toEqual(['sepia', 'warm-dark'])
  })
})

// The hook is a React hook and is not rendered here; the line that sends the
// call to the map's frame is read, so a screen that wrote the record and
// forgot the page fails here before it fails on a runner
// (`tests/e2e/theme.spec.ts` is the proof it arrives).
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
  })
})
