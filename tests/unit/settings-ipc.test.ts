// The settings bridge's main side. Three things are proved here: no path a
// page could name is ever stored, the reset is refused while anything is
// running or when the folder is not the app's to remove, and only the
// interface's own top frame can ask at all.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/settings'
import {
  registerSettingsHandlers,
  SettingsService,
  type SettingsDeps,
  type Which,
} from '../../src/main/settings-ipc'
import { CHANNELS } from '../../src/shared/api'
import type { FolderSource } from '../../src/shared/settings'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const roots: string[] = []

/** Where this run's stand-in app bundle sits; nothing may be stored inside it. */
const bundleOf = (root: string): string => join(root, 'bundle', 'Legible Cities.app')

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness(
  over: {
    sources?: Partial<Record<Which, FolderSource>>
    busy?: string | null
    /** What the chooser answers; a function so it can name a folder under this run's own root. */
    answer?: string | null | ((root: string) => string)
    topFrame?: boolean
    /** The export folder in force, for the reset's "not inside the home" rule. */
    exportFolder?: (root: string) => string
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'legible-cities-settings-ipc-'))
  roots.push(root)
  const userData = join(root, 'userData')
  await mkdir(userData, { recursive: true })
  const engineHome = join(userData, 'engine')
  const exportFolder = over.exportFolder?.(root) ?? join(root, 'desktop', 'Legible Cities')
  const bundle = bundleOf(root)
  const logsFolder = join(root, 'logs')
  const store = new SettingsStore(userData, () => undefined)
  await store.load()
  const opened: Which[] = []
  const shown: string[] = []
  const logs: string[] = []
  const deps: SettingsDeps = {
    store,
    engineHome,
    exportFolder,
    sources: { engine: 'default', export: 'default', ...over.sources },
    defaults: { engine: engineHome, export: exportFolder },
    chooseFolder: async (which) => {
      opened.push(which)
      if (over.answer === undefined) return join(root, 'chosen')
      return typeof over.answer === 'function' ? over.answer(root) : over.answer
    },
    busy: () => over.busy ?? null,
    openFolder: async (path) => {
      shown.push(path)
    },
    logsFolder: () => logsFolder,
    bundleRoots: [bundle],
    guards: { userData, homeDir: root },
    log: (m) => logs.push(m),
  }
  const settings = new SettingsService(deps)
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  registerSettingsHandlers(ipc, settings, () => over.topFrame ?? true)
  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return {
    settings,
    store,
    handlers,
    call,
    opened,
    shown,
    logs,
    root,
    userData,
    engineHome,
    exportFolder,
    bundle,
    logsFolder,
  }
}

describe('the handlers', () => {
  it('register every settings channel and nothing else', async () => {
    const h = await harness()
    const channels = Object.values(CHANNELS).filter((c) => c.startsWith('settings:'))
    expect([...h.handlers.keys()].sort()).toEqual(channels.sort())
  })

  it('refuse a caller that is not the interface top frame', async () => {
    const h = await harness({ topFrame: false })
    for (const channel of h.handlers.keys()) {
      await expect(h.call(channel), channel).rejects.toThrow('forbidden')
    }
  })

  it('answer the view with both folders, where each came from, and the theme', async () => {
    const h = await harness()
    expect(await h.call(CHANNELS.settingsRead)).toEqual({
      theme: 'system',
      engine: { path: h.engineHome, source: 'default', pending: null, locked: false },
      export: { path: h.exportFolder, source: 'default', pending: null, locked: false },
    })
  })
})

// The security-relevant part. The bridge takes no path at all, so the only
// way a page could name one is an argument on a call that does not want it;
// the guard behind the chooser refuses one anyway.
describe('a path the page did not get from a dialog', () => {
  it('is ignored: no settings call takes a path argument', async () => {
    const h = await harness()
    const invented = join(h.root, 'invented')
    for (const channel of [
      CHANNELS.settingsRead,
      CHANNELS.settingsEngineSize,
      CHANNELS.settingsChooseEngineFolder,
      CHANNELS.settingsChooseExportFolder,
    ]) {
      await h.call(channel, invented, { path: invented }, [invented])
    }
    // What was stored is what the chooser answered, never the argument.
    expect(h.store.current.engineFolder).toBe(join(h.root, 'chosen'))
    expect(h.store.current.exportFolder).toBe(join(h.root, 'chosen'))

    // And the two that clear a folder take none either: they clear it.
    for (const channel of [
      CHANNELS.settingsDefaultEngineFolder,
      CHANNELS.settingsDefaultExportFolder,
    ]) {
      await h.call(channel, invented)
    }
    expect(h.store.current.engineFolder).toBeNull()
    expect(h.store.current.exportFolder).toBeNull()
  })

  it('is refused by the guard behind the chooser', async () => {
    const h = await harness()
    const invented = join(h.root, 'invented')
    await expect(h.settings.apply('engine', invented)).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
    await expect(h.settings.apply('export', invented)).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
    expect(h.store.current.engineFolder, 'nothing was written').toBeNull()
  })

  it('is refused even when the dialog answered it for the other folder', async () => {
    const h = await harness()
    await h.call(CHANNELS.settingsChooseEngineFolder)
    const chosen = join(h.root, 'chosen')
    expect(h.store.current.engineFolder).toBe(chosen)
    // The engine's dialog answered it; the export's did not.
    await expect(h.settings.apply('export', chosen)).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
  })

  it('is spent by the one change it was answered for', async () => {
    const h = await harness()
    await h.call(CHANNELS.settingsChooseExportFolder)
    const chosen = join(h.root, 'chosen')
    expect(h.settings.exportFolderNow()).toBe(chosen)
    await expect(
      h.settings.apply('export', chosen),
      'a second time is a fresh claim',
    ).rejects.toThrow("a folder is chosen in the app's own dialog")
  })

  it('is refused when it is not a folder the app would ever store', async () => {
    const h = await harness()
    for (const value of ['relative/folder', '', null, 42, join(h.root, 'x') + '\u0000'])
      await expect(h.settings.apply('engine', value)).rejects.toThrow(
        "a folder is chosen in the app's own dialog",
      )
  })
})

// The chooser will make a folder anywhere the platform lets it, the app's
// own bundle included; the bundle is read-only on macOS and wiped on
// update, so nothing may be kept there whoever chose it (ADR-016).
describe('a folder inside the app itself', () => {
  it('is refused for either folder, and nothing is stored', async () => {
    for (const channel of [
      CHANNELS.settingsChooseEngineFolder,
      CHANNELS.settingsChooseExportFolder,
    ]) {
      // The app's own dialog answered it, so only the bundle rule can refuse it.
      const h = await harness({
        answer: (root) => join(bundleOf(root), 'Contents', 'Resources', 'data'),
      })
      await expect(h.call(channel), channel).rejects.toThrow(/inside the app itself/)
      expect(h.store.current.engineFolder).toBeNull()
      expect(h.store.current.exportFolder).toBeNull()
    }
  })

  it('is refused for the bundle folder itself', async () => {
    const h = await harness({ answer: (root) => bundleOf(root) })
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(
      /inside the app itself/,
    )
  })
})

describe('choosing a folder', () => {
  it('opens the platform dialog and applies its answer, showing the new folder', async () => {
    const h = await harness()
    const view = (await h.call(CHANNELS.settingsChooseExportFolder)) as {
      export: { path: string; source: string }
    }
    expect(h.opened).toEqual(['export'])
    expect(view.export).toMatchObject({ path: join(h.root, 'chosen'), source: 'settings' })
    expect(h.settings.exportFolderNow(), 'the next export goes there, with no restart').toBe(
      join(h.root, 'chosen'),
    )
  })

  it('changes nothing when the person cancelled', async () => {
    const h = await harness({ answer: null })
    const before = await h.call(CHANNELS.settingsRead)
    expect(await h.call(CHANNELS.settingsChooseEngineFolder)).toEqual(before)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it("says the engine's folder waits for a restart, and does not move the one in force", async () => {
    const h = await harness()
    const view = (await h.call(CHANNELS.settingsChooseEngineFolder)) as {
      engine: { path: string; pending: string | null }
    }
    expect(view.engine.path, 'the app still uses the folder it started on').toBe(h.engineHome)
    expect(view.engine.pending).toBe(join(h.root, 'chosen'))
  })

  it('goes back to the default, and says the engine waits for that too', async () => {
    const h = await harness()
    await h.call(CHANNELS.settingsChooseExportFolder)
    const back = (await h.call(CHANNELS.settingsDefaultExportFolder)) as {
      export: { path: string; source: string }
    }
    expect(back.export).toMatchObject({ path: h.exportFolder, source: 'default' })
    expect(h.store.current.exportFolder).toBeNull()
  })

  it('refuses to change a folder the environment names, and never opens a dialog for it', async () => {
    const h = await harness({ sources: { engine: 'environment' } })
    const view = (await h.call(CHANNELS.settingsRead)) as { engine: { locked: boolean } }
    expect(view.engine.locked).toBe(true)
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/SCHEMATIC_HOME/)
    await expect(h.call(CHANNELS.settingsDefaultEngineFolder)).rejects.toThrow(/SCHEMATIC_HOME/)
    expect(h.opened).toEqual([])
    // The export folder is still the app's to change.
    await h.call(CHANNELS.settingsChooseExportFolder)
    expect(h.opened).toEqual(['export'])
  })
})

describe('the logs folder', () => {
  it('is opened, and is the platform folder the app was given, never one the page named', async () => {
    const h = await harness()
    await h.call(CHANNELS.settingsOpenLogs, join(h.root, 'invented'))
    expect(h.shown).toEqual([h.logsFolder])
  })
})

describe('the theme', () => {
  it('is stored and answered', async () => {
    const h = await harness()
    const view = (await h.call(CHANNELS.settingsSetTheme, 'sepia')) as { theme: string }
    expect(view.theme).toBe('sepia')
    expect(h.store.current.theme).toBe('sepia')
  })

  it('is refused when it is not one of the three', async () => {
    const h = await harness()
    for (const value of ['dark', '', null, 7, { theme: 'sepia' }])
      await expect(h.call(CHANNELS.settingsSetTheme, value)).rejects.toThrow('that is not a theme')
    expect(h.store.current.theme).toBe('system')
  })
})

describe('resetting the engine data', () => {
  it('removes the folder and makes it again, empty', async () => {
    const h = await harness()
    // The default home sits under the user-data folder, beside the settings
    // file: the reset must take the one and leave the other.
    await h.call(CHANNELS.settingsSetTheme, 'sepia')
    await mkdir(join(h.engineHome, 'projects', 'p1'), { recursive: true })
    await writeFile(join(h.engineHome, 'projects', 'p1', 'project.json'), '{}')
    await h.call(CHANNELS.settingsResetEngineData)
    expect(await readdir(h.engineHome)).toEqual([])
    expect(await readdir(h.userData), 'the settings file is not inside it').toContain(
      'settings.json',
    )
  })

  it('refuses while an export or an engine request is running, and touches nothing', async () => {
    const h = await harness({ busy: 'An export is running; wait for it to finish.' })
    await mkdir(h.engineHome, { recursive: true })
    await writeFile(join(h.engineHome, 'keep.txt'), 'still here')
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/An export is running/)
    expect(await readdir(h.engineHome)).toEqual(['keep.txt'])
  })

  it('refuses a home the app would not remove, whatever the configuration says', async () => {
    const root = await mkdtemp(join(tmpdir(), 'legible-cities-settings-ipc-'))
    roots.push(root)
    const userData = join(root, 'userData')
    await mkdir(userData, { recursive: true })
    const store = new SettingsStore(userData, () => undefined)
    await store.load()
    // A home that holds the person's own folder: the shape of a setting
    // pointed at the wrong place, which is the only way this can happen.
    const settings = new SettingsService({
      store,
      engineHome: root,
      exportFolder: join(root, 'exports'),
      sources: { engine: 'settings', export: 'default' },
      defaults: { engine: join(userData, 'engine'), export: join(root, 'exports') },
      chooseFolder: async () => null,
      busy: () => null,
      openFolder: async () => undefined,
      logsFolder: () => join(root, 'logs'),
      bundleRoots: [],
      guards: { userData, homeDir: join(root, 'home') },
      log: () => undefined,
    })
    await expect(settings.resetEngineData()).rejects.toThrow(/home folder/)
    expect(await readdir(root), 'nothing was removed').toContain('userData')
  })

  // The confirmation promises that exported files are not touched. A person
  // whose export folder sits under the engine's home would lose them, so the
  // reset is refused rather than the promise broken.
  it('refuses while the export folder is inside the home it would remove', async () => {
    const h = await harness({ exportFolder: (root) => join(root, 'userData', 'engine', 'out') })
    await mkdir(h.engineHome, { recursive: true })
    await writeFile(join(h.engineHome, 'keep.txt'), 'still here')
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/export folder/)
    expect(await readdir(h.engineHome)).toEqual(['keep.txt'])
  })

  it('lets nothing start while it is removing the folder, and lifts that afterwards', async () => {
    const h = await harness()
    expect(h.settings.refuseWhileResetting(), 'nothing is refused when idle').toBeNull()
    await mkdir(h.engineHome, { recursive: true })
    const running = h.call(CHANNELS.settingsResetEngineData)
    expect(h.settings.resetting, 'raised for the length of the removal').toBe(true)
    expect(h.settings.refuseWhileResetting()).toMatch(/being reset/)
    await running
    expect(h.settings.resetting).toBe(false)
    expect(h.settings.refuseWhileResetting()).toBeNull()
  })

  it('measures the folder it would reset, and reports a missing one as missing', async () => {
    const h = await harness()
    expect(await h.call(CHANNELS.settingsEngineSize)).toMatchObject({ missing: true, files: 0 })
    await mkdir(h.engineHome, { recursive: true })
    await writeFile(join(h.engineHome, 'a.bin'), 'abcd')
    expect(await h.call(CHANNELS.settingsEngineSize)).toMatchObject({
      missing: false,
      files: 1,
      bytes: 4,
    })
  })
})
