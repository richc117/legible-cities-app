// A day in words, "17 September 2026", for both processes (issue 559): the
// interface writes every day this way, and the store's refusal of a day
// outside the feed's window is shown on screen as the store wrote it, so it
// must write the window's days the same way. `src/renderer/src/dates.ts`
// holds the rest of the interface's formatters and the reasons for the form.
//
// Nothing is imported, so an end-to-end spec running in plain Node can
// import it. The formatter is made when it is asked for rather than once at
// load, so a test can move the zone under it and see that it does not move.

/** "2026-09-17", the record's form of a day. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The parts of a day, as the export's title writes them. */
export const DAY_PARTS = { day: 'numeric', month: 'long', year: 'numeric' } as const

/**
 * A day the record holds, "2026-09-17", as "17 September 2026".
 *
 * **In UTC, and it must be.** A day has no zone; `Date` gives it one, UTC
 * midnight, and read in the person's zone that is the evening before
 * anywhere west of Greenwich, so a map drawn for 17 September would say it
 * was drawn for the 16th in Los Angeles. It is the same in either process
 * for the same reason: nothing about it depends on the machine. A string
 * that is not a day comes back as it was.
 */
export function dayWords(day: string): string {
  if (!DAY.test(day)) return day
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('en-GB', { ...DAY_PARTS, timeZone: 'UTC' }).format(date)
}
