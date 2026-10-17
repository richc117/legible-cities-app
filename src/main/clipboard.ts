// The one place a copy waits for the clipboard. Electron 44 answers
// `clipboard.writeText` with a promise, and a copy that is not awaited reports
// success whatever the platform said (issue 432, R5-05). A refusal reaches the
// page as an ordinary error with a sentence of ours: the platform's own
// message is logged by the caller if it wants it, never handed on.

import { log } from './log'

export type WriteText = (text: string) => Promise<void>

/** Write `text`; a refusal, or a writer that throws, becomes the one sentence below. */
export async function writeClipboard(writeText: WriteText, text: string): Promise<void> {
  try {
    await writeText(text)
  } catch (error) {
    log.warn(
      'clipboard',
      `the clipboard refused a copy (${error instanceof Error ? error.name : 'unknown'})`,
    )
    throw new Error('the text could not be copied', { cause: error })
  }
}
