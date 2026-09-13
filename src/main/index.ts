// The main process: one window, one origin, one bridge, one engine. Nothing
// here draws; see specs/001-electron-skeleton/plan.md and
// specs/004-sidecar-supervisor/plan.md.

import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { homedir, release, tmpdir, type } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { BrowserWindow, app, clipboard, dialog, ipcMain, session, shell } from 'electron'
import pins from '../../vendor/pins.json'
import { CHANNELS } from '../shared/api'
import type { AppSettings, FolderSource } from '../shared/settings'
import { abortCaptures, capture, configureCapture } from './capture-window'
import {
  describeConfig,
  EXPORT_FOLDER_NAME,
  resolveConfig,
  type Config,
  type Source,
} from './config'
import { registerEngineHandlers } from './engine-ipc'
import { PickedPaths, registerFeedsHandlers, registryGuard } from './feeds-ipc'
import { Exporter } from './export'
import { claimFramesRoot, clearFrames, describeSweep, FRAMES_FOLDER } from './frames'
import { registerExportHandlers } from './export-ipc'
import { engineCommand, engineEnvironment, resolveInterpreter } from './interpreter'
import { registerClipboardHandler, registerProjectHandlers, registerViewerHandlers } from './ipc'
import { byTag, holdingSink, log, setSink, toStderrRedacted } from './log'
import { LOG_WAIT_MS, openLogFile, within, type LogFile } from './log-file'
import { shortHomeFrom } from './diagnostics-text'
import { ProjectStore } from './projects'
import { SettingsStore } from './settings'
import { registerSettingsHandlers, SettingsService } from './settings-ipc'
import { Viewer } from './viewer'
import { registerAppProtocol } from './protocol'
import { registerAppScheme } from './scheme'
import { Sidecar } from './sidecar'

export const PRODUCT_NAME = 'Legible Cities'

// The log, from the first line. Until the app knows where its log folder
// is, lines are held in memory - the first lines of a launch that goes
// wrong are the ones worth having - and, in development, mirrored to
// standard error as they always were. Once the folder is known they go to
// main.log and engine.log (specs/023-logs-and-diagnostics).
const development = !app.isPackaged
// Standard error gets each line with its URLs redacted, as the files do
// (src/main/redact.ts): terminal scrollback is pasted as readily as a log.
const earlyLines = holdingSink(2_000)
setSink((line, tag, at) => {
  if (development) toStderrRedacted(line, tag)
  earlyLines.sink(line, tag, at)
})
/** The two files, once open; closed on the way out, after the engine's last line. */
let logFiles: { main: LogFile; engine: LogFile } | null = null
let logsClosed = false

// Before the app is ready, and exactly once (research.md section 1).
registerAppScheme()

// The user-data folder, moved for a test run: the end-to-end suite must not
// write a person's settings file into their own profile. Development only -
// a packaged build loses nothing, because Chromium's own `--user-data-dir`
// is there, and a switch that silently relocates a whole profile is not
// something to ship. Not a setting: a switch for the suite (specs/019,
// A-006). `app.getPath('logs')` does not follow this on macOS.
//
// It has to happen before the app is ready, and `setPath` throws for a
// folder that is not there, so the folder is made first and the whole thing
// is guarded: a bad value must cost the switch, not the launch.
const movedUserData = !app.isPackaged ? process.env.LEGIBLE_USER_DATA : undefined
let userDataMoved = false
if (movedUserData !== undefined && movedUserData !== '' && isAbsolute(movedUserData)) {
  try {
    mkdirSync(movedUserData, { recursive: true })
    app.setPath('userData', movedUserData)
    userDataMoved = true
  } catch (error) {
    log.error(
      'config',
      `LEGIBLE_USER_DATA could not be used: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
// The logs, moved for a test run, on the same terms as the user-data folder:
// development only, an absolute path, and a bad value costs the switch and
// not the launch. The end-to-end suite sets LEGIBLE_LOGS for every launch
// (tests/e2e/global-setup.ts), because most of its launches keep the default
// profile and would otherwise write and rotate a person's own log. A moved
// profile wins: its logs follow it. On Windows and Linux Electron keeps the
// logs inside the user-data folder already; on macOS it does not
// (specs/023, FR-009).
const movedLogs = !app.isPackaged ? process.env.LEGIBLE_LOGS : undefined
let logsMoved: string | null = null
const logsTarget =
  userDataMoved && movedUserData !== undefined
    ? { path: join(movedUserData, 'logs'), key: 'LEGIBLE_USER_DATA' }
    : movedLogs !== undefined && movedLogs !== '' && isAbsolute(movedLogs)
      ? { path: movedLogs, key: 'LEGIBLE_LOGS' }
      : null
if (logsTarget !== null) {
  try {
    mkdirSync(logsTarget.path, { recursive: true })
    app.setAppLogsPath(logsTarget.path)
    logsMoved = logsTarget.key
  } catch (error) {
    log.error(
      'config',
      `the logs could not follow ${logsTarget.key}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Open main.log and engine.log in the platform's log folder and send every
 * line there from now on, the held ones first. A folder Electron cannot
 * name leaves the log on standard error, and says so there; a folder that
 * cannot be written is found at the first write, and the file says so
 * once and falls back the same way.
 */
async function openLogs(): Promise<void> {
  let folder: string
  try {
    folder = app.getPath('logs')
    await mkdir(folder, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'no log folder'
    // Still redacted: a log that falls back to standard error is scrollback
    // someone can paste.
    setSink(toStderrRedacted)
    if (!development) earlyLines.release(toStderrRedacted)
    log.warn('log', `the log folder could not be used (${code}); logging to standard error`)
    return
  }
  const options = { mirrored: development }
  const main = openLogFile(folder, 'main', options)
  const engine = openLogFile(folder, 'engine', options)
  logFiles = { main, engine }
  const toFiles = byTag(
    (line, _tag, at) => main.write(line, at),
    (line, _tag, at) => engine.write(line, at),
  )
  setSink((line, tag, at) => {
    if (development) toStderrRedacted(line, tag)
    toFiles(line, tag, at)
  })
  earlyLines.release(toFiles)
}

/**
 * The home folder as the copy should hide it: as the platform names it,
 * through its links, and on Windows in the 8.3 short form the temporary
 * folder is usually written in (`RUNNER~1` for a longer user name), derived
 * from the temporary folder's raw and real paths. Asked for when a copy is
 * made, and asynchronously, so a slow disk never holds the window; a
 * temporary folder on a network share (`\\server\…`) is not asked at all,
 * because a share that does not answer would hold the copy instead.
 */
async function homeFolders(): Promise<string[]> {
  const home = homedir()
  const homes = new Set([home])
  try {
    homes.add(await realpath(home))
  } catch {
    // The home as named is still hidden.
  }
  if (process.platform === 'win32') {
    for (const raw of [process.env.TEMP, process.env.TMP, tmpdir()]) {
      if (raw === undefined || raw === '' || raw.startsWith('\\\\')) continue
      try {
        const short = shortHomeFrom(home, raw, await realpath(raw))
        if (short !== null) homes.add(short)
      } catch {
        // A temporary folder that is not there says nothing about the home.
      }
    }
  }
  return [...homes]
}

let mainWindow: BrowserWindow | null = null
let sidecar: Sidecar | null = null
let exporter: Exporter | null = null
// Held at this scope because the handlers registered before it exists ask
// it whether a reset is under way; it is assigned once, during startup.
let settings: SettingsService | null = null
let quitting = false

/** Why nothing may write under the engine's home right now, or null. */
const resetInProgress = (): string | null => settings?.refuseWhileResetting() ?? null

/**
 * How a folder's origin reads on the Settings screen. `.env.local` is the
 * environment, in development: either way it is a decision from outside the
 * app, and the screen must not offer to change it.
 */
function sourceOf(source: Source): FolderSource {
  if (source === 'environment' || source === '.env.local') return 'environment'
  return source
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Nothing this app shows may open a window or move the one it has. The
  // viewer's frame is sandboxed and cannot do either (ADR-028); these are
  // the window's own refusals, so a route nobody thought of is refused too.
  window.webContents.setWindowOpenHandler(({ url }) => {
    // The denial comes first: `window.open('')` hands us a url that is not
    // one, and a throw here would leave a security decision unmade.
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      scheme = 'no scheme'
    }
    log.warn('window', `refused to open a window (${scheme})`)
    return { action: 'deny' }
  })
  // Safe as a prefix because the scheme is registered `standard: true`, so
  // Chromium canonicalises before these fire: `…/ui/../projects/x` arrives
  // as `…/projects/x`, and `…/ui@evil` fails the trailing slash.
  const ORIGIN = 'app://local/'
  const allowed = 'app://local/ui/'
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(allowed)) return
    event.preventDefault()
    log.warn('window', 'refused to navigate the interface away')
  })
  // A frame may load and reload its own page, and nothing else. The sandbox
  // does not stop a frame navigating *itself*, and the interface's own
  // `default-src` happens to cover it through the frame-src fallback; this
  // says so directly, so the containment does not rest on a fallback three
  // hundred lines away. It also refuses a file dropped onto the viewer.
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.url.startsWith(ORIGIN)) return
    event.preventDefault()
    log.warn('window', 'refused a frame trying to leave the origin')
  })

  window.on('ready-to-show', () => window.show())
  // The page must not rename the window; the title is a contract (FR-003).
  window.on('page-title-updated', (event) => event.preventDefault())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  // A state that changed before the page existed would otherwise be missed.
  window.webContents.on('did-finish-load', () => {
    if (sidecar !== null) window.webContents.send(CHANNELS.engineStateChanged, sidecar.state)
  })
  window.loadURL('app://local/ui/').catch((error: Error) => {
    // A hidden window that never loads is the "loading forever" User Story 1
    // rules out: say so, and show what there is.
    log.error('window', `failed to load the interface: ${error.message}`)
    window.show()
  })
  return window
}

async function loadConfig(stored: AppSettings): Promise<Config> {
  const development = !app.isPackaged
  // Relative values resolve against the repository in development; a
  // packaged app's own path is inside the bundle, so use the working
  // directory there instead (nothing may resolve into the bundle, FR-016).
  const baseDir = development ? app.getAppPath() : process.cwd()
  let fileText: string | undefined
  if (development) {
    try {
      fileText = await readFile(join(baseDir, '.env.local'), 'utf8')
    } catch {
      fileText = undefined
    }
  }
  const config = resolveConfig({
    fileText,
    env: process.env,
    userData: app.getPath('userData'),
    desktop: app.getPath('desktop'),
    loomPin: pins.loom.commit,
    baseDir,
    // Below the environment and .env.local, above the defaults (A1-04).
    settings: { engineFolder: stored.engineFolder, exportFolder: stored.exportFolder },
  })
  for (const line of describeConfig(config, { development })) log.info('config', line)
  // Not one of the configuration's keys, so it is said here: a support
  // conversation about a profile that is not where it should be starts with
  // knowing this was set.
  if (userDataMoved) {
    log.info('config', `LEGIBLE_USER_DATA=${app.getPath('userData')} (environment)`)
  }
  if (logsMoved !== null) {
    log.info('config', `logs in ${app.getPath('logs')} (${logsMoved}, environment)`)
  }
  return config
}

// The engine, from the interpreter the configuration points at; without
// one, a supervisor that says so and never spawns (specs/004, FR-002). A
// version mismatch is a state the page shows in its own dialog: a native
// message box would block the process on macOS and hold a quit on Linux.
function createSidecar(config: Config): Sidecar {
  const pin = pins.engine
  const resolution = resolveInterpreter({
    config,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    exists: existsSync,
  })
  const engineLog = (message: string): void => log.info('engine', message)
  if (resolution.interpreter === null) {
    log.warn('engine', resolution.detail)
    return new Sidecar({
      command: null,
      unavailableReason: resolution.reason,
      env: {},
      pin,
      log: engineLog,
    })
  }
  log.info('engine', `interpreter: ${resolution.interpreter} (${resolution.origin})`)
  return new Sidecar({
    command: engineCommand(resolution.interpreter),
    env: engineEnvironment({ config, base: process.env, development: !app.isPackaged }),
    pin,
    log: engineLog,
  })
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // A second launch focuses the existing window (FR-035); on macOS, where
    // closing every window leaves the app running, it opens one again.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else {
      mainWindow = createWindow()
    }
  })

  app.whenReady().then(async () => {
    // The log files before anything worth logging, the engine above all:
    // its first lines are how a launch that failed is diagnosed.
    await openLogs()
    // The settings are read first: a folder a person chose is one of the
    // things the configuration resolves, below the environment.
    const settingsStore = new SettingsStore(app.getPath('userData'), (m) => log.warn('settings', m))
    const stored = await settingsStore.load()
    const config = await loadConfig(stored)
    const engine = createSidecar(config)
    sidecar = engine
    engine.start()
    const store = new ProjectStore(config.home, (m) => log.warn('projects', m))
    const isTopFrame = (event: Electron.IpcMainInvokeEvent): boolean =>
      mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame
    // Every record and every output folder lives under the engine's home, so
    // the store's writes are held while a reset is removing it (A1-04).
    registerProjectHandlers(ipcMain, store, isTopFrame, resetInProgress)
    // Text on the clipboard, one way: the diagnostics panel's "Copy as
    // text" (A3-03). The permission handlers below refuse Chromium's own
    // clipboard write, deliberately, so the page asks for this instead.
    registerClipboardHandler(ipcMain, (text) => clipboard.writeText(text), isTopFrame)
    const viewer = new Viewer((m) => log.warn('viewer', m))
    registerViewerHandlers(
      ipcMain,
      viewer,
      () => (mainWindow === null || mainWindow.isDestroyed() ? null : mainWindow.webContents),
      isTopFrame,
    )
    // The registry's gate: a zip is chosen in the platform's own dialog and
    // remembered, and a feed a project names cannot be removed.
    const picked = new PickedPaths()
    registerFeedsHandlers(
      ipcMain,
      async () => {
        const options: Electron.OpenDialogOptions = {
          title: 'Choose a GTFS zip',
          properties: ['openFile'],
          filters: [{ name: 'GTFS feed', extensions: ['zip'] }],
        }
        // Parented to the window, so it is modal to it (rules/main.md); only
        // the window's own top frame can ask, so the window is there.
        if (mainWindow === null || mainWindow.isDestroyed()) return null
        const answer = await dialog.showOpenDialog(mainWindow, options)
        return answer.canceled || answer.filePaths.length === 0 ? null : answer.filePaths[0]
      },
      picked,
      isTopFrame,
    )
    // What the app decides for itself. The export folder is asked at each
    // export, so a change here needs no restart; the engine's home was
    // resolved above and moves at the next start (specs/019-settings).
    const settingsService = new SettingsService({
      store: settingsStore,
      engineHome: config.home,
      exportFolder: config.exportFolder,
      sources: {
        engine: sourceOf(config.sources.SCHEMATIC_HOME),
        export: sourceOf(config.sources.LEGIBLE_EXPORT_FOLDER),
      },
      defaults: {
        engine: join(app.getPath('userData'), 'engine'),
        export: join(app.getPath('desktop'), EXPORT_FOLDER_NAME),
      },
      chooseFolder: async (which, current) => {
        // Parented to the window, so it is modal to it (rules/main.md);
        // only the window's own top frame can ask, so the window is there.
        if (mainWindow === null || mainWindow.isDestroyed()) return null
        const answer = await dialog.showOpenDialog(mainWindow, {
          title: which === 'engine' ? 'Choose the engine data folder' : 'Choose the export folder',
          defaultPath: current,
          properties: ['openDirectory', 'createDirectory'],
        })
        return answer.canceled || answer.filePaths.length === 0 ? null : answer.filePaths[0]
      },
      // What this side actually knows: whether anything is *writing* under
      // the home at this moment - an export, a request the engine is
      // answering, or a record being renamed into place. It deliberately
      // does not claim to know whether a multi-step layout run is open:
      // that run is driven from the page, which issues graph.build, then
      // feeds.service, then map.build, then the record write, and nothing
      // is in flight between them. The page knows, so the page's Reset
      // button is the one that refuses a run in progress; the flag raised
      // for the length of the removal is what makes the gap safe.
      busy: () => {
        if (exporter !== null && exporter.live > 0)
          return 'An export is running; wait for it to finish.'
        if (engine.inFlight > 0) return 'The engine is answering a request; wait for it to finish.'
        if (store.writing > 0) return 'A project is being saved; try again in a moment.'
        return null
      },
      openFolder: async (path) => {
        await mkdir(path, { recursive: true }).catch((error: Error) =>
          log.warn('settings', `could not make the log folder: ${error.message}`),
        )
        const failure = await shell.openPath(path)
        if (failure !== '') log.warn('settings', `could not open the log folder: ${failure}`)
      },
      // Asked for when it is wanted: a path Electron cannot answer must
      // cost one dead button, not the whole startup.
      logsFolder: () => app.getPath('logs'),
      // Nothing may be kept inside the app itself, whoever chose it. In
      // development that is the checkout; packaged, the bundle and the
      // resources beside it.
      bundleRoots: app.isPackaged ? [app.getAppPath(), process.resourcesPath] : [app.getAppPath()],
      guards: { userData: app.getPath('userData'), homeDir: homedir() },
      // "Copy diagnostics": everything from this process, and the engine's
      // own answer; the clipboard is written in the main process, as the
      // diagnostics panel's handler writes it. Nothing leaves the machine.
      diagnostics: {
        about: () => ({
          app: { name: PRODUCT_NAME, version: app.getVersion() },
          versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
          },
          os: { type: type(), release: release(), arch: process.arch },
        }),
        engineInfo: () => engine.request('engine.info').result,
        flushLogs: async () => {
          await Promise.all([logFiles?.main.flush(), logFiles?.engine.flush()])
        },
        homes: homeFolders,
        home: homedir(),
        platform: process.platform,
        writeText: (text) => clipboard.writeText(text),
      },
      log: (message) => log.info('settings', message),
    })
    // Held where the handlers registered above it can ask it.
    settings = settingsService
    registerSettingsHandlers(ipcMain, settingsService, isTopFrame)

    // The registry's gate, and in front of it the reset's: while the engine
    // home is being removed, nothing may ask the engine to write into it.
    //
    // Asked on both sides of the registry's own check. Before, so a refusal
    // never spends the path the zip chooser remembered. And after, because
    // the registry reads the project list from disk for a feeds.remove and
    // the loop turns while it does: a reset confirmed in that window would
    // otherwise be answered with the null from before it started, and the
    // remove would unlink inside data/feeds while the removal walks data/.
    const registry = registryGuard(picked, async () => (await store.list()).map((p) => p.feed))
    registerEngineHandlers(
      ipcMain,
      engine,
      isTopFrame,
      (channel, payload) => {
        if (mainWindow !== null && !mainWindow.isDestroyed())
          mainWindow.webContents.send(channel, payload)
      },
      (message) => log.warn('engine', message),
      async (method, params) =>
        resetInProgress() ?? (await registry(method, params)) ?? resetInProgress(),
    )
    // Electron grants a permission request by default. Nothing this app
    // shows has any business asking for one, and the viewer's page least of
    // all; the cost of saying so is three lines.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      log.warn('window', `refused a request for ${permission}`)
      callback(false)
    })
    session.defaultSession.setPermissionCheckHandler(() => false)

    registerAppProtocol({
      // Development only: a packaged build never proxies anything, whatever
      // its environment says (FR-009, FR-034).
      devUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      uiRoot: join(__dirname, '../renderer'),
      engineHome: config.home,
      log: (message) => log.warn('protocol', message),
    })
    // The export's window has a session of its own, serving project pages
    // and nothing else (ADR-024).
    configureCapture({ engineHome: config.home })
    // An export's frames live under the engine home only while it runs; a
    // crash mid-export leaves them, and nothing else will ever ask for them.
    // Only a folder the app made is swept, and never the folder itself: the
    // home is a setting and can name anybody's directory (src/main/frames.ts).
    const framesRoot = join(config.home, FRAMES_FOLDER)
    await claimFramesRoot(framesRoot).catch(() =>
      log.warn('export', 'the frames folder could not be claimed'),
    )
    log.info('export', describeSweep(await clearFrames(framesRoot)))
    exporter = new Exporter({
      engine,
      projects: store,
      capture,
      framesRoot,
      exportFolder: () => settingsService.exportFolderNow(),
      // The frames live under the engine home, so no export may begin while
      // that folder is being removed.
      blocked: resetInProgress,
      log: (message) => log.info('export', message),
    })
    registerExportHandlers(
      ipcMain,
      exporter,
      isTopFrame,
      (channel, payload) => {
        if (mainWindow !== null && !mainWindow.isDestroyed())
          mainWindow.webContents.send(channel, payload)
      },
      (path) => shell.showItemInFolder(path),
    )
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  // Quitting ends the engine first: ask, then terminate, then kill, and only
  // then let Electron go (specs/004, FR-014). The first pass prevents the
  // default and comes back through here with the flag set.
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    // An export in flight is cancelled, and its capture window destroyed,
    // before the engine is asked to stop.
    exporter?.abortAll()
    abortCaptures()
    if (sidecar === null) return
    event.preventDefault()
    const stopping = sidecar.stop()
    stopping.catch((error: Error) => log.error('engine', `stop failed: ${error.message}`))
    void stopping.finally(() => app.quit())
  })

  // The files close last. This runs only once the quit above has let
  // Electron go, and the supervisor's stop waits for the engine's stdio to
  // close (bounded at a second), so the engine's shutdown lines and what it
  // printed on the way out are queued by then. Lines logged after this
  // reach standard error in development and nowhere else.
  app.on('will-quit', (event) => {
    if (logFiles === null || logsClosed) return
    event.preventDefault()
    logsClosed = true
    const files = logFiles
    // Bounded: a disk that does not answer costs the last lines, not the quit.
    void within(Promise.all([files.main.close(), files.engine.close()]), LOG_WAIT_MS).finally(() =>
      app.quit(),
    )
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
