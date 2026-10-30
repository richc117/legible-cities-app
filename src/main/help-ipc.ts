// The Help pages (issue 554): where each one is, and the bridge's one way to
// open one, main side.
//
// The addresses are held here, beside the install document's, and only the
// platform's browser opens them; the page asks for a page by name and cannot
// say where to go (Electron's security checklist, item 15). Opening the
// person's browser at a fixed address of the project's own is the browser's
// request, not the app's, which is the precedent `INSTALL_GUIDE_URL` set
// (constitution IV). The Help menu opens the same table from this side.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import { isHelpPage, type HelpPage } from '../shared/menu'
import { INSTALL_GUIDE_URL } from './first-run-ipc'
import { guardedHandle } from './ipc-shape'

/** The repository, on GitHub: its documents and its tracker. */
const REPOSITORY = 'https://github.com/richc117/legible-cities-app'

/**
 * Every Help page, by the name the menu and the page use. The guide is the
 * repository's front page, which says what the app does cell by cell.
 * Finding a feed is `docs/feeds.md` (issue 555): the menu offers it and the
 * New project sheet's button asks for it, both by this name.
 */
export const HELP_PAGES: Readonly<Record<HelpPage, string>> = {
  guide: `${REPOSITORY}#readme`,
  feeds: `${REPOSITORY}/blob/main/docs/feeds.md`,
  install: INSTALL_GUIDE_URL,
  report: `${REPOSITORY}/issues/new?template=bug.yml`,
}

/** What a page name that is not one of the table's is told. */
export const UNKNOWN_HELP_PAGE = 'There is no such help page.'

export interface HelpIpcDeps {
  /** The platform's browser: `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>
  log: (message: string) => void
}

/**
 * Open one of the pages in the platform's browser. The name is checked
 * against the closed set before the table is read, so `__proto__`,
 * `toString` and an address are refused alike, and nothing is opened.
 */
export async function openHelpPage(page: unknown, deps: HelpIpcDeps): Promise<void> {
  const url = isHelpPage(page) ? HELP_PAGES[page] : null
  if (url === null) throw new Error(UNKNOWN_HELP_PAGE)
  deps.log(`opening the help page "${String(page)}" in the browser`)
  await deps.openExternal(url)
}

/** Register the handler. It answers the interface's own top frame only, as every other does. */
export function registerHelpHandlers(
  ipcMain: IpcMain,
  deps: HelpIpcDeps,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = guardedHandle(ipcMain, isTopFrame)
  handle(CHANNELS.helpOpen, async (_event, page) => openHelpPage(page, deps))
}
