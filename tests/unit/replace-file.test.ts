// The rename a record or the settings file ends with, tried again on Windows
// while the platform says the destination is held: a defence against the
// suspected cause of issue 93. The refusal is made here by hand, through the
// seam, with each code the retry takes, and the retried codes are passed in
// so the retry is exercised on every platform.

import {
  mkdtemp,
  open as realOpen,
  readFile,
  rename as real,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  failedWords,
  folderWords,
  RENAME_RETRY_CODES,
  RENAME_RETRY_DELAYS_MS,
  renameOver,
  replaceFile,
  RenameRefused,
  retriedWords,
  WINDOWS_RETRY_CODES,
  type Rename,
} from '../../src/main/replace-file'

const codes = WINDOWS_RETRY_CODES

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
    expect([...WINDOWS_RETRY_CODES].sort()).toEqual(['EACCES', 'EBUSY', 'EPERM'])
  })

  it('tries nothing again by default anywhere but Windows', () => {
    expect([...RENAME_RETRY_CODES].sort()).toEqual(
      process.platform === 'win32' ? ['EACCES', 'EBUSY', 'EPERM'] : [],
    )
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
          codes,
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
      codes,
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
    await renameOver(from, to, { rename: refused.rename, codes })
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
        codes,
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
      codes,
    }).catch((error: unknown) => error)
    expect(calls).toBe(1)
    expect(failedWords(failure)).toBe('write failed (unknown error, 1 attempt)')
  })

  it.skipIf(process.platform === 'win32')(
    'fails at once off Windows when no codes are given, a held-looking code included',
    async () => {
      const { from, to } = await files()
      for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
        const refused = refusedRename(Infinity, code, async () => undefined)
        const waits: number[] = []
        const failure = await renameOver(from, to, {
          rename: refused.rename,
          wait: async (ms) => void waits.push(ms),
        }).catch((error: unknown) => error)
        expect(refused.calls(), code).toBe(1)
        expect(waits, code).toEqual([])
        expect(failedWords(failure)).toBe(`write failed (${code}, 1 attempt)`)
      }
    },
  )

  it('says how many attempts were made when a wait itself fails', async () => {
    const { from, to } = await files()
    const refused = refusedRename(Infinity, 'EPERM', async () => undefined)
    let waited = 0
    const failure = await renameOver(from, to, {
      rename: refused.rename,
      wait: async () => {
        waited += 1
        if (waited === 2) throw new Error('the wait was cut short')
      },
      codes,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RenameRefused)
    expect(refused.calls()).toBe(2)
    expect((failure as RenameRefused).attempts).toBe(2)
    expect(failedWords(failure)).toBe('write failed (EPERM, 2 attempts)')
    expect(await readFile(to, 'utf8')).toBe('before')
  })

  it('words a failure that was not the rename by its code alone', () => {
    expect(failedWords(refusal('ENOSPC'))).toBe('write failed (ENOSPC)')
  })
})

describe('replaceFile: the disk is told before and after the rename (issue 432)', () => {
  /** Real files, with every open, sync, rename and close written to `events` as it happens. */
  function watched(events: string[], failSync?: (path: string) => boolean) {
    const open = (async (path: string, flags: string) => {
      const handle = await realOpen(path, flags)
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'sync')
            return async () => {
              events.push(`sync ${flags === 'r' ? 'folder' : 'file'}`)
              if (failSync?.(path)) throw refusal('EIO')
              return target.sync()
            }
          if (key === 'close')
            return async () => {
              events.push(`close ${flags === 'r' ? 'folder' : 'file'}`)
              return target.close()
            }
          const value = Reflect.get(target, key) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }) as unknown as typeof realOpen
    const rename: Rename = async (from, to) => {
      events.push('rename')
      await real(from, to)
    }
    return { open, rename }
  }

  it('flushes the file before the rename and the folder after it', async () => {
    const events: string[] = []
    const target = join(dir, 'project.json')
    await writeFile(target, 'old')
    await replaceFile(join(dir, 't.tmp'), target, 'new', { ...watched(events), platform: 'linux' })
    expect(await readFile(target, 'utf8')).toBe('new')
    expect(events).toEqual(['sync file', 'close file', 'rename', 'sync folder', 'close folder'])
  })

  it('does not open the folder on Windows, where that is refused', async () => {
    const events: string[] = []
    const target = join(dir, 'project.json')
    await replaceFile(join(dir, 't.tmp'), target, 'new', { ...watched(events), platform: 'win32' })
    expect(events).toEqual(['sync file', 'close file', 'rename'])
  })

  it('a failed flush stops before the rename and leaves the old file whole', async () => {
    const events: string[] = []
    const target = join(dir, 'project.json')
    await writeFile(target, 'old')
    await expect(
      replaceFile(join(dir, 't.tmp'), target, 'new', {
        ...watched(events, () => true),
        platform: 'linux',
      }),
    ).rejects.toMatchObject({ code: 'EIO' })
    expect(events).not.toContain('rename')
    expect(events, 'the file handle is closed after a failed flush').toContain('close file')
    expect(await readFile(target, 'utf8')).toBe('old')
  })

  it('a folder that cannot be flushed at all (EINVAL) is not a failed save', async () => {
    const target = join(dir, 'project.json')
    const open = (async (path: string, flags: string) => {
      const handle = await realOpen(path, flags)
      if (flags !== 'r') return handle
      return new Proxy(handle, {
        get(t, key) {
          if (key === 'sync')
            return async () => {
              throw refusal('EINVAL')
            }
          const value = Reflect.get(t, key) as unknown
          return typeof value === 'function' ? value.bind(t) : value
        },
      })
    }) as unknown as typeof realOpen
    await replaceFile(join(dir, 't.tmp'), target, 'new', { open, platform: 'linux' })
    expect(await readFile(target, 'utf8')).toBe('new')
  })
})

describe('replaceFile: once the rename has landed nothing throws (issue 432)', () => {
  type Step = 'open folder' | 'sync folder' | 'close folder' | 'close file'

  /** Real files; the named step fails with `code` and a message that names a path. */
  function failing(step: Step, code: string): typeof realOpen {
    const boom = (): never => {
      throw Object.assign(new Error(`${code}: refused, '/some/private/folder'`), { code })
    }
    return (async (path: string, flags: string) => {
      const isFolder = flags === 'r'
      if (isFolder && step === 'open folder') boom()
      const handle = await realOpen(path, flags)
      return new Proxy(handle, {
        get(t, key) {
          if (key === 'sync' && isFolder && step === 'sync folder') return async () => boom()
          if (key === 'close' && step === (isFolder ? 'close folder' : 'close file'))
            return async () => {
              await t.close()
              boom()
            }
          const v = Reflect.get(t, key) as unknown
          return typeof v === 'function' ? v.bind(t) : v
        },
      })
    }) as unknown as typeof realOpen
  }

  const folderSteps: [Step, string][] = [
    ['open folder', 'EACCES'],
    ['sync folder', 'EIO'],
    ['close folder', 'EIO'],
  ]

  it.each(folderSteps)(
    'a failed %s (%s) leaves the new content, resolves and reports the code only',
    async (step, code) => {
      const target = join(dir, 'project.json')
      await writeFile(target, 'old')
      const renamed = await replaceFile(join(dir, 't.tmp'), target, 'new', {
        open: failing(step, code),
        platform: 'linux',
      })
      expect(await readFile(target, 'utf8')).toBe('new')
      expect(renamed.folderRefused).toBe(code)
      const words = folderWords(renamed) ?? ''
      expect(words).toContain(code)
      expect(words).not.toContain('/some/private')
    },
  )

  it('a folder that cannot be flushed at all is not even reported', async () => {
    const target = join(dir, 'project.json')
    const renamed = await replaceFile(join(dir, 't.tmp'), target, 'new', {
      open: failing('sync folder', 'ENOTSUP'),
      platform: 'linux',
    })
    expect(folderWords(renamed)).toBeNull()
  })

  it('a failing close of the file handle fails the write before the rename and leaves the target', async () => {
    const target = join(dir, 'project.json')
    await writeFile(target, 'old')
    await expect(
      replaceFile(join(dir, 't.tmp'), target, 'new', {
        open: failing('close file', 'EIO'),
        platform: 'linux',
      }),
    ).rejects.toMatchObject({ code: 'EIO' })
    expect(await readFile(target, 'utf8')).toBe('old')
  })
})
