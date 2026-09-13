// "Copy log" on a job, main side (A1-03, specs/024-jobs, FR-007): bounded
// text only, a feed URL's secrets taken out, the home folder written as
// `~`, a home that survives refused, and only the interface's own top
// frame may ask. Fake homes are built under the temporary folder.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  copyJobLog,
  isJobLog,
  jobLogText,
  registerJobsHandlers,
  type JobsDeps,
} from '../../src/main/jobs-ipc'
import { CHANNELS } from '../../src/shared/api'
import { JOB_LOG_BYTES } from '../../src/shared/jobs'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const HOME = join(tmpdir(), 'legible-cities-jobs-ipc', 'home', 'someone')

function deps(over: Partial<JobsDeps> = {}) {
  const copied: string[] = []
  const logs: string[] = []
  const d: JobsDeps = {
    homes: async () => [HOME],
    platform: 'linux',
    writeText: (text) => copied.push(text),
    log: (m) => logs.push(m),
    ...over,
  }
  return { d, copied, logs }
}

function registered(d: JobsDeps, topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  registerJobsHandlers(ipc, d, () => topFrame)
  return (...args: unknown[]): Promise<unknown> =>
    handlers.get(CHANNELS.jobsCopyLog)!({} as IpcMainInvokeEvent, ...args)
}

describe('the text a job log may be', () => {
  it('is a string, not empty, of at most 256 KB in bytes', () => {
    expect(isJobLog('a log')).toBe(true)
    expect(isJobLog('')).toBe(false)
    expect(isJobLog(42)).toBe(false)
    expect(isJobLog(['a log'])).toBe(false)
    expect(isJobLog('é'.repeat(JOB_LOG_BYTES / 2))).toBe(true)
    expect(isJobLog('é'.repeat(JOB_LOG_BYTES / 2 + 1))).toBe(false)
  })
})

describe('jobLogText', () => {
  it("takes a feed URL's key out and writes the home folder as ~", () => {
    const text = [
      '[info] fetching https://agency.example/gtfs.zip?api_key=s3cr3t-value',
      `[info] reading ${join(HOME, 'feeds', 'la.zip')}`,
    ].join('\n')
    const out = jobLogText(text, [HOME], 'linux')
    expect(out).not.toContain('s3cr3t-value')
    expect(out).toContain('https://agency.example/gtfs.zip?api_key=')
    expect(out).not.toContain(HOME)
    expect(out).toContain(`~${join('/', 'feeds', 'la.zip')}`)
  })

  it('refuses when a home survives in a form the replacement does not write', () => {
    // Lower-case percent-escapes on a platform that keeps case: the
    // replacement leaves them, and decoding finds the home, so the copy is
    // refused rather than made, as the diagnostics copy refuses.
    const home = join(tmpdir(), 'legible-cities-jobs-ipc', 'josé')
    const encoded = encodeURI(home).replace(/%[0-9A-F]{2}/g, (e) => e.toLowerCase())
    expect(encoded).not.toBe(encodeURI(home))
    expect(() => jobLogText(`[info] ${encoded}`, [home], 'linux')).toThrow(
      'the log still named your home folder, so nothing was copied',
    )
  })
})

describe('the copy-log handler', () => {
  it('writes the redacted text to the clipboard and logs its size, not its content', async () => {
    const { d, copied, logs } = deps()
    const call = registered(d)
    await call(`# Layout run, Los Angeles\nkey https://x.example/f.zip?token=abc123\n${HOME}`)
    expect(copied).toHaveLength(1)
    expect(copied[0]).not.toContain('abc123')
    expect(copied[0]).not.toContain(HOME)
    expect(logs[0]).toMatch(/^copied a job's log \(\d+ bytes\) to the clipboard$/)
    expect(logs[0]).not.toContain('Los Angeles')
  })

  it('refuses anything but bounded text, and writes nothing', async () => {
    const { d, copied } = deps()
    const call = registered(d)
    await expect(call(undefined)).rejects.toThrow('not a short piece of text')
    await expect(call({ text: 'x' })).rejects.toThrow('not a short piece of text')
    await expect(call('x'.repeat(JOB_LOG_BYTES + 1))).rejects.toThrow('not a short piece of text')
    expect(copied).toEqual([])
  })

  it('refuses a frame that is not the interface’s own', async () => {
    const { d, copied } = deps()
    await expect(registered(d, false)('a log')).rejects.toThrow('forbidden')
    expect(copied).toEqual([])
  })

  it('writes nothing when the home lookup refuses', async () => {
    const { d, copied } = deps({
      homes: async () => {
        throw new Error('the home folder did not answer in time, so nothing was copied')
      },
    })
    await expect(copyJobLog('a log', d)).rejects.toThrow('did not answer in time')
    expect(copied).toEqual([])
  })
})
