// Electron's null dereference, reduced: emulate a web contents that has
// never navigated and the process dies; load any document first and it
// works. tests/unit/capture-crash.test.ts runs this twice, once each way,
// when LEGIBLE_CRASH_TEST is set. The capture navigates first because of
// this (ADR-024); the test is what keeps that from being "simplified".
const { app, BrowserWindow } = require('electron')

const order = process.argv[2]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 540,
    height: 960,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  })
  if (order === 'navigate-first') await win.webContents.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 540,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  })
  console.log('reached: no crash')
  app.exit(0)
})
