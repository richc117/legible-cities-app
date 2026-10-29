// The sentences `Outputs.tsx` draws, apart from the component so that a test
// that must not load React (an end-to-end spec runs in plain Node) can import
// them: a reword is made here, and the unit tests and the specs follow it.

/** The way out of the empty state, a link-styled button after the sentence. */
export const EXPORT_ONE = 'Export one in cell 06.'

/** What a row says when its preset is missing from the sidecar. */
export const UNNAMED_PRESET = 'an export'

/** The sentence a project with nothing to show says. */
export const NOTHING_YET = 'Nothing exported yet.'

/** What a row says when its file is no longer beside its sidecar. */
export const GONE = 'the file has been moved or deleted'
