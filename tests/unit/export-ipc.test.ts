// The export bridge's main side: the token, the project and the preset
// checked before the exporter sees them, the outcome sent as an event after
// the progress, the reveal by token and never by path, and only the top
// frame allowed through.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerExportHandlers, type ExportSource } from '../../src/main/export-ipc'
import { CHANNELS } from '../../src/shared/api'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import type { ExportProgress, ExportResult } from '../../src/shared/export'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function harness(topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle: (channel: string, h: Handler) => handlers.set(channel, h),
  } as unknown as IpcMain
  const sent: { channel: string; payload: unknown }[] = []
  const revealed: string[] = []
  const started: { token: string; projectId: string; preset: string }[] = []
  const cancelled: string[] = []
  let listener: ((p: ExportProgress) => void) | null = null
  let settle!: (v: ExportResult) => void
  let fail!: (e: unknown) => void
  const files = new Map<string, string>()
  const exporter: ExportSource = {
    start(token, projectId, preset) {
      if (token === 'busy')
        throw new EngineError(ERROR_CODES.badCall, 'This project is already being exported.', {
          kind: 'params',
          detail: 'busy',
          hint: 'This project is already being exported.',
        })
      started.push({ token, projectId, preset })
      return {
        result: new Promise((res, rej) => {
          settle = res
          fail = rej
        }),
      }
    },
    cancel: (token) => cancelled.push(token),
    fileOf: (token) => files.get(token) ?? null,
    onProgress: (l) => {
      listener = l
      return () => {}
    },
  }
  registerExportHandlers(
    ipc,
    exporter,
    () => topFrame,
    (channel, payload) => sent.push({ channel, payload }),
    (path) => revealed.push(path),
  )
  const event = {} as IpcMainInvokeEvent
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return {
    handlers,
    call,
    sent,
    revealed,
    started,
    cancelled,
    files,
    settle: (v: ExportResult) => settle(v),
    fail: (e: unknown) => fail(e),
    report: (p: ExportProgress) => listener?.(p),
  }
}

describe('registerExportHandlers', () => {
  it('registers the three channels and nothing else', () => {
    const { handlers } = harness()
    expect([...handlers.keys()].sort()).toEqual(
      [CHANNELS.exportRun, CHANNELS.exportCancel, CHANNELS.exportReveal].sort(),
    )
  })
  it('refuses a caller that is not the top frame', async () => {
    const { call, started } = harness(false)
    await expect(call(CHANNELS.exportRun, 't1', 'abcdefghijk1', 'instagram-reel')).rejects.toThrow(
      'forbidden',
    )
    await expect(call(CHANNELS.exportReveal, 't1')).rejects.toThrow('forbidden')
    expect(started).toEqual([])
  })
  it('refuses a bad token, project or preset before the exporter sees them', async () => {
    const { call, started } = harness()
    for (const args of [
      [undefined, 'abcdefghijk1', 'instagram-reel'],
      ['has spaces', 'abcdefghijk1', 'instagram-reel'],
      ['con', 'abcdefghijk1', 'instagram-reel'],
      ['COM1', 'abcdefghijk1', 'instagram-reel'],
      ['t1', 'not-an-id', 'instagram-reel'],
      ['t1', '../escape', 'instagram-reel'],
      ['t1', 'abcdefghijk1', 'portfolio-svg'],
      ['t1', 'abcdefghijk1', undefined],
    ]) {
      const answer = (await call(CHANNELS.exportRun, ...args)) as { accepted: boolean }
      expect(answer.accepted, JSON.stringify(args)).toBe(false)
    }
    expect(started).toEqual([])
  })
  it('answers a refusal the exporter made as data, not a rejection', async () => {
    const { call } = harness()
    const answer = await call(CHANNELS.exportRun, 'busy', 'abcdefghijk1', 'instagram-reel')
    expect(answer).toEqual({
      accepted: false,
      error: {
        code: ERROR_CODES.badCall,
        message: 'This project is already being exported.',
        data: {
          kind: 'params',
          detail: 'busy',
          hint: 'This project is already being exported.',
        },
      },
    })
  })
  it('accepts at once, forwards progress, and settles on the event channel after it', async () => {
    const h = harness()
    expect(await h.call(CHANNELS.exportRun, 't1', 'abcdefghijk1', 'instagram-reel')).toEqual({
      accepted: true,
    })
    expect(h.started).toEqual([
      { token: 't1', projectId: 'abcdefghijk1', preset: 'instagram-reel' },
    ])
    h.report({ id: 't1', stage: 'capture', fraction: 0.5, message: 'Captured 30 of 60 frames.' })
    h.settle({ file: 'x.mp4', bytes: 10, frames: 60 })
    await tick()
    expect(h.sent).toEqual([
      {
        channel: CHANNELS.exportProgress,
        payload: {
          id: 't1',
          stage: 'capture',
          fraction: 0.5,
          message: 'Captured 30 of 60 frames.',
        },
      },
      {
        channel: CHANNELS.exportSettled,
        payload: { id: 't1', ok: true, result: { file: 'x.mp4', bytes: 10, frames: 60 } },
      },
    ])
  })
  it('settles a failure with the error shape intact', async () => {
    const h = harness()
    await h.call(CHANNELS.exportRun, 't1', 'abcdefghijk1', 'instagram-reel')
    h.fail(
      new EngineError(ERROR_CODES.cancelled, 'The export was cancelled.', {
        kind: 'export',
        detail: 'cancelled',
        hint: 'The export was cancelled.',
      }),
    )
    await tick()
    expect(h.sent).toEqual([
      {
        channel: CHANNELS.exportSettled,
        payload: {
          id: 't1',
          ok: false,
          error: {
            code: ERROR_CODES.cancelled,
            message: 'The export was cancelled.',
            data: { kind: 'export', detail: 'cancelled', hint: 'The export was cancelled.' },
          },
        },
      },
    ])
  })
  it('cancels by token and ignores anything else', async () => {
    const h = harness()
    await h.call(CHANNELS.exportCancel, 't1')
    await h.call(CHANNELS.exportCancel, 42)
    expect(h.cancelled).toEqual(['t1'])
  })
  it('reveals the file a finished export wrote, and nothing for any other token', async () => {
    const h = harness()
    h.files.set('done', '/somewhere/Legible Cities/Los Angeles/reel.mp4')
    await h.call(CHANNELS.exportReveal, 'done')
    await h.call(CHANNELS.exportReveal, 'unknown')
    await h.call(CHANNELS.exportReveal, { not: 'a token' })
    expect(h.revealed).toEqual(['/somewhere/Legible Cities/Los Angeles/reel.mp4'])
  })
})
