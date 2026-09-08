// The main process: one window, one origin, one bridge, one engine. Nothing
// here draws; see specs/001-electron-skeleton/plan.md and
// specs/004-sidecar-supervisor/plan.md.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'
import pins from '../../vendor/pins.json'
import { CHANNELS } from '../shared/api'
import { describeConfig, resolveConfig, type Config } from './config'
import { registerEngineHandlers } from './engine-ipc'
import { engineCommand, engineEnvironment, resolveInterpreter } from './interpreter'
import { registerProjectHandlers, registerViewerHandlers } from './ipc'
import { log } from './log'
import { ProjectStore } from './projects'
import { Viewer } from './viewer'
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
    const config = await loadConfig()
    const engine = createSidecar(config)
    sidecar = engine
    engine.start()
    const store = new ProjectStore(config.home, (m) => log.warn('projects', m))
    const isTopFrame = (event: Electron.IpcMainInvokeEvent): boolean =>
      mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame
    registerProjectHandlers(ipcMain, store, isTopFrame)
    const viewer = new Viewer((m) => log.warn('viewer', m))
    registerViewerHandlers(
      ipcMain,
      viewer,
      () => (mainWindow === null || mainWindow.isDestroyed() ? null : mainWindow.webContents),
      isTopFrame,
    )
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
