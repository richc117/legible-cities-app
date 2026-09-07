// The main process: one window, one origin, one bridge. Nothing here
// draws, runs the engine or spawns a child; see
// specs/001-electron-skeleton/plan.md and .claude/rules/main.md.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { describeConfig, resolveConfig, type Config } from './config'
import { registerLibrary } from './library'
import { log } from './log'
import { registerAppProtocol } from './protocol'

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
  void window.loadURL('app://local/ui/')
  return window
}

async function loadConfig(): Promise<Config> {
  const development = !app.isPackaged
  const baseDir = app.getAppPath()
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

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    const config = await loadConfig()
    registerLibrary(ipcMain)
    registerAppProtocol({
      devUrl: process.env.ELECTRON_RENDERER_URL,
      uiRoot: join(__dirname, '../renderer'),
      engineHome: config.home,
      log: (message) => log.warn('protocol', message),
    })
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
