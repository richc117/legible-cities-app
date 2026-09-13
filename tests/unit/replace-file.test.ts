// The rename a record or the settings file ends with, tried again while the
// platform says the destination is held (issue 93). Windows refuses a rename
// over a file another handle has open; no other platform does, so the
// refusal is made here by hand, through the seam, with each code it comes as.

import { mkdtemp, readFile, rename as real, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  failedWords,
  RENAME_RETRY_CODES,
  RENAME_RETRY_DELAYS_MS,
  renameOver,
  RenameRefused,
  retriedWords,
  type Rename,
} from '../../src/main/replace-file'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legible-cities-replace-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A Node-shaped failure with only a code, as fs raises one. */
function refusal(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: refused, rename 'somewhere'`), { code })
}

/** A rename the platform refuses `times` times with `code`, then the real one. */
function refusedRename(
  times: number,
  code: string,
  after: Rename,
): { rename: Rename; calls: () => number } {
  let calls = 0
  return {
    rename: async (from, to) => {
      calls += 1
      if (calls <= times) throw refusal(code)
      await after(from, to)
    },
    calls: () => calls,
  }
}

describe('the bound', () => {
  it('waits longer each time, eight attempts in all, over about 1.3 seconds', () => {
    expect(RENAME_RETRY_DELAYS_MS).toEqual([10, 20, 40, 80, 160, 320, 640])
    const total = RENAME_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)
    expect(total).toBeLessThanOrEqual(1300)
    expect([...RENAME_RETRY_CODES].sort()).toEqual(['EACCES', 'EBUSY', 'EPERM'])
  })
})

describe('renameOver', () => {
  const files = async (): Promise<{ from: string; to: string }> => {
    const from = join(dir, 'next.tmp')
    const to = join(dir, 'file.json')
    await writeFile(to, 'before')
    await writeFile(from, 'after')
    return { from, to }
  }

  it('renames at once when nothing holds the file, and waits for nothing', async () => {
    const { from, to } = await files()
    const waits: number[] = []
    const renamed = await renameOver(from, to, { wait: async (ms) => void waits.push(ms) })
    expect(renamed).toEqual({ attempts: 1, refused: [] })
    expect(waits).toEqual([])
    expect(await readFile(to, 'utf8')).toBe('after')
    expect(retriedWords(renamed)).toBeNull()
  })

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    it(`lands after the file was held (${code}), waiting the bound's first steps`, async () => {
      const { from, to } = await files()
      for (const times of [1, 3, RENAME_RETRY_DELAYS_MS.length]) {
        await writeFile(from, `after ${times}`)
        const refused = refusedRename(times, code, real)
        const waits: number[] = []
        const renamed = await renameOver(from, to, {
          rename: refused.rename,
          wait: async (ms) => void waits.push(ms),
        })
        expect(renamed.attempts, `${times} refusals`).toBe(times + 1)
        expect(refused.calls()).toBe(times + 1)
        expect(waits).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, times))
        expect(await readFile(to, 'utf8')).toBe(`after ${times}`)
        expect(retriedWords(renamed)).toBe(`saved after ${times + 1} attempts (${code})`)
      }
    })
  }

  it('gives up once the waits are spent, with the code and the attempts made', async () => {
    const { from, to } = await files()
    const refused = refusedRename(Infinity, 'EBUSY', async () => undefined)
    const waits: number[] = []
    const failure = await renameOver(from, to, {
      rename: refused.rename,
      wait: async (ms) => void waits.push(ms),
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RenameRefused)
    expect((failure as RenameRefused).code).toBe('EBUSY')
    expect((failure as RenameRefused).attempts).toBe(RENAME_RETRY_DELAYS_MS.length + 1)
    expect(refused.calls()).toBe(RENAME_RETRY_DELAYS_MS.length + 1)
    expect(waits).toEqual([...RENAME_RETRY_DELAYS_MS])
    expect(failedWords(failure), 'no path in the words').toBe('write failed (EBUSY, 8 attempts)')
    expect(await readFile(to, 'utf8'), 'the file is as it was').toBe('before')
  })

  it('really waits between attempts when no wait is given', async () => {
    const { from, to } = await files()
    const refused = refusedRename(2, 'EPERM', real)
    const started = Date.now()
    await renameOver(from, to, { rename: refused.rename })
    // 10 ms then 20 ms, 30 in all; a margin for a timer's rounding.
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    expect(await readFile(to, 'utf8')).toBe('after')
  })

  for (const code of ['ENOENT', 'EXDEV', 'EISDIR', 'ENOSPC']) {
    it(`does not try again after ${code}, which waiting would not change`, async () => {
      const { from, to } = await files()
      const refused = refusedRename(Infinity, code, async () => undefined)
      const waits: number[] = []
      const failure = await renameOver(from, to, {
        rename: refused.rename,
        wait: async (ms) => void waits.push(ms),
      }).catch((error: unknown) => error)
      expect(refused.calls()).toBe(1)
      expect(waits).toEqual([])
      expect((failure as RenameRefused).code).toBe(code)
      expect(failedWords(failure)).toBe(`write failed (${code}, 1 attempt)`)
    })
  }

  it('does not try again after a failure that carries no code at all', async () => {
    const { from, to } = await files()
    let calls = 0
    const failure = await renameOver(from, to, {
      rename: async () => {
        calls += 1
        throw new Error('no code')
      },
      wait: async () => undefined,
    }).catch((error: unknown) => error)
    expect(calls).toBe(1)
    expect(failedWords(failure)).toBe('write failed (unknown error, 1 attempt)')
  })

  it('words a failure that was not the rename by its code alone', () => {
    expect(failedWords(refusal('ENOSPC'))).toBe('write failed (ENOSPC)')
  })
})
