import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerEngineHandlers, type EngineSource } from '../../src/main/engine-ipc'
import { registerExportHandlers, type ExportSource } from '../../src/main/export-ipc'
import { badCall, NO_ROOTS, redactShape, toShape, type PathRoots } from '../../src/main/ipc-shape'
import { CHANNELS, type EngineSettled } from '../../src/shared/api'
import { EngineError, ERROR_CODES, type EngineErrorShape } from '../../src/shared/engine'
import type { ExportPreview, ExportSettled } from '../../src/shared/export'
import { inUseSentence } from '../../src/main/feeds-ipc'

// The one door an error goes through on its way to the page (issue 207).
// Until v0.10.1 the engine named a failed download's whole URL in its
// error: `FeedError("{url} could not be fetched: {exc}")`, which the serve
// loop makes the message, the hint and the head of the detail. These are
// the engine's sentences as they were then, with a key in the query. The
// engine redacts a person's feed at source now (engine issue 32); this
// door stays, for an older engine's sentence and for anyone else's.

const URL_WITH_KEY = 'https://feeds.example.org/gtfs.zip?api_key=s3cret'
const SECRET = 's3cret'

const feedFailure = (): EngineError =>
  new EngineError(-32000, `${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden`, {
    kind: 'feed',
    hint: `${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden`,
    detail: `FeedError: ${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden (feeds.py:583)`,
  })

describe('an error on its way to the page', () => {
  it('carries no key in its message, its hint or its detail', () => {
    const shape = toShape(feedFailure())
    expect(shape.message).not.toContain(SECRET)
    expect(shape.data?.hint).not.toContain(SECRET)
    expect(shape.data?.detail).not.toContain(SECRET)
    // Redacted, not removed: the host and the path are what a person needs
    // to recognise which feed failed.
    expect(shape.data?.hint).toBe(
      'https://feeds.example.org/gtfs.zip?api_key=<redacted> could not be fetched: HTTP Error 403: Forbidden',
    )
  })

  it('keeps the code and the kind', () => {
    const shape = toShape(feedFailure())
    expect(shape.code).toBe(-32000)
    expect(shape.data?.kind).toBe('feed')
  })

  it('redacts an error that is not the engine’s, too', () => {
    const shape = toShape(new Error(`fetch failed for ${URL_WITH_KEY}`))
    expect(shape).toEqual({
      code: -32603,
      message: 'fetch failed for https://feeds.example.org/gtfs.zip?api_key=<redacted>',
    })
  })

  it('redacts user information and a fragment as the logs do', () => {
    const shape = toShape(
      new EngineError(-32000, 'x', {
        kind: 'feed',
        hint: 'https://me:pw@feeds.example.org/g.zip#tok did not return a zip (12 bytes)',
        detail: 'd',
      }),
    )
    expect(shape.data?.hint).toBe(
      'https://<redacted>@feeds.example.org/g.zip#<redacted> did not return a zip (12 bytes)',
    )
  })

  it('redacts the app’s own refusals on the same way out', () => {
    const answer = badCall(`nothing may be fetched from ${URL_WITH_KEY}`)
    expect(answer.accepted).toBe(false)
    const error = (answer as { error: ReturnType<typeof toShape> }).error
    for (const text of [error.message, error.data?.hint, error.data?.detail])
      expect(text).not.toContain(SECRET)
  })

  it('changes nothing at all in text with no ? # @ or %', () => {
    const plain = new EngineError(ERROR_CODES.badCall, 'a feed needs a source', {
      kind: 'params',
      hint: 'a feed needs a source',
      detail: 'the layout stage failed (topo.py:12)',
    })
    expect(toShape(plain)).toEqual(plain.toJSON())
  })

  it('leaves the error it was given as it was, for the log', () => {
    const error = feedFailure()
    redactShape(error.toJSON())
    toShape(error)
    expect(error.message).toContain(SECRET)
    expect(error.data?.hint).toContain(SECRET)
  })
})

describe('a person’s own text in a refusal', () => {
  it('comes through the page’s redaction whole, a project named like a path with a query included', () => {
    // Review of A5.6-06: a name quoted with curly quotes read as a path
    // whose query was the closing quote.
    const sentence = inUseSentence(['24/7?'])
    const answer = badCall(sentence)
    const error = (answer as { error: ReturnType<typeof toShape> }).error
    expect(error.data?.hint).toBe(sentence)
    expect(error.message).toBe(sentence)
  })

  it('comes through the paths’ removal whole, a name with a slash between two words included', () => {
    // The door takes paths out of the app's own refusals too since issue
    // 419, and a slash with a space after it starts no path. The bridges
    // always name their folders; with none, `withoutPaths` works alone.
    const sentence = inUseSentence(['LA / Metro', 'A/C/E', 'Line 1 / 2'])
    const error = (badCall(sentence, NO_ROOTS) as { error: EngineErrorShape }).error
    expect(error.data?.hint).toBe(sentence)
    expect(error.message).toBe(sentence)
  })
})

// Paths at the door (issue 419). Every path below is assembled from pieces
// at run time, so no literal path of a user's shape is committed:
// bin/preflight refuses one, and the commit hook runs it.
const HOME = ['C:', 'Users', 'Jane Doe'].join('\\')
const ENGINE_HOME = [HOME, 'AppData', 'Roaming', 'Legible Cities', 'engine'].join('\\')
const ROOTS: PathRoots = () => [HOME, ENGINE_HOME]
/** What no field on its way to the page may still hold of the paths above. */
const PARTS = /Jane|Doe|Users|AppData|Roaming/

/**
 * The engine's I/O failure as its `classify` writes one, about the home
 * folder itself: the hint and the message name it bare and last, the detail
 * quotes a file under the engine's home with its backslashes doubled, as
 * Python's `repr` does.
 */
const ioFailure = (): EngineError =>
  new EngineError(-32000, `Access is denied: ${HOME}`, {
    kind: 'io',
    hint: `Access is denied: ${HOME}`,
    detail: `PermissionError: [WinError 5] Access is denied: '${ENGINE_HOME.replace(/\\/g, '\\\\')}\\\\data\\\\feeds\\\\bart.zip' (feeds.py:12)`,
  })

const everyField = (shape: EngineErrorShape): string[] => [
  shape.message,
  shape.data?.hint ?? '',
  shape.data?.detail ?? '',
]

describe('a path on its way to the page', () => {
  it('leaves no part of a path under a known folder in the message, the hint or the detail', () => {
    const shape = toShape(ioFailure(), ROOTS)
    for (const text of everyField(shape)) expect(text).not.toMatch(PARTS)
    expect(shape.message).toBe('Access is denied: a file')
    expect(shape.data?.hint).toBe('Access is denied: a file')
    expect(shape.data?.detail).toBe(
      "PermissionError: [WinError 5] Access is denied: 'a file' (feeds.py:12)",
    )
    expect(shape.data?.kind).toBe('io')
  })

  it('leaves the error it was given as it was, paths and all, for the log', () => {
    const error = ioFailure()
    toShape(error, ROOTS)
    redactShape(error.toJSON(), ROOTS)
    expect(error.message).toContain(HOME)
    expect(error.data?.hint).toContain(HOME)
    expect(error.data?.detail).toContain('Jane Doe')
  })

  it('asks for the folders at each error, so a folder changed since is the one taken out', () => {
    let folder = ['D:', 'Maps', 'First'].join('\\')
    const roots: PathRoots = () => [folder]
    const said = (): Error => new Error(`could not write ${folder} today`)
    expect(toShape(said(), roots).message).toBe('could not write a file today')
    folder = ['D:', 'Maps', 'Second Folder'].join('\\')
    expect(toShape(said(), roots).message).toBe('could not write a file today')
  })

  it('answers even when the folders cannot be named, with the backstop alone', () => {
    const shape = toShape(ioFailure(), () => {
      throw new Error('no folders')
    })
    expect(shape.data?.detail).toBe(
      "PermissionError: [WinError 5] Access is denied: 'a file' (feeds.py:12)",
    )
  })

  it('takes paths out of the app’s own refusals too', () => {
    const answer = badCall(`nothing may be read from ${HOME}`, ROOTS)
    const error = (answer as { error: EngineErrorShape }).error
    for (const text of everyField(error)) expect(text).toBe('nothing may be read from a file')
  })
})

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

/** An `ipcMain` that keeps its handlers, and a call to one of them from the top frame. */
function fakeIpc() {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle: (channel: string, h: Handler) => handlers.set(channel, h),
  } as unknown as IpcMain
  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return { ipc, call }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('both bridges hand the door their folders', () => {
  it('the engine bridge: a request’s error, and a refusal before it is sent', async () => {
    const { ipc, call } = fakeIpc()
    const sent: { channel: string; payload: unknown }[] = []
    const engine: EngineSource = {
      state: { state: 'ready', version: '0.2.0', protocol: 1 },
      request: () => ({ id: 1, result: Promise.reject(ioFailure()) }),
      cancel: () => {},
      onState: () => () => {},
      onNotification: () => () => {},
    }
    registerEngineHandlers(
      ipc,
      engine,
      () => true,
      (channel, payload) => sent.push({ channel, payload }),
      () => {},
      async (method) => (method === 'feeds.remove' ? `the zip at ${HOME} is not yours` : null),
      ROOTS,
    )
    await call(CHANNELS.engineRequest, 'tok-1', 'map.build', {})
    await tick()
    const settled = sent.find((s) => s.channel === CHANNELS.engineSettled)?.payload as EngineSettled
    expect(settled.ok).toBe(false)
    const error = (settled as { error: EngineErrorShape }).error
    for (const text of everyField(error)) expect(text).not.toMatch(PARTS)

    const refused = (await call(CHANNELS.engineRequest, 'tok-2', 'feeds.remove', {})) as {
      error: EngineErrorShape
    }
    expect(refused.error.data?.hint).toBe('the zip at a file is not yours')
  })

  it('the export bridge: an export’s error, a start refused at once, and a preview’s refusal', async () => {
    const { ipc, call } = fakeIpc()
    const sent: { channel: string; payload: unknown }[] = []
    let fail!: (e: unknown) => void
    const exporter: ExportSource = {
      start: (token) => {
        if (token === 'refused') throw ioFailure()
        return {
          result: new Promise((_res, rej) => {
            fail = rej
          }),
        }
      },
      cancel: () => {},
      fileOf: () => null,
      onProgress: () => () => {},
      // The exporter shapes its own refusal, with no folders to hand.
      preview: async (): Promise<ExportPreview> => ({ ok: false, error: toShape(ioFailure()) }),
    }
    registerExportHandlers(
      ipc,
      exporter,
      () => true,
      (channel, payload) => sent.push({ channel, payload }),
      () => {},
      { choose: async () => ({}) as never, useAppFolder: async () => ({}) as never },
      () => null,
      ROOTS,
    )
    const reel = { preset: 'instagram-reel', options: {} }
    await call(CHANNELS.exportRun, 'tok-1', 'abcdefghijk1', reel)
    fail(ioFailure())
    await tick()
    const settled = sent.find((s) => s.channel === CHANNELS.exportSettled)?.payload as ExportSettled
    expect(settled.ok).toBe(false)
    for (const text of everyField((settled as { error: EngineErrorShape }).error))
      expect(text).not.toMatch(PARTS)

    const refused = (await call(CHANNELS.exportRun, 'refused', 'abcdefghijk1', reel)) as {
      error: EngineErrorShape
    }
    for (const text of everyField(refused.error)) expect(text).not.toMatch(PARTS)

    const preview = (await call(CHANNELS.exportPreview, 'abcdefghijk1', reel)) as ExportPreview
    expect(preview.ok).toBe(false)
    for (const text of everyField((preview as { error: EngineErrorShape }).error))
      expect(text).not.toMatch(PARTS)
  })
})
