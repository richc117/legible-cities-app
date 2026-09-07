// Electron wraps an error thrown by an ipcMain.handle handler before the
// renderer sees it: "Error invoking remote method 'projects:create': Error:
// name is required". The contract's message is the tail; the preload strips
// the wrapper so the renderer shows a sentence, never the plumbing.

const WRAPPER = /^Error invoking remote method '[^']*': (?:Error: )?/

export function unwrapIpcError(message: string): string {
  return message.replace(WRAPPER, '')
}
