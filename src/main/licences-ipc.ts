// The Licences section's bridge, main side (issue 108, specs/027-licences,
// FR-004 and FR-005): what can be opened, and the three openings.
//
// Nothing crosses inward. All three are fixed paths in the app, held here;
// the page asks for "the notices", "the licence texts" or "Chromium's
// licences" by name and cannot say where any of them is. Nothing is written. Each
// handler answers the interface's own top frame only, as every other does.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { dirname, join } from 'node:path'
import { CHANNELS } from '../shared/api'
import {
  describeUnavailable,
  type LicenceFile,
  type LicenceFileState,
  type LicencesView,
} from '../shared/licences'

export interface LicencesDeps {
  /** `app.isPackaged`: a development run carries no resources of its own. */
  packaged: boolean
  /** `process.resourcesPath`. */
  resourcesPath: string
  /** `process.platform`: Windows keeps Chromium's licences beside the executable. */
  platform: string
  exists: (path: string) => boolean
  /** `shell.openPath`: the empty string when it opened, the platform's reason when not. */
  openPath: (path: string) => Promise<string>
  /** `shell.showItemInFolder`. */
  showItemInFolder: (path: string) => void
  log: (message: string) => void
}

/**
 * Where the three things live in a packaged app (electron-builder.yml): the
 * notices and the licence texts under the resources, and Chromium's
 * licences there on a Mac and beside the executable on Windows, where
 * electron-builder leaves them.
 */
export function licenceFiles(resourcesPath: string, platform: string): Record<LicenceFile, string> {
  return {
    notices: join(resourcesPath, 'THIRD_PARTY_NOTICES.md'),
    texts: join(resourcesPath, 'python', 'licenses'),
    chromium: join(
      platform === 'win32' ? dirname(resourcesPath) : resourcesPath,
      'LICENSES.chromium.html',
    ),
  }
}

export class LicencesService {
  readonly #deps: LicencesDeps

  constructor(deps: LicencesDeps) {
    this.#deps = deps
  }

  #state(path: string): LicenceFileState {
    if (!this.#deps.packaged) return 'development'
    return this.#deps.exists(path) ? 'available' : 'missing'
  }

  #files(): Record<LicenceFile, string> {
    return licenceFiles(this.#deps.resourcesPath, this.#deps.platform)
  }

  view(): LicencesView {
    const files = this.#files()
    return {
      notices: this.#state(files.notices),
      texts: this.#state(files.texts),
      chromium: this.#state(files.chromium),
    }
  }

  /**
   * The notices in the platform's default viewer. A Markdown file may have
   * no viewer on a machine (Windows has none by default), and then the
   * file is shown in the platform's file browser instead, which is where a
   * person can choose one.
   */
  async openNotices(): Promise<void> {
    const { notices } = this.#files()
    const refusal = describeUnavailable('notices', this.#state(notices))
    if (refusal !== null) throw new Error(refusal)
    const failure = await this.#deps.openPath(notices)
    if (failure === '') {
      this.#deps.log('opened the notices')
      return
    }
    this.#deps.log(`the notices did not open (${failure}); showing the file instead`)
    this.#deps.showItemInFolder(notices)
  }

  /** The folder of licence texts in the platform's file browser. */
  async showTexts(): Promise<void> {
    await this.#open('texts', "the licence texts' folder")
  }

  /** Chromium's licences, an HTML page, in the platform's browser. */
  async openChromium(): Promise<void> {
    await this.#open('chromium', "Chromium's licences")
  }

  async #open(what: LicenceFile, words: string): Promise<void> {
    const path = this.#files()[what]
    const refusal = describeUnavailable(what, this.#state(path))
    if (refusal !== null) throw new Error(refusal)
    const failure = await this.#deps.openPath(path)
    if (failure !== '') {
      this.#deps.log(`${words} did not open: ${failure}`)
      throw new Error(`${words[0].toUpperCase()}${words.slice(1)} could not be opened: ${failure}`)
    }
    this.#deps.log(`opened ${words}`)
  }
}

/** Register the four handlers; whatever arguments arrive are ignored. */
export function registerLicencesHandlers(
  ipcMain: IpcMain,
  licences: LicencesService,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = (channel: string, handler: () => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event) => {
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler()
    })
  }
  handle(CHANNELS.licencesRead, async () => licences.view())
  handle(CHANNELS.licencesOpenNotices, () => licences.openNotices())
  handle(CHANNELS.licencesShowTexts, () => licences.showTexts())
  handle(CHANNELS.licencesOpenChromium, () => licences.openChromium())
}
