import type { JSX } from 'react'

// A moment the record holds, read in the person's own locale with the
// exact value kept on the element. `ProjectView.tsx`'s own, moved: cell 02
// says when a layout was made and the footer when the project was created
// and last changed, so it is a file rather than a function in one of them.

/** The record's times are ISO 8601 in UTC; a person reads them in their own locale. */
export default function Time({ iso }: { iso: string }): JSX.Element {
  const date = new Date(iso)
  return <time dateTime={iso}>{Number.isNaN(date.getTime()) ? iso : date.toLocaleString()}</time>
}
