// Electron wraps an error thrown by an ipcMain.handle handler before the
// renderer sees it: "Error invoking remote method 'projects:create': Error:
// Give the project a name.". The contract's message is the tail; the preload strips
// the wrapper so the renderer shows a sentence, never the plumbing.
//
// Below it, the small helpers every process wrote for itself (issue 598):
// what a thrown value says, whether a value is an object to read, and the
// first capital and the closing stop of a sentence given in other words.
// Each has this one definition, so a change to one is made once.

const WRAPPER = /^Error invoking remote method '[^']*': (?:Error: )?/

export function unwrapIpcError(message: string): string {
  return message.replace(WRAPPER, '')
}

/** What a thrown value says: an error's message, or anything else as a string. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Whether a value is a plain object to read fields from: not null, and not an array. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A text with its first character a capital ("bold, dashed" is "Bold, dashed"). */
export const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * A sentence that already ends: a full stop, a question or exclamation mark,
 * or an ellipsis, with any closing quotes or bracket after it ("…”", ".)").
 */
const STOPPED = /[.!?…][”’")]*$/

/**
 * A sentence with a closing full stop where it has none, so a reason given
 * in someone else's words ends as the sentences around it do; one that
 * already ends is left as it is, and never gets a second stop.
 */
export const fullStopped = (sentence: string): string =>
  STOPPED.test(sentence) ? sentence : `${sentence}.`
