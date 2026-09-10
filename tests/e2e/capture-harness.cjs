// A bare Electron around the capture entry, for tests/e2e/capture.spec.ts.
//
// The app never exposes the capture to its renderer - the export flow that
// will run it lives in the main process (A5-02b) - so a test that wants the
// real window, session and debugger launches this instead of the app. It
// loads the second build entry (electron.vite.config.ts), registers the
// scheme and the capture session the way src/main/index.ts does, and hangs
// what the test drives on a global the test reaches through
// `electronApp.evaluate`. Nothing here is a hook in the app.
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const entry = require(path.join(__dirname, '..', '..', 'out', 'main', 'capture.js'))

// A profile of this run's own, under the test's home. A bare Electron would
// otherwise share the machine-wide profile, and the zoom level the test
// below seeds would sit in it for every later bare-Electron run - which is
// exactly what cost spike A0-07 two sessions.
app.setPath('userData', path.join(process.env.SCHEMATIC_HOME, 'harness-profile'))

entry.registerAppScheme()

// A capture window is the only window here, and Electron's default when the
// last window closes is to quit. The app subscribes to this too; without it
// the harness died the moment a capture finished, taking the test's
// connection with it.
app.on('window-all-closed', () => {})

app.whenReady().then(() => {
  entry.configureCapture({ engineHome: process.env.SCHEMATIC_HOME })

  const outcome = async (promise) => {
    try {
      return { ok: true, result: await promise }
    } catch (error) {
      return { ok: false, message: error.message, cancelled: error.cancelled === true }
    }
  }

  globalThis.__harness = {
    /** One capture, to completion or failure. */
    capture: async (job, frames) => {
      const progress = []
      const done = await outcome(
        entry.capture(job, { frames, onProgress: (n, total) => progress.push([n, total]) }),
      )
      return {
        ...done,
        progress,
        windows: BrowserWindow.getAllWindows().length,
        live: entry.liveCaptures(),
      }
    },
    /** A capture cancelled once `after` frames are written. */
    cancelAfter: async (job, frames, after) => {
      const controller = new AbortController()
      let seen = 0
      const done = await outcome(
        entry.capture(job, {
          frames,
          signal: controller.signal,
          onProgress: (n) => {
            seen = n
            if (n === after) controller.abort()
          },
        }),
      )
      return {
        ...done,
        seen,
        windows: BrowserWindow.getAllWindows().length,
        live: entry.liveCaptures(),
      }
    },
    /** A capture ended from outside, the way a quit ends one, once `after` frames are written. */
    abortMidway: async (job, frames, after) => {
      const done = await outcome(
        entry.capture(job, {
          frames,
          onProgress: (n) => {
            if (n === after) entry.abortCaptures()
          },
        }),
      )
      return { ...done, windows: BrowserWindow.getAllWindows().length, live: entry.liveCaptures() }
    },
    /**
     * The trap spike A0-07 fell into: a per-host zoom level persisted in a
     * session. Seeded here on the default session for app://local, which is
     * where the interface's pages live; the capture's own session must not
     * see it.
     */
    seedZoom: async (url, factor) => {
      entry.registerAppProtocol({ engineHome: process.env.SCHEMATIC_HOME, projectsOnly: true })
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      })
      await win.loadURL(url)
      win.webContents.setZoomLevel(Math.log(factor) / Math.log(1.2))
      const level = win.webContents.getZoomLevel()
      win.destroy()
      return { level }
    },
  }
})
