// The main process: one window, one origin, one bridge, one engine. Nothing
// here draws; see specs/001-electron-skeleton/plan.md,
// specs/004-sidecar-supervisor/plan.md and .claude/rules/main.md.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import pins from '../../vendor/pins.json'
import { CHANNELS } from '../shared/api'
import { describeConfig, resolveConfig, type Config } from './config'
import { registerEngineHandlers } from './engine-ipc'
import { engineCommand, engineEnvironment, resolveInterpreter } from './interpreter'
import { registerProjectHandlers } from './ipc'
import { log } from './log'
import { ProjectStore } from './projects'
import { registerAppProtocol } from './protocol'
import { Sidecar } from './sidecar'

export const PRODUCT_NAME = 'Legible Cities'

// Before the app is ready, and exactly once: a standard, secure origin that
// supports fetch and streamed bodies (research.md section 1).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

let mainWindow: BrowserWindow | null = null
let sidecar: Sidecar | null = null
let quitting = false
// The mismatch dialog, so a quit can dismiss it rather than wait behind it.
let mismatchDialog: AbortController | null = null

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

async function loadConfig(): Promise<Config> {
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
    baseDir,
  })
  for (const line of describeConfig(config, { development })) log.info('config', line)
  return config
}

// The engine, from the interpreter the configuration points at; without
// one, a supervisor that says so and never spawns (specs/004, FR-002).
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
    onMismatch: (expected, found) => {
      const options = {
        type: 'error' as const,
        title: 'Engine version mismatch',
        message: `This version of ${PRODUCT_NAME} needs engine ${expected.version} (protocol ${expected.protocol}).`,
        detail: `The engine it found is ${found.version} (protocol ${found.protocol}). The engine's features are off until the versions match: reinstall the app, or point LEGIBLE_ENGINE_PYTHON at an environment with engine ${expected.version}.`,
        buttons: ['OK'],
        defaultId: 0,
      }
      mismatchDialog = new AbortController()
      const withSignal = { ...options, signal: mismatchDialog.signal }
      // A sheet on a window that is not showing yet is not visible either.
      const parent = mainWindow !== null && mainWindow.isVisible() ? mainWindow : null
      const shown =
        parent === null
          ? dialog.showMessageBox(withSignal)
          : dialog.showMessageBox(parent, withSignal)
      shown.catch((error: Error) =>
        log.error('engine', `could not show the mismatch dialog: ${error.message}`),
      )
    },
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
    const config = await loadConfig()
    const engine = createSidecar(config)
    sidecar = engine
    engine.start()
    const store = new ProjectStore(config.home, (m) => log.warn('projects', m))
    const isTopFrame = (event: Electron.IpcMainInvokeEvent): boolean =>
      mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame
    registerProjectHandlers(ipcMain, store, isTopFrame)
    registerEngineHandlers(
      ipcMain,
      engine,
      isTopFrame,
      (channel, payload) => {
        if (mainWindow !== null && !mainWindow.isDestroyed())
          mainWindow.webContents.send(channel, payload)
      },
      (message) => log.warn('engine', message),
    )
    registerAppProtocol({
      // Development only: a packaged build never proxies anything, whatever
      // its environment says (FR-009, FR-034).
      devUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      uiRoot: join(__dirname, '../renderer'),
      engineHome: config.home,
      log: (message) => log.warn('protocol', message),
    })
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
    mismatchDialog?.abort()
    if (sidecar === null) return
    event.preventDefault()
    const stopping = sidecar.stop()
    stopping.catch((error: Error) => log.error('engine', `stop failed: ${error.message}`))
    void stopping.finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
