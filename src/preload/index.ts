// The whole surface between the page and the machine. Named, typed,
// narrow; never ipcRenderer itself. Contract: contracts/bridge.md.

import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Api } from '../shared/api'

const api: Api = {
  library: {
    list: () => ipcRenderer.invoke(CHANNELS.libraryList),
  },
}

contextBridge.exposeInMainWorld('api', api)
