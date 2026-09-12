import { describe, expect, it, vi } from 'vitest'
import type { Theme } from '../../src/shared/project'
import { nextWrite, writeThrough } from '../../src/renderer/src/themeWrites'

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
