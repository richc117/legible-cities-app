// The whole surface between the page and the machine. Named, typed,
// narrow; never ipcRenderer itself. Contracts: specs/003-project/contracts/bridge.md
// (projects), specs/004-sidecar-supervisor/contracts/bridge.md (engine) and
// specs/010-export/contracts/bridge.md (export).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type Accepted, type Api, type Settled } from '../shared/api'
import { type EngineErrorShape } from '../shared/engine'
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

// A job's answer arrives as an event on the same channel as its progress,
// after the last notification, never as the invoke's reply (Electron does
// not order the two). It settles with the engine's own error shape, code,
// message and data, as a plain object: an Error loses everything but its
// message on the way over the bridge, and the engine's data.hint is what
// the interface shows. The engine's requests and the app's exports are both
// jobs in this sense; the token is minted here so the page can subscribe
// before anything arrives.
function startJob<T>(
  invokeChannel: string,
  settledChannel: string,
  ...args: unknown[]
): { id: string; result: Promise<T> } {
  const id = crypto.randomUUID()
  const result = new Promise<T>((resolve, reject) => {
    const off = subscribe<Settled<T>>(settledChannel, (settled) => {
      if (settled.id !== id) return
      off()
      if (settled.ok) resolve(settled.result)
      else reject(settled.error)
    })
    ipcRenderer.invoke(invokeChannel, id, ...args).then(
      (answer: Accepted) => {
        if (answer.accepted) return
        off()
        reject(answer.error)
      },
      (error: unknown) => {
        off()
        const message = error instanceof Error ? error.message : String(error)
        const shape: EngineErrorShape = { code: -32603, message: unwrapIpcError(message) }
        reject(shape)
      },
    )
  })
  return { id, result }
}

const api: Api = {
  projects: {
    list: () => invoke(CHANNELS.projectsList),
    get: (id) => invoke(CHANNELS.projectsGet, id),
    create: (input) => invoke(CHANNELS.projectsCreate, input),
    rename: (id, name) => invoke(CHANNELS.projectsRename, id, name),
    delete: (id) => invoke(CHANNELS.projectsDelete, id),
    completeLayout: (id, done) => invoke(CHANNELS.projectsCompleteLayout, id, done),
    completeRebuild: (id, done) => invoke(CHANNELS.projectsCompleteRebuild, id, done),
    setInputs: (id, inputs) => invoke(CHANNELS.projectsSetInputs, id, inputs),
  },
  viewer: {
    attach: (projectId) => invoke(CHANNELS.viewerAttach, projectId),
    release: () => invoke(CHANNELS.viewerRelease),
    call: (method, ...args) => invoke(CHANNELS.viewerCall, method, args),
  },
  engine: {
    state: () => invoke(CHANNELS.engineState),
    request: (method, params) =>
      startJob<unknown>(CHANNELS.engineRequest, CHANNELS.engineSettled, method, params),
    cancel: (id) => invoke(CHANNELS.engineCancel, id),
    onState: (listener) => subscribe(CHANNELS.engineStateChanged, listener),
    onProgress: (listener) => subscribe(CHANNELS.engineProgress, listener),
    onLog: (listener) => subscribe(CHANNELS.engineLog, listener),
  },
  feeds: {
    pickZip: () => invoke(CHANNELS.feedsPickZip),
  },
  export: {
    run: (projectId, preset) =>
      startJob(CHANNELS.exportRun, CHANNELS.exportSettled, projectId, preset),
    cancel: (id) => invoke(CHANNELS.exportCancel, id),
    reveal: (id) => invoke(CHANNELS.exportReveal, id),
    onProgress: (listener) => subscribe(CHANNELS.exportProgress, listener),
  },
}

contextBridge.exposeInMainWorld('api', api)
