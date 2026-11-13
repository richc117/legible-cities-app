// What the acceptance spec and the lanes that grow it share: starting the
// installed app and putting it in front, the recorder of what its status
// lines say, and the deadline-bound poll. Moved out of the spec so that two
// pieces of work on it do not edit one file. No test is declared here.

import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export const SECOND = 1_000
export const MINUTE = 60 * SECOND
/** How long the app has to start and show its first window. */
export const LAUNCH_MS = 2 * MINUTE

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export const real = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/** Whether `path` is `root` or inside it, after links, without regard to case on Windows. */
export function inside(path: string, root: string): boolean {
  const fold = (p: string): string =>
    process.platform === 'win32' ? real(p).toLowerCase() : real(p)
  const rel = relative(fold(root), fold(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The environment a person's launch would have: no development switch, no engine pointer. */
function launchEnvironment(exportFolder: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SCHEMATIC_|LEGIBLE_|PYTHON)/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  env.LEGIBLE_EXPORT_FOLDER = exportFolder
  return env
}

/**
 * Every sentence a status or alert line has held, in order, from a
 * MutationObserver installed at launch: a transient sentence - "downloaded
 * 170 of 170 bytes" - is read here after it has gone from the screen.
 */
export async function installRecorder(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    const holder = window as unknown as { __said?: string[]; __line?: string[] }
    if (holder.__said !== undefined) return
    const said: string[] = []
    holder.__said = said
    // The export's line for the eye, which is not a live region since issue
    // 542 (it changes with every frame): what it shows is kept apart from
    // what is spoken, so the count going up is still seen.
    // The selector finds the same element `exportLine` finds in
    // tests/support/project.ts, written out because this runs in the page,
    // where no locator reaches.
    const line: string[] = []
    holder.__line = line
    const last = new WeakMap<Element, string>()
    const scan = (): void => {
      for (const element of document.querySelectorAll(
        '[role="status"], [role="alert"], .export-run .progress-message',
      )) {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text !== '' && last.get(element) !== text) {
          const spoken = element.matches('[role="status"], [role="alert"]')
          ;(spoken ? said : line).push(text)
        }
        last.set(element, text)
      }
    }
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scan()
  })
}

/**
 * The app's window shown, raised and focused, as a person using it has it.
 * Chromium stops a page's animation frames in a window macOS reports as
 * occluded, and throttles its tasks, so a window left behind others shows a
 * map that does not move and progress sentences that are never drawn. The
 * window is the app's; nothing is run inside the viewer's frame.
 */
export async function bringToFront(app: ElectronApplication, page: Page): Promise<string> {
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.moveTop()
    window.focus()
    if (process.platform === 'darwin') electronApp.focus({ steal: true })
  })
  return page.evaluate(() => document.visibilityState)
}

/** Poll until `probe` answers something other than undefined, or throw `what` at the deadline. */
export async function until<T>(
  probe: () => Promise<T | undefined>,
  deadline: number,
  what: () => string | Promise<string>,
  every = SECOND,
): Promise<T> {
  const end = Date.now() + deadline
  for (;;) {
    const answer = await probe().catch(() => undefined)
    if (answer !== undefined) return answer
    if (Date.now() > end)
      throw new Error(`${await what()} (after ${Math.round(deadline / SECOND)} s)`)
    await sleep(every)
  }
}

/** What `launchApp` needs to know about a run, and what it records in it. */
export interface LaunchSession {
  exe: string
  install: string
  profile: string
  exportFolder: string
  app: ElectronApplication | null
  page: Page | null
  resources: string
  userData: string
}

/**
 * Launch the installed app into `session`'s profile and export folder: the
 * recorder installed and the window in front, and what the app says about
 * itself checked (packaged, and honouring the profile). `afterWindow` runs
 * once the first window exists, before anything is installed in it.
 */
export async function launchApp(session: LaunchSession, afterWindow: () => void): Promise<Page> {
  const app = await electron.launch({
    executablePath: session.exe,
    args: [`--user-data-dir=${session.profile}`],
    cwd: session.install,
    env: launchEnvironment(session.exportFolder),
    timeout: LAUNCH_MS,
  })
  session.app = app
  const window = await app.firstWindow({ timeout: LAUNCH_MS })
  session.page = window
  afterWindow()
  await installRecorder(window)
  await bringToFront(app, window)
  const where = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    resources: process.resourcesPath,
    packaged: electronApp.isPackaged,
    version: electronApp.getVersion(),
  }))
  session.resources = where.resources
  session.userData = where.userData
  if (!where.packaged) throw new Error('the app launched does not know itself as packaged')
  if (!inside(where.userData, session.profile)) {
    throw new Error(`--user-data-dir was not honoured: the profile is ${where.userData}`)
  }
  return window
}
