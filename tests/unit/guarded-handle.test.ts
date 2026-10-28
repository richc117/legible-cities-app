import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { guardedHandle, type GuardedHandler } from '../../src/main/ipc-shape'

// The one guard in front of every bridge's handlers (issue 598). Until then
// `if (!isTopFrame(event)) throw new Error('forbidden')` was written at
// twelve sites across nine `*-ipc` files, each with its own wrapper. Each
// bridge's own test still holds its refusal; this holds the helper.

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function harness(top: boolean) {
  const listeners = new Map<string, Listener>()
  const ipc = {
    handle: (channel: string, listener: Listener) => listeners.set(channel, listener),
  } as unknown as IpcMain
  const asked: IpcMainInvokeEvent[] = []
  const handle = guardedHandle(ipc, (event) => {
    asked.push(event)
    return top
  })
  const calls: unknown[][] = []
  const handler: GuardedHandler = async (event, ...args) => {
    calls.push([event, ...args])
    return 'answered'
  }
  handle('test:channel', handler)
  const call = (event: IpcMainInvokeEvent, ...args: unknown[]) =>
    listeners.get('test:channel')!(event, ...args)
  return { listeners, asked, calls, call }
}

describe('guardedHandle', () => {
  it('registers the handler on the channel it is given', () => {
    const { listeners } = harness(true)
    expect([...listeners.keys()]).toEqual(['test:channel'])
  })

  it("refuses a call from anything but the interface's top frame with 'forbidden', before the handler is called", async () => {
    const { asked, calls, call } = harness(false)
    const event = { frame: 'an iframe' } as unknown as IpcMainInvokeEvent
    await expect(call(event, 'abc')).rejects.toThrow(/^forbidden$/)
    expect(asked, 'the guard was asked of the call it was handed').toEqual([event])
    expect(calls, 'and nothing of the work was done').toEqual([])
  })

  it('hands a call from the top frame to the handler, the event first and the arguments as sent', async () => {
    const { calls, call } = harness(true)
    const event = { frame: 'the top' } as unknown as IpcMainInvokeEvent
    await expect(call(event, 'abc', 2, { x: 1 })).resolves.toBe('answered')
    expect(calls).toEqual([[event, 'abc', 2, { x: 1 }]])
  })

  it('reaches the handler in the turn it was called, with nothing awaited first', () => {
    // The record session rests on this: a `projects:*` handler reaches the
    // store in the turn it is handed its message (spec 037).
    const { calls, call } = harness(true)
    void call({} as IpcMainInvokeEvent)
    expect(calls).toHaveLength(1)
  })

  it('is the only guard: no bridge under src/main/ writes its own', () => {
    const root = join(__dirname, '..', '..', 'src', 'main')
    const own = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && file !== 'ipc-shape.ts')
      .filter((file) =>
        /isTopFrame\(event\)|new Error\('forbidden'\)/.test(readFileSync(join(root, file), 'utf8')),
      )
    expect(own).toEqual([])
    // And the pattern still finds the one it is about.
    expect(readFileSync(join(root, 'ipc-shape.ts'), 'utf8')).toMatch(
      /if \(!isTopFrame\(event\)\) throw new Error\('forbidden'\)/,
    )
  })
})
