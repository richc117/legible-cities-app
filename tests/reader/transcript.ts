// What a scripted VoiceOver run heard, and how it is written down (issue
// 691). Pure: no VoiceOver, no Electron, no file system, so the unit suite
// (tests/unit/reader-record.test.ts) holds every rule here, and the spec
// (tests/reader/voiceover.spec.ts) only gathers the phrases.
//
// Three things live here and nowhere else:
//
// - **The synonyms table**: the words VoiceOver may use for a role or a
//   state. The walkthrough says the role and the state must be said, in
//   whatever words the reader's version uses ("pop-up button" or "combo
//   box", "dimmed" or "unavailable"), so a role or a state is heard when any
//   one of its words is. A role with no row here is an error, never a pass.
// - **What counts as heard**: every wanted text found in what VoiceOver said
//   since the action, compared after `normalise`, which keeps letters and
//   digits and nothing else, so punctuation VoiceOver drops or keeps cannot
//   decide it.
// - **The cell's wording** (docs/accessibility.md, the Reader legend): a
//   clause appended to a VoiceOver cell after a `; `, never a cell
//   overwritten, never `pass`, which is a person's word. Heard is not a pass:
//   no one listened.

/** The states the page can say a control is in, as the spec reads them from the DOM. */
export type State =
  | 'expanded'
  | 'collapsed'
  | 'pressed'
  | 'checked'
  | 'unchecked'
  | 'on'
  | 'off'
  | 'dimmed'
  | 'invalid'
  | 'current'
  | 'required'
  | 'ascending'
  | 'descending'

/**
 * The one synonyms table. Each role and state the page can have, and the
 * words VoiceOver may say for it; any one of them is enough. Keyed by the
 * role Playwright's accessibility snapshot names (`ariaSnapshot()`), which
 * is how the spec reads a control's role.
 *
 * A word is added only where a run heard VoiceOver say it for that role or
 * state, and tests/unit/reader-record.test.ts cites the phrase. From run
 * 43431978278 (VoiceOver 10, macOS 15.8.2), a native select is "menu pop
 * up" ("all (every type) Mode menu pop up collapsed button"). From run
 * 43446490051 (transcript.md line 676), a date field's focused part is a
 * "stepper" ("11 Month Draw for another day stepper Service day region"):
 * so a date field has a role of its own here, `date`, which the spec gives
 * an `<input type="date">`, and no other text field is heard as a stepper.
 */
export const SYNONYMS: {
  readonly roles: Readonly<Record<string, readonly string[]>>
  readonly states: Readonly<Record<State, readonly string[]>>
} = {
  roles: {
    button: ['button'],
    link: ['link'],
    heading: ['heading'],
    combobox: ['pop-up button', 'popup button', 'combo box', 'menu button', 'menu pop up'],
    textbox: ['edit text', 'text field', 'text entry area', 'search text field'],
    date: ['stepper'],
    checkbox: ['checkbox', 'check box'],
    switch: ['switch', 'toggle button', 'checkbox'],
    radio: ['radio button'],
    slider: ['slider'],
    dialog: ['dialog', 'web dialog'],
    alertdialog: ['alert dialog', 'dialog'],
    group: ['group'],
    list: ['list'],
    navigation: ['navigation'],
    region: ['region'],
    complementary: ['complementary'],
    table: ['table'],
    img: ['image'],
    iframe: ['frame', 'html content', 'web content'],
  },
  states: {
    expanded: ['expanded'],
    collapsed: ['collapsed'],
    pressed: ['selected', 'pressed'],
    checked: ['checked', 'selected'],
    unchecked: ['unchecked', 'not checked', 'not selected'],
    on: ['on'],
    off: ['off'],
    dimmed: ['dimmed', 'unavailable'],
    invalid: ['invalid data', 'invalid'],
    current: ['current'],
    required: ['required'],
    ascending: ['ascending'],
    descending: ['descending'],
  },
}

/** What the page says about the control focus is on: the expectation, read from the DOM, never typed. */
export interface Reading {
  role: string
  name: string
  states: State[]
  /** A heading's level. */
  level: number | null
  /** A field's, a select's or a slider's value, as it shows it. */
  value: string | null
  /** The description the page gives it: `aria-description`, or what `aria-describedby` names. */
  description: string | null
}

/**
 * One thing a row expects to hear: shown as `said`, heard when any of `any`
 * is. A `text` is the page's own words (a name, a value, a description, a
 * sentence); a `word` is a role's, a state's or a level's, looked for only
 * in what is left once the texts heard have been taken out, so a role word
 * inside a name cannot stand for the role. A `positive` word (checked,
 * pressed) is not heard in "not checked" or "not selected".
 */
export interface Want {
  said: string
  any: readonly string[]
  kind: 'text' | 'word'
  positive?: boolean
}

/**
 * Letters and digits, lower case, one space between: what VoiceOver says
 * and what the page holds are compared in this form, padded with a space at
 * each end so that a word is matched whole ("checked" is not in
 * "unchecked").
 */
export function normalise(text: string): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'‘]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return ` ${words} `
}

/** What Playwright's `Locator.toString()` gives, which no page says. */
const LOCATOR_TEXT = /\bgetBy[A-Z]\w*\(|\blocator\(/

/**
 * A sentence or a name, wanted as the page has it. Text with no letter or
 * digit in it would be heard in anything, so it is refused.
 */
export function wantText(text: string): Want {
  if (normalise(text).trim() === '') {
    throw new Error(`nothing to hear in ${JSON.stringify(text)}`)
  }
  // A locator's own text is a script's words, never the page's: run
  // 43446490051 wanted "getByRole('region', …).getByRole('button', …)".
  if (LOCATOR_TEXT.test(text)) {
    throw new Error(`a locator is not something to hear: ${JSON.stringify(text)}`)
  }
  return { said: text, any: [text], kind: 'text' }
}

/** A role's words from the table; a role the table does not know is an error, never a pass. */
export function roleWant(role: string): Want {
  const words = SYNONYMS.roles[role]
  if (words === undefined) {
    throw new Error(`the synonyms table has no words for the role "${role}"`)
  }
  return { said: role, any: words, kind: 'word' }
}

/** States a negation can hide: "not checked" and "not selected" are neither. */
const POSITIVE: readonly State[] = ['checked', 'pressed']

export const stateWant = (state: State): Want => ({
  said: state,
  any: SYNONYMS.states[state],
  kind: 'word',
  positive: POSITIVE.includes(state),
})

/**
 * The role and the name in the first line of Playwright's accessibility
 * snapshot of one element (`locator.ariaSnapshot()`): `- button "New
 * project"`, `- heading "Library" [level=1]`, `- textbox "Name": Caltrain`,
 * or, where the line would not be plain YAML, the same in single quotes
 * with a quote doubled. The name is a JSON string; an element with none
 * answers an empty name.
 */
export function parseSnapshotLine(snapshot: string): { role: string; name: string } {
  let line = (snapshot.split('\n')[0] ?? '').trim()
  if (!line.startsWith('- ')) throw new Error(`not a snapshot line: ${line}`)
  line = line.slice(2)
  if (line.startsWith("'")) {
    let end = 1
    while (end < line.length) {
      if (line[end] === "'" && line[end + 1] === "'") end += 2
      else if (line[end] === "'") break
      else end += 1
    }
    line = line.slice(1, end).replace(/''/g, "'")
  }
  const match = /^([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?/.exec(line)
  if (match === null) throw new Error(`no role in the snapshot line: ${line}`)
  return { role: match[1] ?? '', name: match[2] === undefined ? '' : String(JSON.parse(match[2])) }
}

/** Which of a reading's parts a row also wants heard, beyond the name, the role and the states. */
export interface Also {
  value?: boolean
  description?: boolean
}

/**
 * What a control must be heard as: its name, its role's word, each of its
 * states' words, a heading's level, and its value and its description where
 * the row says they are read with it.
 */
export function wantsOf(reading: Reading, also: Also = {}): Want[] {
  if (reading.name.trim() === '') {
    throw new Error(`the ${reading.role} focus is on has no name to hear`)
  }
  const wants: Want[] = [wantText(reading.name)]
  wants.push(roleWant(reading.role))
  for (const state of reading.states) wants.push(stateWant(state))
  if (reading.level !== null) {
    wants.push({ said: `level ${reading.level}`, any: [`level ${reading.level}`], kind: 'word' })
  }
  if (also.value === true && reading.value !== null && reading.value.trim() !== '') {
    wants.push(wantText(reading.value))
  }
  if (also.description === true) {
    if (reading.description === null || reading.description.trim() === '') {
      throw new Error(`"${reading.name}" has no description to hear`)
    }
    wants.push(wantText(reading.description))
  }
  return wants
}

/**
 * States VoiceOver does not say again of a control focus stays on: run
 * 43431978278 heard the refusal's alert and not "invalid" after Enter in
 * Line width, Merge distance and Feed address. A row that wants one listens
 * for it by coming back to the field.
 */
const NOT_SAID_IN_PLACE: readonly State[] = ['invalid']

/**
 * What is to be heard after a key where focus did not move: VoiceOver does
 * not say again a name, a role or a state that has not changed (run
 * 43431978278: "Copy as text" pressed was heard only as "The figures and
 * the caveats are on the clipboard."; "Pause" pressed only as "Play day").
 * So only what changed is wanted: the name, a state, the value where the
 * row reads it. A key that changed none of them wants nothing of the
 * control.
 */
export function changedWants(before: Reading, after: Reading, also: Also = {}): Want[] {
  const wants: Want[] = []
  if (after.name !== before.name) wants.push(wantText(after.name))
  for (const state of after.states) {
    if (!before.states.includes(state) && !NOT_SAID_IN_PLACE.includes(state)) {
      wants.push(stateWant(state))
    }
  }
  if (
    also.value === true &&
    after.value !== null &&
    after.value !== before.value &&
    after.value.trim() !== ''
  ) {
    wants.push(wantText(after.value))
  }
  return wants
}

/**
 * The words a container is heard by: its name and its role together, as
 * VoiceOver says them ("Map region", "Steps navigation", "end of Start
 * from group", "list Projects 1 item"), so a name heard elsewhere ("The
 * map is drawn.") is not the container's. A group or a landmark may be
 * nameless, which a control may not be: then its role alone.
 */
export function containerWants(role: string, name: string): Want[] {
  const words = roleWant(role).any
  if (name.trim() === '') return [roleWant(role)]
  wantText(name)
  return [
    {
      said: `${name} (${role})`,
      any: words.flatMap((word) => [`${name} ${word}`, `${word} ${name}`]),
      kind: 'text',
    },
  ]
}

/**
 * VoiceOver's hints, which describe how to work a control rather than
 * what it is, and so may never supply a word a row wants: "You are
 * currently on a text field…" is not the field heard, and its "on" is not
 * a switch on. A phrase is taken a sentence at a time and these are left
 * out: a sentence that opens "You are currently" or "Press Control-Option",
 * one that tells how to do something with Control-Option ("To exit this
 * group, press Control-Option-Shift-Up Arrow", "Type text or, to display a
 * list of choices, press Control-Option-Space"), and "To enter text in this
 * field, type". The words "contents selected" and "completion selected",
 * which say text is selected in a field ("LA Metro Rail contents selected
 * Name required edit text", "expanded list box Start 90 items completion
 * selected"), are taken out too: they are not a control selected.
 */
export function withoutHints(phrase: string): string {
  return phrase
    .split(/\.\s+/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence !== '' &&
        !/^You are currently\b/.test(sentence) &&
        !/^Press Control-Option\b/.test(sentence) &&
        !/\bpress Control-Option\b/i.test(sentence) &&
        !/^To [^,]+, type\.?$/.test(sentence),
    )
    .map((sentence) => sentence.replace(/\b(?:contents|completion) selected\b/g, ' '))
    .join('. ')
}

/** `text` with its first `part` taken out; both normalised. */
const without = (text: string, part: string): string => {
  const at = text.indexOf(part)
  return at < 0 ? text : `${text.slice(0, at)} ${text.slice(at + part.length)}`
}

/**
 * The wants the phrases do not hold. Texts first, each taken out of what
 * was heard once found; then the role, state and level words, in what is
 * left, with "not checked" and "not selected" taken out too before a
 * positive state is looked for.
 */
export function missing(spoken: readonly string[], wants: readonly Want[]): Want[] {
  let heard = normalise(spoken.map(withoutHints).join(' '))
  const left: Want[] = []
  for (const want of wants.filter((w) => w.kind === 'text')) {
    const found = want.any.map(normalise).find((word) => heard.includes(word))
    if (found === undefined) left.push(want)
    else heard = without(heard, found)
  }
  const affirmed = heard.replace(/ not (?=(checked|selected) )\S+/g, ' ')
  for (const want of wants.filter((w) => w.kind === 'word')) {
    const inText = want.positive === true ? affirmed : heard
    if (!want.any.some((word) => inText.includes(normalise(word)))) left.push(want)
  }
  return wants.filter((want) => left.includes(want))
}

/** The last sentence of a phrase: what VoiceOver said most recently in it. */
const lastSentence = (phrase: string): string =>
  phrase
    .split(/\.\s+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .at(-1) ?? ''

/**
 * What VoiceOver said for one action, without what it had said before it.
 * Guidepup polls for VoiceOver's last phrase and, after some 650 ms of
 * seeing the same one or after an empty capture, reports that phrase as
 * new: so an action can come back with the phrase said just before it.
 * Only that phrase can come back so: the last sentence of what was heard
 * before (`before`, joined by Guidepup with ". "). A sentence of the
 * capture, wherever it sits, that is that sentence or is inside it is
 * dropped. An earlier sentence of what was heard before is not stale: run
 * 43471013113 lost "Name Shown in place of A…", which `tab` had heard
 * when it put focus on the field before stepping back from it, when every
 * sentence heard before was taken for stale.
 */
export function freshPhrase(captured: string, before: readonly string[]): string {
  const recent = before.map(lastSentence).filter((b) => b !== '')
  const stale = (sentence: string): boolean =>
    recent.some((b) => b === sentence || b.includes(sentence))
  const whole = captured.trim()
  if (whole === '' || stale(whole) || stale(whole.replace(/\.$/, ''))) return ''
  return whole
    .split('. ')
    .map((p) => p.trim())
    .filter((p) => p !== '' && !stale(p) && !stale(p.replace(/\.$/, '')))
    .join('. ')
}

/** One action of a row and what VoiceOver said for it. */
export interface Hearing {
  /** What was done, in a person's words: "Tab to New project", "VoiceOver next, from Library". */
  action: string
  /** What had to be heard, as the page has it. */
  wants: string[]
  /** Every phrase captured from the action to the end of the listening. */
  spoken: string[]
  /** What VoiceOver's cursor was on at the end. */
  item: string
  /** The wants not heard; empty when the action was heard. */
  missing: string[]
}

/** How much of a row a script reaches: all of it, part of it, or none. */
export type Scripted = 'full' | 'part' | 'none'

/** A row's run, as the spec hands it over. */
export interface PartResult {
  row: string
  table: string
  scripted: Scripted
  notScripted: string | null
  hearings: Hearing[]
  /** The script stopped: a control was not found, the app did not do what the row needs. */
  error: string | null
}

export type Outcome =
  | { kind: 'heard' }
  | { kind: 'heard in part'; notScripted: string }
  | { kind: 'not heard'; phrase: string; action: string }
  | { kind: 'not scripted' }
  | { kind: 'error'; message: string }

/**
 * A row's outcome. An error is an error whatever was heard before it: the
 * row was not walked to its end. A scripted row with nothing heard at all is
 * an error too, since a script that listened for nothing proves nothing.
 */
export function outcomeOf(result: PartResult): Outcome {
  if (result.scripted === 'none') return { kind: 'not scripted' }
  if (result.error !== null) return { kind: 'error', message: result.error }
  if (result.hearings.length === 0) {
    return { kind: 'error', message: 'the script listened for nothing' }
  }
  const failed = result.hearings.find((h) => h.missing.length > 0)
  if (failed !== undefined) {
    return { kind: 'not heard', phrase: failed.missing[0] ?? '', action: failed.action }
  }
  if (result.scripted === 'part') {
    return { kind: 'heard in part', notScripted: result.notScripted ?? '' }
  }
  return { kind: 'heard' }
}

/** The versions and the run a clause names. */
export interface RunFacts {
  /** VoiceOver's own version, from its Info.plist. */
  voiceOver: string
  macOS: string
  guidepup: string
  app: string
  /** The workflow run's id. */
  run: string
}

const VERSION = /^[\w.]+$/
const APP_VERSION = /^[\w.+-]+$/
const RUN_ID = /^\d+$/

/** `(scripted VoiceOver <v>, macOS <v>, Guidepup <v>, app <v>, run <id>)`, refused when a part would not read back. */
export function runBracket(facts: RunFacts): string {
  const checks: [string, string, RegExp][] = [
    ['VoiceOver', facts.voiceOver, VERSION],
    ['macOS', facts.macOS, VERSION],
    ['Guidepup', facts.guidepup, VERSION],
    ['app', facts.app, APP_VERSION],
    ['run', facts.run, RUN_ID],
  ]
  for (const [what, value, shape] of checks) {
    if (!shape.test(value)) throw new Error(`the ${what} of a scripted run is "${value}"`)
  }
  return `(scripted VoiceOver ${facts.voiceOver}, macOS ${facts.macOS}, Guidepup ${facts.guidepup}, app ${facts.app}, run ${facts.run})`
}

/**
 * An absolute path in a sentence written as `<path>`: the record and the
 * transcript are public, and a folder's path is a machine's, not the app's
 * words. POSIX (`/Users/…`, `/private/…`, `~/…`) and Windows (`C:\…`).
 */
export function withoutPaths(text: string): string {
  // From where the path starts to the end of its phrase segment (a ". ",
  // a ";", a "|", a quote, or the end): a path can hold spaces ("Legible
  // Cities.app"), so a path cut at the first space would leave its tail.
  const rest = String.raw`(?:[^;|"”’]*?)(?=\.\s|\.$|[;|"”’]|$)`
  return text
    .replace(new RegExp(String.raw`(^|[\s("'“‘])(?:~/|/(?=[^\s/]))${rest}`, 'g'), '$1<path>')
    .replace(new RegExp(String.raw`\b[A-Za-z]:\\${rest}`, 'g'), '<path>')
}

/**
 * Free text made safe for a clause: no path, no `;`, which ends a clause,
 * no `|`, which ends a table cell, no line break, and no straight double
 * quote, which closes the not-heard clause's phrase.
 */
export function clauseText(text: string): string {
  return withoutPaths(text).replace(/[;|]/g, ',').replace(/"/g, "'").replace(/\s+/g, ' ').trim()
}

/** Where a person writes the issue a not-heard clause needs; the record refuses the cell until they do. */
export const ISSUE_TO_FILE = '#<issue>'

/**
 * The clause for one row of a screen's table, from the walkthrough rows
 * that write into it, in the record's order. Null where nothing may be
 * written: a script that stopped leaves the cell as it is, and the
 * transcript says why.
 *
 * - any not heard: `not heard (…): "<phrase>" expected after <action>; #<issue>`,
 *   for the first, with `#<issue>` left for the person who files it;
 * - none of them scripted: `not scripted: a person's`;
 * - every one scripted in full and heard: `heard (…)`;
 * - otherwise `heard in part (…): not scripted: <what>`, naming what each
 *   row leaves out.
 */
export function clauseOf(results: readonly PartResult[], facts: RunFacts): string | null {
  if (results.length === 0) return null
  const outcomes = results.map(outcomeOf)
  if (outcomes.some((o) => o.kind === 'error')) return null
  const bracket = runBracket(facts)
  const failed = outcomes.find(
    (o): o is Extract<Outcome, { kind: 'not heard' }> => o.kind === 'not heard',
  )
  if (failed !== undefined) {
    return `not heard ${bracket}: "${clauseText(failed.phrase)}" expected after ${clauseText(failed.action)}; ${ISSUE_TO_FILE}`
  }
  if (outcomes.every((o) => o.kind === 'not scripted')) return "not scripted: a person's"
  if (outcomes.every((o) => o.kind === 'heard')) return `heard ${bracket}`
  const left = results
    .map((result, i) => {
      const outcome = outcomes[i]
      if (outcome?.kind === 'heard in part') return { row: result.row, what: outcome.notScripted }
      if (outcome?.kind === 'not scripted') return { row: result.row, what: 'all of it' }
      return null
    })
    .filter((l): l is { row: string; what: string } => l !== null)
  const what =
    results.length === 1
      ? (left[0]?.what ?? '')
      : left.map((l) => `${l.row}: ${l.what}`).join(' / ')
  return `heard in part ${bracket}: not scripted: ${clauseText(what)}`
}

/** Each screen row's clause, keyed by the start of its Part cell, in the order the rows were run. */
export function clausesByTable(
  results: readonly PartResult[],
  facts: RunFacts,
): Map<string, string> {
  const byTable = new Map<string, PartResult[]>()
  for (const result of results) {
    byTable.set(result.table, [...(byTable.get(result.table) ?? []), result])
  }
  const clauses = new Map<string, string>()
  for (const [table, rows] of byTable) {
    const clause = clauseOf(rows, facts)
    if (clause !== null) clauses.set(table, clause)
  }
  return clauses
}

// ------------------------------------------------------------ the record

/** The first line of the walkthrough and the heading after its last screen. */
const WALKTHROUGH = '## Walking it with a screen reader'
const FIRST_SCREEN = '### Header, on every screen'
const AFTER_WALKTHROUGH = '## Reader runs'

/**
 * The walkthrough's rows, in order: every bullet under its screens that
 * opens with a name in bold, by that name, its closing full stop left off.
 * A bullet runs on over its indented lines, so a bold name broken across
 * two lines is read whole.
 */
export function walkthroughRows(markdown: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.indexOf(WALKTHROUGH)
  if (start < 0) throw new Error(`no "${WALKTHROUGH}" in the record`)
  const first = lines.indexOf(FIRST_SCREEN, start)
  const end = lines.indexOf(AFTER_WALKTHROUGH, start)
  if (first < 0 || end < 0 || end < first) throw new Error('the walkthrough has no screens')
  const bullets: string[] = []
  for (const line of lines.slice(first, end)) {
    if (line.startsWith('- ')) bullets.push(line)
    else if (line.startsWith('  ') && bullets.length > 0 && line.trim() !== '') {
      bullets[bullets.length - 1] += ` ${line.trim()}`
    } else if (!line.startsWith('  ')) bullets.push('')
  }
  return bullets
    .map((bullet) => /^- \*\*(.+?)\*\*/.exec(bullet)?.[1])
    .filter((name): name is string => name !== undefined)
    .map((name) => name.replace(/\s+/g, ' ').replace(/\.$/, ''))
}

/** The cells of a table row, as the record test splits them. */
const cellsOf = (row: string): string[] =>
  row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())

/** A screen's table has nine columns; the VoiceOver cell is the eighth. */
const COLUMNS = 9
const VOICEOVER = COLUMNS - 2

/** Every row of the screens' tables (a table whose header begins "Part"), by its Part cell and its line's index. */
export function screenRows(markdown: string): { part: string; at: number }[] {
  const rows: { part: string; at: number }[] = []
  let inScreenTable = false
  markdown.split('\n').forEach((line, at) => {
    if (!line.startsWith('|')) inScreenTable = false
    else if (cellsOf(line)[0] === 'Part') inScreenTable = true
    else if (inScreenTable && line.startsWith('| ')) rows.push({ part: cellsOf(line)[0] ?? '', at })
  })
  return rows
}

/** The one screen row whose Part cell begins with `table`, or why there is not exactly one. */
export function screenRowOf(markdown: string, table: string): { part: string; at: number } {
  const found = screenRows(markdown).filter((row) => row.part.startsWith(table))
  if (found.length !== 1) {
    throw new Error(`${found.length} screen rows begin "${table}"`)
  }
  return found[0] as { part: string; at: number }
}

/**
 * The record with each clause appended to the VoiceOver cell of its row,
 * after a `; `. Nothing else of the line changes: not the other cells, not
 * the spacing, not what the cell held. A clause that would break the table
 * or a row that cannot be found is refused, never guessed at.
 */
export function appendClauses(markdown: string, clauses: ReadonlyMap<string, string>): string {
  const lines = markdown.split('\n')
  for (const [table, clause] of clauses) {
    if (/[|\n]/.test(clause)) throw new Error(`the clause for "${table}" would break the table`)
    const { at } = screenRowOf(markdown, table)
    const line = lines[at] ?? ''
    const raw = line.slice(1, -1).split('|')
    if (raw.length !== COLUMNS) throw new Error(`the row "${table}" has ${raw.length} cells`)
    const cell = raw[VOICEOVER] ?? ''
    raw[VOICEOVER] = `${cell.replace(/\s+$/, '')}; ${clause} `
    lines[at] = `|${raw.join('|')}|`
  }
  return lines.join('\n')
}

/** The VoiceOver cell of the row whose Part cell begins with `table`. */
export function voiceOverCell(markdown: string, table: string): string {
  const { at } = screenRowOf(markdown, table)
  return cellsOf(markdown.split('\n')[at] ?? '')[VOICEOVER] ?? ''
}

// --------------------------------------------------------- the transcript

/** The heading the job's summary opens with. */
export const NOT_HEARD_HEADING = 'Not heard (each needs an issue before its clause is committed)'

/**
 * The rows not heard, for the top of the job's summary: each is a finding
 * (ADR-063) whose clause carries `#<issue>` until a person files one, not
 * a failure of the run. Says so when there are none.
 */
export function renderNotHeard(results: readonly PartResult[]): string {
  const rows = results
    .map((result) => ({ result, outcome: outcomeOf(result) }))
    .filter(
      (r): r is { result: PartResult; outcome: Extract<Outcome, { kind: 'not heard' }> } =>
        r.outcome.kind === 'not heard',
    )
  const lines = [`## ${NOT_HEARD_HEADING}`, '']
  if (rows.length === 0) lines.push('None.')
  for (const { result, outcome } of rows) {
    lines.push(
      `- **${result.row}**: ${quoted(outcome.phrase)} expected after ${withoutPaths(outcome.action)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

const quoted = (text: string): string => `"${withoutPaths(text).replace(/\s+/g, ' ')}"`

/**
 * The run as a person reads it: each row, its outcome, and for each action
 * what was wanted and what VoiceOver said, word for word. The job's summary
 * and an artefact; what a reviewer compares between two runs.
 */
export function renderTranscript(results: readonly PartResult[], facts: RunFacts | null): string {
  const out: string[] = ['# Scripted VoiceOver run', '']
  out.push(
    facts === null
      ? 'Versions: not all read, so no clause was written.'
      : `VoiceOver ${facts.voiceOver}, macOS ${facts.macOS}, Guidepup ${facts.guidepup}, app ${facts.app}, run ${facts.run}.`,
  )
  out.push(
    '',
    'Heard is not a pass: no one listened. Each phrase below is what VoiceOver said.',
    '',
    `Before any clause is committed to docs/accessibility.md, each ${ISSUE_TO_FILE} in a not-heard clause must be replaced with the number of an issue filed for what was not heard: the record's test refuses the cell until it is.`,
    '',
  )
  const counts = { heard: 0, 'heard in part': 0, 'not heard': 0, 'not scripted': 0, error: 0 }
  for (const result of results) counts[outcomeOf(result).kind] += 1
  out.push(
    `Rows: ${counts.heard} heard, ${counts['heard in part']} heard in part, ${counts['not heard']} not heard, ${counts['not scripted']} not scripted, ${counts.error} stopped.`,
    '',
  )
  for (const result of results) {
    const outcome = outcomeOf(result)
    out.push(`## ${result.row}`, '')
    out.push(`Table row: ${result.table}`)
    switch (outcome.kind) {
      case 'heard':
        out.push('Outcome: heard')
        break
      case 'heard in part':
        out.push(`Outcome: heard in part; not scripted: ${outcome.notScripted}`)
        break
      case 'not heard':
        out.push(
          `Outcome: not heard: ${quoted(outcome.phrase)} expected after ${withoutPaths(outcome.action)}`,
        )
        break
      case 'not scripted':
        out.push(`Outcome: not scripted: ${result.notScripted ?? ''}`)
        break
      case 'error':
        out.push(`Outcome: stopped: ${withoutPaths(outcome.message)}`)
        break
    }
    for (const hearing of result.hearings) {
      out.push('', `- ${withoutPaths(hearing.action)}`)
      out.push(`  - wanted: ${hearing.wants.map(quoted).join(', ')}`)
      out.push(
        `  - spoken: ${hearing.spoken.length === 0 ? '(nothing)' : hearing.spoken.map(quoted).join(' / ')}`,
      )
      out.push(`  - cursor on: ${quoted(hearing.item)}`)
      if (hearing.missing.length > 0) {
        out.push(`  - not heard: ${hearing.missing.map(quoted).join(', ')}`)
      }
    }
    out.push('')
  }
  return out.join('\n')
}
