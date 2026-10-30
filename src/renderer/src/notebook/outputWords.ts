// The sentences `Outputs.tsx` draws, apart from the component so that a test
// that must not load React (an end-to-end spec runs in plain Node) can import
// them: a reword is made here, and the unit tests and the specs follow it.

import { presetTitle, type ExportOutput } from '../../../shared/export'
import { momentWords } from '../dates'

/** The way out of the empty state, a link-styled button after the sentence. */
export const EXPORT_ONE = 'Export one in cell 06.'

/** What a row says when its preset is missing from the sidecar. */
export const UNNAMED_PRESET = 'an export'

/**
 * What a row, and its Reveal, call an output: its preset's title (issue
 * 559), the id for a preset the app does not offer, or `UNNAMED_PRESET`.
 */
export const outputName = (preset: string | null): string =>
  preset === null ? UNNAMED_PRESET : presetTitle(preset)

/** The sentence a project with nothing to show says. */
export const NOTHING_YET = 'Nothing exported yet.'

/** What a row says when its file is no longer beside its sidecar. */
export const GONE = 'the file has been moved or deleted'

/** The way out of a replacement, said after what would be replaced. */
export const KEEP_BOTH = 'A filename tag keeps both.'

/**
 * The output an export of `file` would replace: the one already written
 * under that name, and still there. Names are deterministic on purpose
 * (constitution III), so a second export of one choice lands on the first's
 * file; a sidecar whose file has gone replaces nothing, and so says nothing.
 * `rows` is null before the folder has been read, and `file` is null where
 * no plan has answered for the choice as it is now.
 */
export function replacedBy(
  rows: readonly ExportOutput[] | null,
  file: string | null,
): ExportOutput | undefined {
  if (rows === null || file === null) return undefined
  return rows.find((row) => row.present && row.file === file)
}

/**
 * What cell 06 says beside Export while an earlier output has the name the
 * next export will write (issue 563), as one string: the screen draws the
 * moment as a `<time>` element, and the specs quote this.
 */
export const replacesWords = (output: ExportOutput): string =>
  `Exporting replaces ${output.file}, made ${momentWords(output.made)}. ${KEEP_BOTH}`
