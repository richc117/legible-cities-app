import type { JSX } from 'react'
import { momentWords } from '../dates'

// A moment the record holds, in the interface's words for one (`dates.ts`,
// issue 559) with the exact value kept on the element. `ProjectView.tsx`'s own, moved: cell 02
// says when a layout was made and the footer when the project was created
// and last changed, so it is a file rather than a function in one of them.

/** The record's times are ISO 8601 in UTC; a person reads the day and their own time. */
export default function Time({ iso }: { iso: string }): JSX.Element {
  return <time dateTime={iso}>{momentWords(iso)}</time>
}
