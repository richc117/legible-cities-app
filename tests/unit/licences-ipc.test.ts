// The Licences section's bridge, main side (issue 108, specs/027, FR-004 and
// FR-005): four handlers behind the top-frame guard, fixed paths in the app
// whatever the page sends, nothing to open in a development run, and a
// notices file with no viewer shown in the file browser instead.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  licenceFiles,
  LicencesService,
  registerLicencesHandlers,
} from '../../src/main/licences-ipc'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const RESOURCES = join('/', 'Applications', 'Legible Cities.app', 'Contents', 'Resources')

function setUp(
  options: {
    packaged?: boolean
    present?: string[]
    failure?: string
    topFrame?: boolean
    platform?: string
  } = {},
) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  const opened: string[] = []
  const shown: string[] = []
  const platform = options.platform ?? 'darwin'
  const files = licenceFiles(RESOURCES, platform)
  const present = new Set(options.present ?? Object.values(files))
  registerLicencesHandlers(
    ipc,
    new LicencesService({
      packaged: options.packaged ?? true,
      resourcesPath: RESOURCES,
      platform,
      exists: (path) => present.has(path),
      openPath: async (path) => {
        opened.push(path)
        return options.failure ?? ''
      },
      showItemInFolder: (path) => shown.push(path),
      log: () => undefined,
    }),
    () => options.topFrame ?? true,
  )
  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return { call, opened, shown, files, handlers }
}

describe('the Licences bridge', () => {
  it('registers its four handlers on the shared channel names', () => {
    const { handlers } = setUp()
    const channels = Object.values(CHANNELS).filter((c) => c.startsWith('licences:'))
    expect(channels).toHaveLength(4)
    expect([...handlers.keys()].sort()).toEqual(channels.sort())
  })

  it("looks where electron-builder puts each: Chromium's licences beside the Windows executable", () => {
    const mac = licenceFiles(RESOURCES, 'darwin')
    expect(mac.notices).toBe(join(RESOURCES, 'THIRD_PARTY_NOTICES.md'))
    expect(mac.texts).toBe(join(RESOURCES, 'python', 'licenses'))
    expect(mac.chromium).toBe(join(RESOURCES, 'LICENSES.chromium.html'))
    const windows = licenceFiles(join('C:', 'Legible Cities', 'resources'), 'win32')
    expect(windows.chromium).toBe(join('C:', 'Legible Cities', 'LICENSES.chromium.html'))
    expect(windows.notices).toBe(
      join('C:', 'Legible Cities', 'resources', 'THIRD_PARTY_NOTICES.md'),
    )
  })

  it('says a development run has nothing bundled, and opens nothing there', async () => {
    const { call, opened, shown } = setUp({ packaged: false })
    expect(await call(CHANNELS.licencesRead)).toEqual({
      notices: 'development',
      texts: 'development',
      chromium: 'development',
    })
    await expect(call(CHANNELS.licencesOpenNotices)).rejects.toThrow(
      'The notices file is not bundled in a development run',
    )
    await expect(call(CHANNELS.licencesShowTexts)).rejects.toThrow(
      'The licence texts are not bundled in a development run',
    )
    await expect(call(CHANNELS.licencesOpenChromium)).rejects.toThrow(
      "Chromium's licences are not bundled in a development run",
    )
    expect(opened).toEqual([])
    expect(shown).toEqual([])
  })

  it('opens the fixed paths whatever the page sends', async () => {
    const { call, opened, files } = setUp()
    expect(await call(CHANNELS.licencesRead)).toEqual({
      notices: 'available',
      texts: 'available',
      chromium: 'available',
    })
    await call(CHANNELS.licencesOpenNotices, '/etc/passwd')
    await call(CHANNELS.licencesShowTexts, { path: '/' })
    await call(CHANNELS.licencesOpenChromium, 'https://example.invalid/')
    expect(opened).toEqual([files.notices, files.texts, files.chromium])
  })

  it('shows the notices file when nothing will open it, and says when the texts will not open', async () => {
    const { call, opened, shown, files } = setUp({ failure: 'No application is associated' })
    await call(CHANNELS.licencesOpenNotices)
    expect(opened).toEqual([files.notices])
    expect(shown).toEqual([files.notices])
    await expect(call(CHANNELS.licencesShowTexts)).rejects.toThrow(
      "The licence texts' folder could not be opened: No application is associated",
    )
  })

  it('names a file missing from a packaged app', async () => {
    const files = licenceFiles(RESOURCES, 'darwin')
    const { call, opened } = setUp({ present: [files.notices] })
    expect(await call(CHANNELS.licencesRead)).toEqual({
      notices: 'available',
      texts: 'missing',
      chromium: 'missing',
    })
    await expect(call(CHANNELS.licencesShowTexts)).rejects.toThrow(
      'The licence texts are missing from this installation.',
    )
    expect(opened).toEqual([])
  })

  it('answers only the interface’s own top frame', async () => {
    const { call, opened } = setUp({ topFrame: false })
    for (const channel of [
      CHANNELS.licencesRead,
      CHANNELS.licencesOpenNotices,
      CHANNELS.licencesShowTexts,
      CHANNELS.licencesOpenChromium,
    ]) {
      await expect(call(channel)).rejects.toThrow('forbidden')
    }
    expect(opened).toEqual([])
  })
})
