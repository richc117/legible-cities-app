import type { IpcMain } from 'electron'
import { CHANNELS, type ProjectSummary } from '../shared/api'

/** The Library is always empty in the skeleton; A1-05 gives it content. */
export function registerLibrary(ipc: IpcMain): void {
  ipc.handle(CHANNELS.libraryList, async (): Promise<ProjectSummary[]> => [])
}
