// The bridge's main side: one handler per channel, each a validating adapter
// over the store. Arguments arrive from another process, so their shape is
// checked here before the store sees them (the store checks the values
// again: it is the trusted layer and has callers of its own). An error
// thrown here reaches the renderer as a rejected promise, so every message
// is one a person can read and none carries a path.
// Contract: specs/003-project/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import {
  validateAgency,
  validateFeedKey,
  validateId,
  validateMode,
  validateName,
  type CreateProjectInput,
  validateServiceDate,
} from '../shared/project'
import type { LayoutDone } from '../shared/layout'
import type { ProjectStore } from './projects'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function check(problem: string | null): void {
  if (problem !== null) throw new Error(problem)
}

function readId(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('invalid id')
  check(validateId(raw))
  return raw
}

function readName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('name is required')
  check(validateName(raw))
  return raw
}

/**
 * What a finished run hands back. The paths are the engine's answer relayed
 * by the page, so nothing here trusts them beyond their shape; the store
 * checks each one against the engine's home before it opens anything.
 */
function readLayoutDone(raw: unknown): LayoutDone {
  const input = isObject(raw) ? raw : {}
  const date = typeof input.date === 'string' ? input.date : ''
  check(validateServiceDate(date))
  const paths = input.paths
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
    throw new Error('the layout run did not say which stage graphs it built')
  }
  return { date, paths: paths as string[] }
}

function readCreateInput(raw: unknown): CreateProjectInput {
  const input = isObject(raw) ? raw : {}
  const name = readName(input.name)
  // A missing or malformed field fails the same validator a bad value
  // would, so the message is the contract's whatever the shape.
  const feed = typeof input.feed === 'string' ? input.feed : ''
  check(validateFeedKey(feed))
  const mode =
    input.mode === undefined ? undefined : typeof input.mode === 'string' ? input.mode : ''
  if (mode !== undefined) check(validateMode(mode))
  const agency = input.agency == null ? null : input.agency
  if (typeof agency !== 'string' && agency !== null) throw new Error('agency must be text')
  check(validateAgency(agency))
  return { name, feed, mode, agency }
}

export function registerProjectHandlers(
  ipcMain: IpcMain,
  store: ProjectStore,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = (channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      // Only the interface's own top frame reaches the store: a project page
      // in an iframe shares the origin but must not have the bridge.
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler(...args)
    })
  }

  handle(CHANNELS.projectsList, () => store.list())
  handle(CHANNELS.projectsGet, (id) => store.get(readId(id)))
  handle(CHANNELS.projectsCreate, (input) => store.create(readCreateInput(input)))
  handle(CHANNELS.projectsRename, (id, name) => store.rename(readId(id), readName(name)))
  handle(CHANNELS.projectsDelete, (id) => store.delete(readId(id)))
  handle(CHANNELS.projectsCompleteLayout, (id, done) =>
    store.completeLayout(readId(id), readLayoutDone(done)),
  )
}
