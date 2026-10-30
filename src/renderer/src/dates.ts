// The interface's only date formatters (issue 559). Before them the screen
// said one day three ways at once: "laid out 9/29/2026, 7:16:51 PM" from
// `toLocaleString()`, "Drawn for 2026-09-17" as the record holds it, and the
// date control's own "09/17/2026". A day is now written as the export's
// title writes it, "17 September 2026": the month in words, so nobody has
// to know which order the figures come in, and day-month-year because the
// app's voice is British (DESIGN.md 11). A moment adds the time in the
// person's own hour cycle, with no seconds, which no sentence here needs.
//
// ISO stays where it is the value and not the words: a date control's
// value, a copied log, and a sentence of the engine's shown as it wrote it.
//
// Nothing is imported, so an end-to-end spec running in plain Node can
// import these and compare what the screen says with the record. Each
// formatter is made when it is asked for rather than once at load: one made
// at load keeps the zone it was made in, so a machine moved across zones
// would go on reading the old one, and a test could not move the zone
// under it.

/** "2026-09-17", the record's form of a day. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

const dayParts = { day: 'numeric', month: 'long', year: 'numeric' } as const

/**
 * A day the record holds, "2026-09-17", as "17 September 2026".
 *
 * **In UTC, and it must be.** A day has no zone; `Date` gives it one, UTC
 * midnight, and read in the person's zone that is the evening before
 * anywhere west of Greenwich, so a map drawn for 17 September would say it
 * was drawn for the 16th in Los Angeles. A string that is not a day comes
 * back as it was, which is what the screen said before.
 */
export function dayWords(day: string): string {
  if (!DAY.test(day)) return day
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat('en-GB', { ...dayParts, timeZone: 'UTC' }).format(date)
}

/**
 * A time of day, in the person's own locale and hour cycle and with no
 * seconds: "7:16 PM" for one person, "19:16" for another.
 */
export function timeWords(when: Date | number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(when)
}

/**
 * A moment the record holds, ISO 8601 in UTC, as "29 September 2026 at
 * 7:16 PM": the day as `dayWords` writes it and then `timeWords`.
 *
 * Unlike `dayWords`, the day is the person's: a moment is a point in time,
 * so its day is the one their clock was on, and the time beside it is read
 * in their zone too. 02:16 UTC on 30 September is 7:16 PM on the 29th in
 * Los Angeles, and saying the 30th there would put the two halves a day
 * apart. A string that is not a moment comes back as it was.
 */
export function momentWords(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${new Intl.DateTimeFormat('en-GB', dayParts).format(date)} at ${timeWords(date)}`
}
