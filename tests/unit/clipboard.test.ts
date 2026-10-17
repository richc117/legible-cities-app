// A copy waits for the clipboard (issue 432, R5-05): a rejected write reaches
// the page as a refusal, never as success, at all three call sites' shared door.

import { afterEach, describe, expect, it } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { writeClipboard } from '../../src/main/clipboard'
import { setSink, toStderr } from '../../src/main/log'
import { registerClipboardHandler } from '../../src/main/ipc'
import { copyJobLog } from '../../src/main/jobs-ipc'

afterEach(() => setSink(toStderr))

const rejecting = (): Promise<void> => Promise.reject(new Error('EACCES: denied'))

describe('writeClipboard', () => {
  it('waits for the write', async () => {
    const order: string[] = []
    await writeClipboard(async () => {
      await new Promise((r) => setTimeout(r, 5))
      order.push('written')
    }, 'x')
    order.push('returned')
    expect(order).toEqual(['written', 'returned'])
  })

  it('refuses with a sentence of ours, never the platform message', async () => {
    setSink(() => undefined)
    await expect(writeClipboard(rejecting, 'x')).rejects.toThrow('the text could not be copied')
  })
})

describe('the bridge and the job log', () => {
  it('the clipboard bridge refuses when the write rejects', async () => {
    setSink(() => undefined)
    let handler: (e: IpcMainInvokeEvent, raw: unknown) => Promise<void> = async () => undefined
    const ipc = {
      handle: (_c: string, h: typeof handler) => (handler = h),
    } as unknown as IpcMain
    registerClipboardHandler(ipc, rejecting, () => true)
    await expect(handler({} as IpcMainInvokeEvent, 'hello')).rejects.toThrow(/could not be copied/)
  })

  it('Copy log refuses when the write rejects', async () => {
    setSink(() => undefined)
    const logs: string[] = []
    await expect(
      copyJobLog('a line', {
        homes: async () => [],
        platform: 'linux',
        writeText: rejecting,
        log: (m) => logs.push(m),
      }),
    ).rejects.toThrow(/could not be copied/)
    expect(logs, 'no "copied" line for a copy that failed').toEqual([])
  })
})
