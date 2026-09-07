// The whole surface between the page and the machine. Named, typed,
// narrow; never ipcRenderer itself. Contract: specs/003-project/contracts/bridge.md.

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Api } from '../shared/api'
import { unwrapIpcError } from '../shared/errors'

// A rejection's message is the contract's sentence, without Electron's
// remote-method wrapper around it.
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(unwrapIpcError(message), { cause: error })
  }
}

const api: Api = {
  projects: {
    list: () => invoke(CHANNELS.projectsList),
    get: (id) => invoke(CHANNELS.projectsGet, id),
    create: (input) => invoke(CHANNELS.projectsCreate, input),
    rename: (id, name) => invoke(CHANNELS.projectsRename, id, name),
    delete: (id) => invoke(CHANNELS.projectsDelete, id),
  },
}

contextBridge.exposeInMainWorld('api', api)
