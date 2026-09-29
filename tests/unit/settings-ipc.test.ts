// The settings bridge's main side. Three things are proved here: no path a
// page could name is ever stored, the reset is refused while anything is
// running or when the folder is not the app's to remove, and only the
// interface's own top frame can ask at all.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOG_WAIT_MS } from '../../src/main/log-file'
import { ProjectStore } from '../../src/main/projects'
import { WINDOWS_RETRY_CODES, type ReplaceOptions } from '../../src/main/replace-file'
import { SettingsStore, type ProjectDestination } from '../../src/main/settings'
import {
  ENGINE_INFO_TIMEOUT_MS,
  HOMES_TIMEOUT_MS,
  registerSettingsHandlers,
  SettingsService,
  type SettingsDeps,
  type Which,
} from '../../src/main/settings-ipc'
import { CHANNELS } from '../../src/shared/api'
import type { FolderSource, ResetOutcome } from '../../src/shared/settings'
import type { FirstRunResult } from '../../src/shared/first-run'

/** A check that found LOOM missing and ffmpeg running, as the copy says it (A6-02). */
const FIRST_RUN: FirstRunResult = {
  finished: true,
  loom: {
    outcome: 'failed',
    kind: 'missing',
    sentence: 'The bundled LOOM tools are missing, so maps cannot be laid out.',
    detail: 'There is no LOOM folder at …/loom.',
    ms: 1,
  },
  ffmpeg: { outcome: 'passed', ms: 9 },
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const roots: string[] = []

/** The facts Electron would give, fixed so the copy's order can be read. */
const ABOUT = {
  app: { name: 'Legible Cities', version: '0.0.0' },
  versions: { electron: '42.0.0', chrome: '140.0.0.0', node: '24.0.0' },
  os: { type: 'Linux', release: '6.0.0', arch: 'x64' },
}

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
    /** The engine home, for a home that is a link rather than a folder. */
    engineHome?: (root: string) => string
    /** The default engine home, for one that differs from the home in force. */
    defaultEngine?: (root: string) => string
    /**
     * Something in front of the project store's own answer: a delay, a
     * failure. It is handed the real read and which call this is, from 1.
     */
    destinations?: (
      read: () => Promise<ProjectDestination[]>,
      call: number,
    ) => Promise<ProjectDestination[]>
    /** The person's own folder, which the reset must never reach. */
    homeDir?: (root: string) => string
    /** The engine's `engine.info`, for the diagnostics copy. */
    engineInfo?: () => Promise<unknown>
    /** The logs' flush before the copy reads their tails. */
    flushLogs?: () => Promise<void>
    /** The home folders the copy hides: the home as named first, then a real path if it differs. */
    homes?: (root: string) => string[]
    /** The home through its links, for one that never answers. */
    realHome?: () => Promise<string>
    /** The short-form lookups, for one that never answers. */
    shortHomes?: () => Promise<string | null>[]
    platform?: string
    /** Where the log files are, for a log folder under the fake home. */
    logsFolder?: (root: string) => string
    /** The settings file's rename and its retry, for a file the platform holds. */
    replace?: ReplaceOptions
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'legible-cities-settings-ipc-'))
  roots.push(root)
  const userData = join(root, 'userData')
  await mkdir(userData, { recursive: true })
  const engineHome = over.engineHome?.(root) ?? join(userData, 'engine')
  const exportFolder = over.exportFolder?.(root) ?? join(root, 'desktop', 'Legible Cities')
  const bundle = bundleOf(root)
  const logsFolder = over.logsFolder?.(root) ?? join(root, 'logs')
  const store = new SettingsStore(userData, () => undefined, over.replace)
  await store.load()
  // The real project store, on the home in force as the app builds it
  // (issue 206): the guard over the projects' export folders is proved
  // against the records it will really read, never against a stand-in.
  const projects = new ProjectStore(engineHome, () => undefined)
  /** Whether a reset was running each time the projects were read. */
  const asked: boolean[] = []
  const opened: Which[] = []
  const shown: string[] = []
  const logs: string[] = []
  const copied: string[] = []
  const deps: SettingsDeps = {
    store,
    engineHome,
    exportFolder,
    sources: { engine: 'default', export: 'default', ...over.sources },
    defaults: { engine: over.defaultEngine?.(root) ?? engineHome, export: exportFolder },
    chooseFolder: async (which) => {
      opened.push(which)
      if (over.answer === undefined) return join(root, 'chosen')
      return typeof over.answer === 'function' ? over.answer(root) : over.answer
    },
    busy: () => over.busy ?? null,
    destinations: () => {
      asked.push(settings.resetting)
      const read = (): Promise<ProjectDestination[]> => projects.destinations()
      return over.destinations === undefined ? read() : over.destinations(read, asked.length)
    },
    openFolder: async (path) => {
      shown.push(path)
    },
    logsFolder: () => logsFolder,
    bundleRoots: [bundle],
    guards: { userData, homeDir: over.homeDir?.(root) ?? root },
    diagnostics: {
      about: () => ABOUT,
      engineInfo: over.engineInfo ?? (async () => ({ engine: '0.0.0-test', protocol: 1 })),
      firstRun: () => FIRST_RUN,
      flushLogs: over.flushLogs ?? (async () => undefined),
      home: over.homes?.(root)[0] ?? root,
      realHome:
        over.realHome ?? (async () => over.homes?.(root)[1] ?? over.homes?.(root)[0] ?? root),
      shortHomes: over.shortHomes ?? (() => []),
      platform: over.platform ?? 'linux',
      writeText: (text) => copied.push(text),
    },
    log: (m) => logs.push(m),
  }
  const settings: SettingsService = new SettingsService(deps)
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  registerSettingsHandlers(ipc, settings, () => over.topFrame ?? true)
  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  return {
    settings,
    store,
    projects,
    asked,
    handlers,
    call,
    opened,
    shown,
    logs,
    copied,
    root,
    userData,
    engineHome,
    exportFolder,
    bundle,
    logsFolder,
  }
}

/** A project in the harness's own store that exports to a folder of its own (A5.5-19). */
async function exporting(
  h: { projects: ProjectStore },
  name: string,
  folder: string,
): Promise<string> {
  const project = await h.projects.create({ name, feed: 'la-metro-rail' })
  await h.projects.setDestination(project.id, folder)
  return project.id
}

/** What a call was refused with, or null when it was not refused. */
async function refusalOf(call: Promise<unknown>): Promise<string | null> {
  try {
    await call
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
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

// On Windows a write can retry its rename for over a second (issue 93), so
// two changes a person makes in that time must each see the other: the check
// for "has it changed?" and the fields left alone are read in the store's
// queue, not from settings a pending write has not updated yet.
describe('two changes while the settings file is held', () => {
  /** A rename refused `times` times for a file whose written settings match `held`, then the real one. */
  function holding(held: (written: Record<string, unknown>) => boolean, times = 3, code = 'EPERM') {
    let refused = 0
    const replace: ReplaceOptions = {
      rename: async (from, to) => {
        const written = JSON.parse(await readFile(from, 'utf8')) as Record<string, unknown>
        if (held(written) && refused < times) {
          refused += 1
          throw Object.assign(new Error(`${code}: held, rename '${to}'`), { code })
        }
        await rename(from, to)
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      codes: WINDOWS_RETRY_CODES,
    }
    return { replace, refused: () => refused }
  }

  const onDisk = async (h: { userData: string }): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(h.userData, 'settings.json'), 'utf8'))

  it('keeps a press back to the stored theme made while the press before it retries', async () => {
    const hold = holding((written) => written.theme === 'sepia')
    const h = await harness({ replace: hold.replace })
    expect(h.store.current.theme).toBe('system')
    const first = h.settings.setTheme('sepia')
    const back = h.settings.setTheme('system')
    // Still retrying: what is in force is what has landed.
    expect(h.store.current.theme).toBe('system')
    await Promise.all([first, back])
    expect(hold.refused(), 'the first press was held').toBe(3)
    expect((await onDisk(h)).theme).toBe('system')
    expect(h.store.current.theme).toBe('system')
  })

  it('keeps both a folder and a theme chosen at the same moment', async () => {
    const hold = holding((written) => written.theme === 'sepia')
    const h = await harness({ replace: hold.replace })
    const theme = h.settings.setTheme('sepia')
    const folder = h.settings.choose('export')
    const [, view] = await Promise.all([theme, folder])
    expect(hold.refused()).toBe(3)
    const stored = await onDisk(h)
    expect(stored.theme).toBe('sepia')
    expect(stored.exportFolder).toBe(join(h.root, 'chosen'))
    expect(h.store.current).toMatchObject({ theme: 'sepia', exportFolder: join(h.root, 'chosen') })
    expect(view.export.path).toBe(join(h.root, 'chosen'))
  })

  it('writes the next change after one that failed', async () => {
    const hold = holding((written) => written.theme === 'sepia', Infinity, 'EXDEV')
    const h = await harness({ replace: hold.replace })
    await expect(h.settings.setTheme('sepia')).rejects.toThrow('the settings could not be saved')
    expect(h.store.current.theme, 'a failed write is not in force').toBe('system')
    const failed = h.settings.setTheme('sepia')
    const next = h.settings.useDefault('export')
    const last = h.settings.setTheme('warm-dark')
    await expect(failed).rejects.toThrow('the settings could not be saved')
    await expect(next).resolves.toBeDefined()
    await expect(last).resolves.toMatchObject({ theme: 'warm-dark' })
    expect((await onDisk(h)).theme).toBe('warm-dark')
  })
})

// Issue 206. A project can export to a folder of its own, and a reset
// removes folders beneath the engine's home, so the two must never overlap.
// The records live under the home in force and do not move with it, so the
// choice of a new home is the last moment the app can see the project that
// exports there. Everything here runs the real project store, the real
// path resolution and the real comparison; only the dialog is stood in for.
describe('choosing the engine folder while a project exports to a folder of its own', () => {
  it('refuses a folder that holds the project’s export folder, naming the project and no path, and stores nothing', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    await exporting(h, 'Los Angeles', join(h.root, 'videos', 'exports'))
    const refusal = await refusalOf(h.call(CHANNELS.settingsChooseEngineFolder))
    expect(refusal).toBe(
      'The project “Los Angeles” exports to a folder inside that one, or around it, so “Reset engine data” could remove its exports; choose another folder, or change where the project exports first.',
    )
    expect(refusal, 'a sentence for the screen names no folder').not.toContain(h.root)
    expect(h.store.current.engineFolder, 'nothing was stored').toBeNull()
    const view = (await h.call(CHANNELS.settingsRead)) as { engine: { pending: string | null } }
    expect(view.engine.pending, 'and nothing waits for a restart').toBeNull()
    // The dialog's answer was spent by the refusal, as by any other outcome.
    await expect(h.settings.apply('engine', join(h.root, 'videos'))).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
  })

  it('refuses a folder that sits inside the project’s export folder', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos', 'engine') })
    await exporting(h, 'Los Angeles', join(h.root, 'videos'))
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/“Los Angeles”/)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it('refuses the project’s export folder itself', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    await exporting(h, 'Los Angeles', join(h.root, 'videos'))
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/“Los Angeles”/)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it('takes a folder no project exports into or around, a neighbour whose name begins the same included', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    await exporting(h, 'Los Angeles', join(h.root, 'videos-2025', 'exports'))
    await exporting(h, 'Bart', join(h.root, 'elsewhere'))
    // And a project that exports to the app's folder has nothing to be in the way with.
    await h.projects.create({ name: 'Caltrain', feed: 'la-metro-rail' })
    const view = (await h.call(CHANNELS.settingsChooseEngineFolder)) as {
      engine: { pending: string | null }
    }
    expect(view.engine.pending).toBe(join(h.root, 'videos'))
    expect(h.store.current.engineFolder).toBe(join(h.root, 'videos'))
  })

  // The comparison is textual. Without the real path of each side, a folder
  // chosen through a link passes it and the app starts on the very folder
  // the project exports into.
  it('refuses a folder that is a link to where the project exports', async () => {
    const h = await harness({ answer: (root) => join(root, 'shortcut') })
    const videos = join(h.root, 'videos')
    await mkdir(join(videos, 'exports'), { recursive: true })
    await exporting(h, 'Los Angeles', join(videos, 'exports'))
    try {
      await symlink(videos, join(h.root, 'shortcut'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/“Los Angeles”/)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it('refuses a folder the project exports into through a link', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    await mkdir(join(h.root, 'videos', 'exports'), { recursive: true })
    try {
      await symlink(join(h.root, 'videos', 'exports'), join(h.root, 'shortcut'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }
    await exporting(h, 'Los Angeles', join(h.root, 'shortcut'))
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/“Los Angeles”/)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it('counts a project a newer version of the app made, which is read-only here', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    const id = await exporting(h, 'From next year', join(h.root, 'videos', 'exports'))
    const file = join(h.engineHome, 'projects', id, 'project.json')
    const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...record, version: 99 }), 'utf8')
    expect((await h.projects.get(id)).readOnly, 'this build may not write it').toBe(true)
    await expect(h.call(CHANNELS.settingsChooseEngineFolder)).rejects.toThrow(/“From next year”/)
    expect(h.store.current.engineFolder).toBeNull()
  })

  it('names two or three projects, and past that two and how many more', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    for (const name of ['Bart', 'Caltrain', 'Los Angeles', 'Metra']) {
      await exporting(h, name, join(h.root, 'videos', name))
    }
    expect(await refusalOf(h.call(CHANNELS.settingsChooseEngineFolder))).toBe(
      'The projects “Bart”, “Caltrain” and 2 others export to folders inside that one, or around it, so “Reset engine data” could remove their exports; choose another folder, or change where they export first.',
    )
  })

  it('refuses the default folder on the same rule, in its own words, and keeps the folder that was stored', async () => {
    const h = await harness({
      defaultEngine: (root) => join(root, 'default-home'),
      sources: { engine: 'settings' },
    })
    await h.call(CHANNELS.settingsChooseEngineFolder)
    expect(h.store.current.engineFolder).toBe(join(h.root, 'chosen'))
    await exporting(h, 'Los Angeles', join(h.root, 'default-home', 'out', 'exports'))
    expect(await refusalOf(h.call(CHANNELS.settingsDefaultEngineFolder))).toBe(
      'The project “Los Angeles” exports to a folder inside the default folder, or around it, so “Reset engine data” could remove its exports; change where the project exports first.',
    )
    expect(h.store.current.engineFolder, 'the stored folder was not cleared').toBe(
      join(h.root, 'chosen'),
    )
    // Once the project exports somewhere else, the default is taken again.
    const [{ id }] = await h.projects.destinations()
    await h.projects.setDestination(id, null)
    await h.call(CHANNELS.settingsDefaultEngineFolder)
    expect(h.store.current.engineFolder).toBeNull()
  })

  // What this door cannot see, said in a test so nobody takes the guard for
  // more than it is: the store reads the records under the home in force.
  it('does not see a project whose record was left behind in a previous home: a folder it exports to is taken', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    const previous = new ProjectStore(join(h.root, 'previous-home'), () => undefined)
    const left = await previous.create({ name: 'Los Angeles', feed: 'la-metro-rail' })
    await previous.setDestination(left.id, join(h.root, 'videos'))
    await h.call(CHANNELS.settingsChooseEngineFolder)
    expect(h.store.current.engineFolder).toBe(join(h.root, 'videos'))
  })

  it('reads the projects once at a press, and not at all for the export folder', async () => {
    const h = await harness({ answer: (root) => join(root, 'videos') })
    await exporting(h, 'Los Angeles', join(h.root, 'elsewhere'))
    await exporting(h, 'Bart', join(h.root, 'elsewhere', 'bart'))
    await h.call(CHANNELS.settingsChooseExportFolder)
    await h.call(CHANNELS.settingsDefaultExportFolder)
    expect(h.asked, 'the export folder is not the reset’s to remove').toEqual([])
    await h.call(CHANNELS.settingsChooseEngineFolder)
    expect(h.asked).toHaveLength(1)
    await h.call(CHANNELS.settingsDefaultEngineFolder)
    expect(h.asked).toHaveLength(2)
  })

  // Each change reads the disk before it writes, so without a queue two
  // presses would be written in the order their reads finished.
  it('writes two changes in the order they were pressed, however long each took to read the projects', async () => {
    let reading = (): void => undefined
    const firstIsReading = new Promise<void>((resolve) => {
      reading = resolve
    })
    const h = await harness({
      destinations: async (read, call) => {
        // The first press reads slowly; the one after it, at once.
        if (call === 1) {
          reading()
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return read()
      },
    })
    const chosen = h.call(CHANNELS.settingsChooseEngineFolder)
    // The dialog has answered and its folder is being checked: only now
    // can a person press anything else, the dialog being modal.
    await firstIsReading
    const back = h.call(CHANNELS.settingsDefaultEngineFolder)
    await Promise.all([chosen, back])
    expect(h.store.current.engineFolder, 'the last press was "Use the default"').toBeNull()
    expect(JSON.parse(await readFile(join(h.userData, 'settings.json'), 'utf8'))).toMatchObject({
      engineFolder: null,
    })
  })

  it('refuses in its own words, never the filesystem’s, when the projects cannot be read', async () => {
    const where = (root: string): string => join(root, 'userData', 'engine', 'projects')
    const h = await harness({
      destinations: async () => {
        throw Object.assign(new Error(`EIO: i/o error, scandir '${where(h.root)}'`), {
          code: 'EIO',
        })
      },
    })
    const refusal = await refusalOf(h.call(CHANNELS.settingsChooseEngineFolder))
    expect(refusal).toBe(
      'the projects could not be read, so the app cannot tell whether one of them exports there; try again',
    )
    expect(h.store.current.engineFolder, 'a folder nobody could check is not stored').toBeNull()
    expect(h.logs.join('\n')).toContain('(EIO)')
    expect(h.logs.join('\n'), 'and the log names no folder either').not.toContain(h.root)
    // One that failed does not hold up the next.
    await expect(h.call(CHANNELS.settingsSetTheme, 'sepia')).resolves.toBeDefined()
  })
})

describe('resetting the engine data', () => {
  it("removes the four folders and leaves the home and a person's own files", async () => {
    const h = await harness()
    // The default home sits under the user-data folder, beside the settings
    // file: the reset must take the one and leave the other.
    await h.call(CHANNELS.settingsSetTheme, 'sepia')
    await mkdir(join(h.engineHome, 'projects', 'p1'), { recursive: true })
    await writeFile(join(h.engineHome, 'projects', 'p1', 'project.json'), '{}')
    // A file the app never put there. Without it this test passes just as
    // well when the home is removed whole, which is the bug it exists for.
    await writeFile(join(h.engineHome, 'notes.txt'), 'mine')

    const outcome = (await h.call(CHANNELS.settingsResetEngineData)) as ResetOutcome
    expect(outcome.removed).toEqual(['projects'])
    expect(await readdir(h.engineHome), 'the home stayed, and so did the file').toEqual([
      'notes.txt',
    ])
    expect(await readFile(join(h.engineHome, 'notes.txt'), 'utf8')).toBe('mine')
    expect(await readdir(h.userData), 'the settings file is not inside it').toContain(
      'settings.json',
    )
  })

  // The guards compare text, so a home that is itself a link passes every
  // one of them and then reaches through to whatever it points at. The
  // reset resolves the home first and judges what it really is.
  it('refuses a home that is a symbolic link to the person’s own folder', async () => {
    // The home is a link; the person's own folder is at the other end, with
    // a projects folder of their own in it.
    const h = await harness({
      engineHome: (root) => join(root, 'cities'),
      homeDir: (root) => join(root, 'somebody'),
    })
    const real = join(h.root, 'somebody')
    await mkdir(join(real, 'projects'), { recursive: true })
    await writeFile(join(real, 'projects', 'work.txt'), 'mine')
    try {
      await symlink(real, join(h.root, 'cities'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/your home folder/)
    expect(await readdir(join(real, 'projects')), 'nothing was removed').toEqual(['work.txt'])
  })

  // Two at once both pass every check; the first to finish lowers the flag
  // while the second is still walking, letting every writer back into a
  // folder being removed.
  it('refuses a second reset while the first is still running', async () => {
    const h = await harness()
    await mkdir(join(h.engineHome, 'projects'), { recursive: true })
    const first = h.call(CHANNELS.settingsResetEngineData)
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/being reset/)
    await first
    expect(h.settings.resetting, 'the flag came down once, not twice').toBe(false)
    // And a reset is possible again afterwards.
    await expect(h.call(CHANNELS.settingsResetEngineData)).resolves.toBeTruthy()
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
      destinations: async () => [],
      openFolder: async () => undefined,
      logsFolder: () => join(root, 'logs'),
      bundleRoots: [],
      guards: { userData, homeDir: join(root, 'home') },
      diagnostics: {
        about: () => ABOUT,
        engineInfo: async () => ({}),
        firstRun: () => FIRST_RUN,
        flushLogs: async () => undefined,
        home: root,
        realHome: async () => root,
        shortHomes: () => [],
        platform: 'linux',
        writeText: () => undefined,
      },
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

  // Issue 206. The same promise, for a folder a project chose for itself:
  // the real store on the home in force, the real paths, the real removal.
  it('refuses while a project in this home exports into a folder the reset removes, naming it, and removes nothing', async () => {
    const h = await harness()
    const exports = join(h.engineHome, 'out', 'exports')
    const id = await exporting(h, 'Los Angeles', exports)
    await mkdir(join(exports, 'Los Angeles'), { recursive: true })
    await writeFile(join(exports, 'Los Angeles', 'reel.mp4'), 'an export')
    const refusal = await refusalOf(h.call(CHANNELS.settingsResetEngineData))
    expect(refusal).toBe(
      'The project “Los Angeles” exports to a folder inside the engine data folder, or around it, so the reset could remove its exports; change where the project exports first.',
    )
    expect(refusal, 'a sentence for the screen names no folder').not.toContain(h.root)
    expect(await readFile(join(exports, 'Los Angeles', 'reel.mp4'), 'utf8')).toBe('an export')
    expect(await readdir(join(h.engineHome, 'projects')), 'the record is still there').toEqual([id])
    expect(h.settings.resetting, 'and the flag came down with the refusal').toBe(false)
    // Once the project exports somewhere else, the reset runs.
    await h.projects.setDestination(id, join(h.root, 'videos'))
    const outcome = (await h.call(CHANNELS.settingsResetEngineData)) as ResetOutcome
    expect(outcome.removed.sort()).toEqual(['out', 'projects'])
  })

  it('refuses while a project in this home exports to the home itself, or to a folder that holds it', async () => {
    for (const folder of [
      (h: { engineHome: string }) => h.engineHome,
      (h: { userData: string }) => h.userData,
    ]) {
      const h = await harness()
      // An export goes to <folder>/<project name>/, so this one's lands in out/.
      await exporting(h, 'out', folder(h))
      await mkdir(join(h.engineHome, 'out'), { recursive: true })
      await writeFile(join(h.engineHome, 'out', 'reel.mp4'), 'an export')
      await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/The project “out”/)
      expect(await readdir(join(h.engineHome, 'out')), 'nothing was removed').toEqual(['reel.mp4'])
    }
  })

  it('refuses while a project exports into the home through a link', async () => {
    const h = await harness()
    const exports = join(h.engineHome, 'out', 'exports')
    await mkdir(exports, { recursive: true })
    await writeFile(join(exports, 'reel.mp4'), 'an export')
    try {
      await symlink(exports, join(h.root, 'shortcut'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }
    await exporting(h, 'Los Angeles', join(h.root, 'shortcut'))
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/“Los Angeles”/)
    expect(await readdir(exports), 'nothing was removed').toEqual(['reel.mp4'])
  })

  it('refuses while the home is a link and a project exports beneath where it points', async () => {
    const h = await harness({ engineHome: (root) => join(root, 'cities') })
    const real = join(h.root, 'somewhere', 'engine')
    await mkdir(join(real, 'out', 'exports'), { recursive: true })
    await writeFile(join(real, 'out', 'exports', 'reel.mp4'), 'an export')
    try {
      await symlink(real, join(h.root, 'cities'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }
    await exporting(h, 'Los Angeles', join(real, 'out', 'exports'))
    await expect(h.call(CHANNELS.settingsResetEngineData)).rejects.toThrow(/“Los Angeles”/)
    expect(await readdir(join(real, 'out', 'exports')), 'nothing was removed').toEqual(['reel.mp4'])
  })

  it('leaves alone a project that exports somewhere the reset does not reach, and one that chose no folder', async () => {
    const h = await harness()
    await exporting(h, 'Los Angeles', join(h.root, 'videos'))
    // A neighbour of the home whose name begins the same is not inside it.
    await exporting(h, 'Bart', `${h.engineHome}-exports`)
    await h.projects.create({ name: 'Caltrain', feed: 'la-metro-rail' })
    const outcome = (await h.call(CHANNELS.settingsResetEngineData)) as ResetOutcome
    expect(outcome.removed).toEqual(['projects'])
  })

  // What this door cannot see, said in a test so nobody takes the guard for
  // more than it is. This is the scenario issue 206 was filed with, after
  // its restart: the home was pointed at the folder a project exports to,
  // and the project's record stayed in the home before. The choice of the
  // folder is where that is refused now; here nothing can read the record.
  it('does not see a project whose record was left behind in a previous home: that reset is not refused', async () => {
    const h = await harness({ engineHome: (root) => join(root, 'videos') })
    const previous = new ProjectStore(join(h.root, 'previous-home'), () => undefined)
    const left = await previous.create({ name: 'out', feed: 'la-metro-rail' })
    await previous.setDestination(left.id, join(h.root, 'videos'))
    await mkdir(join(h.root, 'videos', 'out'), { recursive: true })
    await writeFile(join(h.root, 'videos', 'out', 'reel.mp4'), 'an export')
    const outcome = (await h.call(CHANNELS.settingsResetEngineData)) as ResetOutcome
    expect(outcome.removed, 'the export went with the folder').toEqual(['out'])
    expect(await previous.destinations(), 'and its record was never read').toEqual([
      { id: left.id, name: 'out', destination: join(h.root, 'videos') },
    ])
  })

  it('reads the projects once for a reset, and only while the flag is up', async () => {
    const h = await harness()
    await exporting(h, 'Los Angeles', join(h.root, 'videos'))
    await exporting(h, 'Bart', join(h.root, 'videos', 'bart'))
    await h.call(CHANNELS.settingsResetEngineData)
    expect(h.asked, 'one read, made while nothing else could write').toEqual([true])
    expect(h.settings.resetting).toBe(false)
  })

  it('refuses when the projects cannot be read, in its own words, and removes nothing', async () => {
    const h = await harness({
      destinations: async () => {
        throw Object.assign(new Error(`EIO: i/o error, scandir '${h.engineHome}'`), {
          code: 'EIO',
        })
      },
    })
    await mkdir(join(h.engineHome, 'out'), { recursive: true })
    await writeFile(join(h.engineHome, 'out', 'reel.mp4'), 'an export')
    const refusal = await refusalOf(h.call(CHANNELS.settingsResetEngineData))
    expect(refusal).toBe(
      'the projects could not be read, so the app cannot tell whether one of them exports there; try again',
    )
    expect(await readdir(join(h.engineHome, 'out')), 'nothing was removed').toEqual(['reel.mp4'])
    expect(h.settings.resetting).toBe(false)
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

// "Copy diagnostics" (A6-03): the one settings call that takes something
// from the page, and the one whose output a person pastes in public.
describe('copying diagnostics', () => {
  it('puts the versions, the engine, both logs and the reports on the clipboard, in order', async () => {
    const h = await harness()
    await mkdir(h.logsFolder, { recursive: true })
    await writeFile(join(h.logsFolder, 'main.log'), 'a main line\n')
    await writeFile(join(h.logsFolder, 'engine.log'), 'an engine line\n')
    await h.call(CHANNELS.settingsCopyDiagnostics, ['Los Angeles — the map drawn for 2026-09-12'])
    expect(h.copied).toHaveLength(1)
    const text = h.copied[0]
    const order = [
      'Legible Cities 0.0.0',
      'Electron 42.0.0',
      'Chromium 140.0.0.0',
      'Node 24.0.0',
      'Linux 6.0.0 (x64)',
      '"engine": "0.0.0-test"',
      'The bundled LOOM tools are missing, so maps cannot be laid out.',
      'ffmpeg: ran (9 ms).',
      'a main line',
      'an engine line',
      'Los Angeles — the map drawn for 2026-09-12',
    ].map((needle) => text.indexOf(needle))
    expect(
      order.every((at) => at >= 0),
      text,
    ).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('says the engine is not running rather than failing', async () => {
    const h = await harness({
      engineInfo: () => Promise.reject({ code: -32002, message: 'The engine is starting.' }),
    })
    await h.call(CHANNELS.settingsCopyDiagnostics, [])
    expect(h.copied[0]).toContain(
      'The engine did not give its engine.info: The engine is starting.',
    )
    expect(h.copied[0]).toContain('There is no main.log yet.')
    expect(h.copied[0]).toContain('No map has been drawn since the app started.')
  })

  it('writes the home folder as ~, wherever it appears', async () => {
    const h = await harness({
      homes: (root) => [join(root, 'home', 'someone')],
      logsFolder: (root) => join(root, 'home', 'someone', 'logs'),
      engineInfo: async () => ({
        engine: '0.0.0-test',
        home: join(h.root, 'home', 'someone', 'engine'),
      }),
    })
    const home = join(h.root, 'home', 'someone')
    await mkdir(h.logsFolder, { recursive: true })
    await writeFile(join(h.logsFolder, 'main.log'), `[config] SCHEMATIC_HOME=${home}/engine\n`)
    await h.call(CHANNELS.settingsCopyDiagnostics, [`a report naming ${home}`])
    const text = h.copied[0]
    expect(text).not.toContain(home)
    expect(text).toContain('SCHEMATIC_HOME=~/engine')
    expect(text).toContain('a report naming ~')
  })

  it('refuses reports that are not a short list of bounded text, and copies nothing', async () => {
    const h = await harness()
    for (const bad of [
      undefined,
      'one string',
      [1, 2],
      Array.from({ length: 21 }, () => 'a report'),
      ['x'.repeat(64 * 1024 + 1)],
    ]) {
      await expect(h.call(CHANNELS.settingsCopyDiagnostics, bad)).rejects.toThrow(/short list/)
    }
    expect(h.copied).toEqual([])
  })

  it('gives up on an engine that does not answer, and says so', async () => {
    vi.useFakeTimers()
    try {
      const h = await harness({ engineInfo: () => new Promise(() => undefined) })
      const copying = h.call(CHANNELS.settingsCopyDiagnostics, [])
      await vi.advanceTimersByTimeAsync(ENGINE_INFO_TIMEOUT_MS)
      vi.useRealTimers()
      await copying
      expect(h.copied[0]).toContain('no answer within 5 s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies without the newest lines when the logs cannot be flushed in time', async () => {
    vi.useFakeTimers()
    try {
      const h = await harness({ flushLogs: () => new Promise(() => undefined) })
      const copying = h.call(CHANNELS.settingsCopyDiagnostics, [])
      await vi.advanceTimersByTimeAsync(LOG_WAIT_MS)
      vi.useRealTimers()
      await copying
      expect(h.copied).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("shares its home lookup with a job's log: the named and the real home, or a refusal in time", async () => {
    const h = await harness({
      homes: (root) => [join(root, 'home', 'someone'), join(root, 'net', 'export', 'someone')],
    })
    expect(await h.settings.homesToHide()).toEqual([
      join(h.root, 'home', 'someone'),
      join(h.root, 'net', 'export', 'someone'),
    ])
    vi.useFakeTimers()
    try {
      const slow = await harness({ realHome: () => new Promise(() => undefined) })
      const looking = slow.settings.homesToHide()
      const refused = expect(looking).rejects.toThrow('the home folder did not answer in time')
      await vi.advanceTimersByTimeAsync(HOMES_TIMEOUT_MS)
      vi.useRealTimers()
      await refused
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses the copy when the home through its links does not answer in time', async () => {
    vi.useFakeTimers()
    try {
      const h = await harness({ realHome: () => new Promise(() => undefined) })
      const copying = h.call(CHANNELS.settingsCopyDiagnostics, [])
      const refused = expect(copying).rejects.toThrow(
        'the home folder did not answer in time, so nothing was copied',
      )
      await vi.advanceTimersByTimeAsync(HOMES_TIMEOUT_MS)
      vi.useRealTimers()
      await refused
      expect(h.copied).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the real home and the short forms that answered, when another never does', async () => {
    vi.useFakeTimers()
    try {
      const h = await harness({
        homes: (root) => [join(root, 'home', 'someone'), join(root, 'net', 'export', 'someone')],
        shortHomes: () => [new Promise(() => undefined), Promise.resolve('SOMEON~1-short-form')],
      })
      const real = join(h.root, 'net', 'export', 'someone')
      const copying = h.call(CHANNELS.settingsCopyDiagnostics, [
        `a report naming ${real} and SOMEON~1-short-form`,
      ])
      await vi.advanceTimersByTimeAsync(HOMES_TIMEOUT_MS)
      vi.useRealTimers()
      await copying
      expect(h.copied[0]).toContain('a report naming ~ and ~')
      expect(h.copied[0]).not.toContain(real)
    } finally {
      vi.useRealTimers()
    }
  })
})
