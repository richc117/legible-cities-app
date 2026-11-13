// The update over 0.1.0's pure pieces (docs/acceptance.md, step 22): how
// the two versions' Made is read and compared, what the phases write down
// in upgrade.json and how it is read back, and the record's row made from
// it. Shared by tests/acceptance/upgrade.spec.ts, which drives the phases,
// and tests/acceptance/record-cli.mjs, which writes the row; unit-tested
// without an app (tests/unit/acceptance-upgrade.test.ts). Plain JavaScript,
// so `node` runs the CLI on a runner without a build; upgrade.d.mts gives
// the TypeScript side its types.

/** The version the update is made over. */
export const FROM_VERSION = '0.1.0'

/** The shape of upgrade.json; a file of another shape is refused, not guessed at. */
export const UPGRADE_RECORD = 1

/** The three phases, in the order the workflow runs them. */
export const PHASES = ['seed', 'after', 'back']

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * Every space a formatter may put in a date as one plain space: `\s` is
 * every Unicode space, the no-break one ICU puts before "AM" included.
 */
const plain = (text) => String(text).replace(/\s+/g, ' ').trim()

/** A 12-hour clock's hour as a 24-hour one; null for an hour that is not one. */
function hour24(hour, meridiem) {
  if (meridiem === undefined) return hour <= 23 ? hour : null
  if (hour < 1 || hour > 12) return null
  const pm = meridiem.toUpperCase() === 'PM'
  return (hour % 12) + (pm ? 12 : 0)
}

/** The fields, or null where they name no moment on a calendar. */
function moment(year, month, day, hour, minute, second) {
  if (hour === null || month < 1 || month > 12 || minute > 59) return null
  if (second !== null && second > 59) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  // A day past the month's end rolls into the next month, so the month says it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  return { year, month, day, hour, minute, second }
}

/**
 * The Made of cell 02's strip, as either version writes it, read into the
 * wall-clock fields it names; null for any other text.
 *
 * - 0.1.0 wrote the record's moment with `toLocaleString()`, so in the
 *   runners' locale, en-US: "9/29/2026, 7:16:51 PM", month first, with
 *   seconds.
 * - Later versions write it with `momentWords` (src/renderer/src/dates.ts):
 *   "29 September 2026 at 7:16 PM", or "at 19:16" in a 24-hour locale, with
 *   no seconds.
 *
 * The day-first numeric form another locale's `toLocaleString()` gives is
 * not read: "5/11/2026" cannot say which figure is the month. A misreading
 * would only make a comparison with the record's own moment fail, never
 * pass, since `madeAt` holds every field to it.
 */
export function parseMade(text) {
  const t = plain(text)
  const numeric =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AP]M))?$/i.exec(t)
  if (numeric !== null) {
    const [, month, day, year, hour, minute, second, meridiem] = numeric
    return moment(
      Number(year),
      Number(month),
      Number(day),
      hour24(Number(hour), meridiem),
      Number(minute),
      second === undefined ? null : Number(second),
    )
  }
  const words =
    /^(\d{1,2}) ([A-Za-z]+) (\d{4}) at (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AP]M))?$/i.exec(t)
  if (words !== null) {
    const [, day, monthName, year, hour, minute, second, meridiem] = words
    const month = MONTHS.indexOf(monthName.toLowerCase()) + 1
    if (month === 0) return null
    return moment(
      Number(year),
      month,
      Number(day),
      hour24(Number(hour), meridiem),
      Number(minute),
      second === undefined ? null : Number(second),
    )
  }
  return null
}

/** An ISO moment's wall-clock fields in `timeZone` (the machine's own by default). */
export function localFields(iso, timeZone) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

/** Whether two sets of fields agree to the minute, and to the second where both have one. */
function agree(a, b) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    (a.second === null || b.second === null || a.second === b.second)
  )
}

/**
 * Whether a strip's Made names the record's moment `iso`, as it would be read
 * on a clock in `timeZone`: every field the text has, to the second where it
 * gives seconds. False for a text neither version writes.
 */
export function madeAt(text, iso, timeZone) {
  const read = parseMade(text)
  const want = localFields(iso, timeZone)
  return read !== null && want !== null && agree(read, want)
}

/**
 * Whether two strips' Made, each in its own version's words, name the same
 * moment: to the minute, and to the second where both give one. False where
 * either is a text neither version writes. Never a comparison of the words.
 */
export function sameMade(a, b) {
  const one = parseMade(a)
  const two = parseMade(b)
  return one !== null && two !== null && agree(one, two)
}

// ------------------------------------------------------------- upgrade.json

const SHA256 = /^[0-9a-f]{64}$/
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** What the seed writes down, each with the test its value must pass. */
const SEED_FIELDS = {
  version: (v) => typeof v === 'string' && v !== '',
  userData: (v) => typeof v === 'string' && v !== '',
  exportFolder: (v) => typeof v === 'string' && v !== '',
  projectFile: (v) => typeof v === 'string' && v !== '',
  projectVersion: (v) => Number.isInteger(v),
  layout: (v) => typeof v === 'string' && v !== '',
  layoutId: (v) => typeof v === 'string' && v !== '',
  made: (v) => typeof v === 'string' && v !== '',
  madeIso: (v) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime()),
  date: (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
  projectSha256: (v) => typeof v === 'string' && SHA256.test(v),
  exportFile: (v) => typeof v === 'string' && v !== '',
  exportSha256: (v) => typeof v === 'string' && SHA256.test(v),
}

/** What `after` writes down for `back`. */
const AFTER_FIELDS = {
  version: (v) => typeof v === 'string' && v !== '',
  projectSha256: (v) => typeof v === 'string' && SHA256.test(v),
}

function checkFields(where, value, fields) {
  if (!isObject(value)) throw new Error(`upgrade.json's ${where} is not an object`)
  for (const [name, ok] of Object.entries(fields)) {
    if (!(name in value)) throw new Error(`upgrade.json's ${where} has no ${name}`)
    if (!ok(value[name])) {
      throw new Error(`upgrade.json's ${where}.${name} is not one: ${JSON.stringify(value[name])}`)
    }
  }
}

/**
 * upgrade.json's text read back and checked: what each phase wrote down and
 * how it went. Throws a sentence for anything else - not JSON, another
 * shape, a field missing or of the wrong kind - rather than letting a later
 * phase compare with a value that is not there. `seed` and `after` are
 * there only once their phase finished; `phases` holds every phase that ran.
 */
export function readUpgrade(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('upgrade.json is not JSON')
  }
  if (!isObject(value)) throw new Error('upgrade.json is not an object')
  if (value.record !== UPGRADE_RECORD) {
    throw new Error(`upgrade.json is record ${JSON.stringify(value.record)}, not ${UPGRADE_RECORD}`)
  }
  if (!isObject(value.phases)) throw new Error("upgrade.json's phases is not an object")
  for (const [name, phase] of Object.entries(value.phases)) {
    if (!PHASES.includes(name)) throw new Error(`upgrade.json names a phase ${name}`)
    if (!isObject(phase) || typeof phase.ok !== 'boolean') {
      throw new Error(`upgrade.json's ${name} phase does not say whether it passed`)
    }
    if (!strings(phase.problems) || !strings(phase.notes)) {
      throw new Error(`upgrade.json's ${name} phase has no list of problems and notes`)
    }
    if (phase.ok && phase.problems.length > 0) {
      throw new Error(`upgrade.json's ${name} phase passed with problems`)
    }
  }
  if ('seed' in value) checkFields('seed', value.seed, SEED_FIELDS)
  if ('after' in value) checkFields('after', value.after, AFTER_FIELDS)
  return value
}

/** The seed's own record, or a sentence saying a later phase has nothing to compare with. */
export function seedOf(upgrade) {
  if (upgrade.seed === undefined) {
    throw new Error('the seed wrote nothing down, so there is nothing to compare with')
  }
  return upgrade.seed
}

// --------------------------------------------------------------- the row

/** What a machine cannot say about the update, said in every row. */
export const NOT_AUTOMATED =
  "Not automated: whether the stations are where 0.1.0 drew them (the map after the update is kept as upgrade-after-map.png); whether Reveal brought the Finder or File Explorer forward with the file selected; the Finder's Replace and the warnings, since each version was installed by the workflow, not by a person (on a Mac the bundle removed and the new one copied into Applications, on Windows the installer run silently with /S)."

/**
 * Step 22's row from upgrade.json and the workflow's own outcome of each of
 * its steps (`[name, outcome]`, GitHub's success, failure, cancelled or
 * skipped). It passes only where every step succeeded and every phase wrote
 * that it passed; anything else is a failure that says which. `upgrade` is
 * what `readUpgrade` answered, or the sentence it threw.
 */
export function upgradeRow(upgrade, outcomes) {
  const problems = []
  for (const [name, outcome] of outcomes) {
    if (outcome !== 'success') problems.push(`${name}: ${outcome === '' ? 'did not run' : outcome}`)
  }
  const notes = []
  if (typeof upgrade === 'string') {
    problems.push(upgrade)
  } else {
    for (const phase of PHASES) {
      const ran = upgrade.phases[phase]
      if (ran === undefined) {
        problems.push(`the ${phase} phase wrote nothing`)
        continue
      }
      for (const problem of ran.problems) problems.push(`${phase}: ${problem}`)
      if (!ran.ok && ran.problems.length === 0) problems.push(`${phase}: did not pass`)
      for (const note of ran.notes) notes.push(note)
    }
  }
  const previous =
    typeof upgrade !== 'string' && upgrade.seed !== undefined
      ? upgrade.seed.version
      : `not known: the ${FROM_VERSION} phase wrote nothing down`
  const result = problems.length === 0 ? 'pass, part not automated' : 'fail'
  const text = [
    ...problems.map((p) => `Failed: ${p.replace(/\.$/, '')}.`),
    ...notes,
    NOT_AUTOMATED,
  ].join(' ')
  return { result, notes: text, previous }
}
