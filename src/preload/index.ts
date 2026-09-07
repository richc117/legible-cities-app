// The whole surface between the page and the machine. Named, typed,
// narrow; never ipcRenderer itself. Contracts: specs/003-project/contracts/bridge.md
// (projects) and specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type Api, type EngineRequest } from '../shared/api'
import { isEngineErrorShape, type EngineErrorShape } from '../shared/engine'
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

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// An engine request settles with the engine's own error shape: code,
// message and data. It crosses the bridge as a plain object, because an
// Error loses everything but its message on the way; the renderer reads
// `code` and `data.hint` from it directly.
function engineRequest(method: string, params?: Record<string, unknown>): EngineRequest {
  const id = crypto.randomUUID()
  const result = ipcRenderer.invoke(CHANNELS.engineRequest, id, method, params).then(
    (answer: unknown) => {
      const a = answer as { ok?: boolean; result?: unknown; error?: unknown }
      if (a !== null && typeof a === 'object' && a.ok === true) return a.result
      const error: EngineErrorShape =
        a !== null && typeof a === 'object' && isEngineErrorShape(a.error)
          ? a.error
          : { code: -32603, message: 'The engine gave no answer.' }
      throw error
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      const shape: EngineErrorShape = { code: -32603, message: unwrapIpcError(message) }
      throw shape
    },
  )
  return { id, result }
}

const api: Api = {
  projects: {
    list: () => invoke(CHANNELS.projectsList),
    get: (id) => invoke(CHANNELS.projectsGet, id),
    create: (input) => invoke(CHANNELS.projectsCreate, input),
    rename: (id, name) => invoke(CHANNELS.projectsRename, id, name),
    delete: (id) => invoke(CHANNELS.projectsDelete, id),
  },
  engine: {
    state: () => invoke(CHANNELS.engineState),
    request: engineRequest,
    cancel: (id) => invoke(CHANNELS.engineCancel, id),
    onState: (listener) => subscribe(CHANNELS.engineStateChanged, listener),
    onProgress: (listener) => subscribe(CHANNELS.engineProgress, listener),
    onLog: (listener) => subscribe(CHANNELS.engineLog, listener),
  },
}

contextBridge.exposeInMainWorld('api', api)
