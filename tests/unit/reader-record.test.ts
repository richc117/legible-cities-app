import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PARTS, PHASES } from '../reader/parts'
import {
  ISSUE_TO_FILE,
  SYNONYMS,
  appendClauses,
  clauseOf,
  clausesByTable,
  missing,
  normalise,
  outcomeOf,
  parseSnapshotLine,
  roleWant,
  screenRows,
  voiceOverCell,
  walkthroughRows,
  wantsOf,
  type Hearing,
  type PartResult,
  type RunFacts,
} from '../reader/transcript'

// The scripted VoiceOver run (issue 691, tests/reader/) against the record
// it writes into, docs/accessibility.md:
//
// 1. every row of the walkthrough has one part, keyed by its bold name and
//    in the walkthrough's order, and every part has a row, so a row cannot
//    be added unwalked or renamed out from under its script;
// 2. every part names one row of the screens' tables, whose VoiceOver cell
//    its result goes into;
// 3. a part says how much of its row is scripted, and what it leaves to a
//    person and why, in words a cell can hold;
// 4. no part types a sentence it expects to hear: what is heard is read
//    from the page or imported from `src/`;
// 5. what counts as heard, and the clause written for it, are the Reader
//    legend's: appended after a `; `, never overwriting, never `pass`.

const root = join(__dirname, '..', '..')
const record = readFileSync(join(root, 'docs', 'accessibility.md'), 'utf8')
const partsSource = readFileSync(join(root, 'tests', 'reader', 'parts.ts'), 'utf8')

const FACTS: RunFacts = {
  voiceOver: '10',
  macOS: '15.8.2',
  guidepup: '0.40.0',
  app: '1.0.0-rc.3',
  run: '43397139455',
}

const hearing = (missingWords: string[] = []): Hearing => ({
  action: 'Tab to New project',
  wants: ['New project', 'button'],
  spoken: ['New project button list Projects 1 item'],
  item: 'New project button',
  missing: missingWords,
})

const result = (over: Partial<PartResult>): PartResult => ({
  row: 'Heading and New project',
  table: 'Heading, and the New project card first among the cards',
  scripted: 'full',
  notScripted: null,
  hearings: [hearing()],
  error: null,
  ...over,
})

// The Reader legend's four clauses, as tests/unit/accessibility-record.test.ts
// reads them (issue 694), so a clause this run writes is one that test lets
// stand. `#<issue>` is left for the person who files it, and that test
// refuses the cell until they have.
const SCRIPTED_RUN = String.raw`\(scripted VoiceOver [\w.]+, macOS [\w.]+, Guidepup [\w.]+, app [\w.+-]+, run \d+\)`
const LEGEND = [
  new RegExp(String.raw`^heard ${SCRIPTED_RUN}$`),
  new RegExp(String.raw`^heard in part ${SCRIPTED_RUN}: not scripted: [^;|]+$`),
  new RegExp(
    String.raw`^not heard ${SCRIPTED_RUN}: "[^"]+" expected after [^;|]+; ${ISSUE_TO_FILE}$`,
  ),
  /^not scripted: a person's$/,
]
const legendForm = (clause: string): number => LEGEND.findIndex((form) => form.test(clause))

describe('the parts and the walkthrough', () => {
  const rows = walkthroughRows(record)

  it('reads the walkthrough’s rows', () => {
    expect(rows.length).toBeGreaterThan(60)
    expect(rows[0]).toBe('Jobs toggle, Settings')
    expect(rows).toContain('Geographic view, while a layout runs')
    expect(rows).toContain(
      'The dialog: its details disclosure, Copy diagnostics, How to install, OK',
    )
    expect(rows.at(-1)).toBe('The dialog and OK')
  })

  it('has one part per row, by the row’s bold name, in the walkthrough’s order', () => {
    expect(PARTS.map((part) => part.row)).toEqual(rows)
  })

  it('puts each part’s result in one row of the screens’ tables', () => {
    expect(screenRows(record).length).toBeGreaterThan(60)
    const unplaced = PARTS.filter(
      (part) => screenRows(record).filter((row) => row.part.startsWith(part.table)).length !== 1,
    ).map((part) => `${part.row} → ${part.table}`)
    expect(unplaced, 'a part whose table row is not exactly one row').toEqual([])
  })

  it('says what a part leaves to a person, in words a cell can hold', () => {
    const wrong = PARTS.filter((part) => {
      if (part.scripted === 'full') return 'notScripted' in part
      const what = part.notScripted
      return what.trim() === '' || /[;|\n"]/.test(what) || /\.$/.test(what)
    }).map((part) => part.row)
    expect(wrong).toEqual([])
  })

  it('scripts every part it says it scripts, in a phase of the session', () => {
    for (const part of PARTS) {
      if (part.scripted === 'none') {
        expect('run' in part, part.row).toBe(false)
        continue
      }
      expect(typeof part.run, part.row).toBe('function')
      expect(PHASES, part.row).toContain(part.phase)
    }
  })

  it('scripts most rows, and leaves some to a person', () => {
    const count = (kind: string): number => PARTS.filter((p) => p.scripted === kind).length
    expect(count('full')).toBeGreaterThan(5)
    expect(count('part')).toBeGreaterThan(20)
    expect(count('none')).toBeGreaterThan(0)
  })

  it('types no sentence it expects to hear', () => {
    // A string of four words or more ending in a full stop is a sentence:
    // what is heard is read from the page or imported from src/.
    const literals = [...partsSource.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map(
      (m) => m[1] ?? m[2] ?? '',
    )
    const sentences = literals.filter((t) => /\.$/.test(t) && t.trim().split(/\s+/).length >= 4)
    expect(sentences).toEqual([])
  })
})

describe('what counts as heard', () => {
  it('compares letters and digits only, a word whole', () => {
    expect(normalise('Engine ready (0.21.1).')).toBe(' engine ready 0 21 1 ')
    expect(normalise('Los Angeles · Metro Rail')).toBe(' los angeles metro rail ')
    expect(normalise('The engine’s own')).toBe(' the engines own ')
    expect(
      missing(
        ['LA Metro Rail, Los Angeles · Metro Rail, not downloaded yet button'],
        [{ said: 'name', any: ['LA Metro Rail, Los Angeles · Metro Rail, not downloaded yet'] }],
      ),
    ).toEqual([])
    // "checked" is not heard in "unchecked".
    expect(
      missing(['Station names unchecked checkbox'], [{ said: 'checked', any: ['checked'] }]),
    ).toHaveLength(1)
  })

  it('wants the name, a word of the role and of each state, and the level', () => {
    const wants = wantsOf({
      role: 'button',
      name: 'Jobs, none running',
      states: ['collapsed'],
      level: null,
      value: null,
      description: null,
    })
    expect(wants.map((w) => w.said)).toEqual(['Jobs, none running', 'button', 'collapsed'])
    expect(missing(['Jobs, none running, collapsed, button'], wants)).toEqual([])
    expect(missing(['Jobs, none running, button'], wants).map((w) => w.said)).toEqual(['collapsed'])
    const select = wantsOf(
      {
        role: 'combobox',
        name: 'Speed',
        states: [],
        level: null,
        value: '1 hour a minute',
        description: null,
      },
      { value: true },
    )
    expect(missing(['Speed, 1 hour a minute, pop-up button'], select)).toEqual([])
    expect(missing(['Speed, 1 hour a minute, combo box'], select)).toEqual([])
    const heading = wantsOf({
      role: 'heading',
      name: 'Library',
      states: [],
      level: 1,
      value: null,
      description: null,
    })
    expect(missing(['Library heading level 1'], heading)).toEqual([])
    expect(missing(['Library heading level 2'], heading).map((w) => w.said)).toEqual(['level 1'])
  })

  it('refuses a role the table has no words for, and a description that is not there', () => {
    expect(() => roleWant('treegrid')).toThrow(/synonyms table/)
    expect(Object.keys(SYNONYMS.roles)).toContain('button')
    expect(() =>
      wantsOf(
        { role: 'button', name: 'X', states: [], level: null, value: null, description: null },
        { description: true },
      ),
    ).toThrow(/no description/)
  })

  it('reads a role and a name from an accessibility snapshot', () => {
    expect(parseSnapshotLine('- button "New project"')).toEqual({
      role: 'button',
      name: 'New project',
    })
    expect(parseSnapshotLine('- heading "Library" [level=1]')).toEqual({
      role: 'heading',
      name: 'Library',
    })
    expect(parseSnapshotLine('- textbox "Name": Caltrain')).toEqual({
      role: 'textbox',
      name: 'Name',
    })
    expect(parseSnapshotLine("- 'button \"Copy log: the engine''s log for this run\"'")).toEqual({
      role: 'button',
      name: "Copy log: the engine's log for this run",
    })
    expect(parseSnapshotLine('- button "Say \\"hi\\""')).toEqual({
      role: 'button',
      name: 'Say "hi"',
    })
    expect(parseSnapshotLine('- iframe')).toEqual({ role: 'iframe', name: '' })
  })
})

describe('what is written in the VoiceOver cell', () => {
  it('words each outcome as the Reader legend does', () => {
    expect(legendForm(clauseOf([result({})], FACTS) ?? '')).toBe(0)
    expect(
      legendForm(
        clauseOf([result({ scripted: 'part', notScripted: 'the same with projects' })], FACTS) ??
          '',
      ),
    ).toBe(1)
    const notHeard = clauseOf([result({ hearings: [hearing(['New project'])] })], FACTS) ?? ''
    expect(legendForm(notHeard)).toBe(2)
    expect(notHeard).toContain('"New project" expected after Tab to New project')
    expect(clauseOf([result({ scripted: 'none', notScripted: 'why', hearings: [] })], FACTS)).toBe(
      "not scripted: a person's",
    )
  })

  it('never writes pass, and writes nothing for a row whose script stopped', () => {
    expect(clauseOf([result({ error: 'no button "New project"' })], FACTS)).toBeNull()
    expect(clauseOf([result({ hearings: [] })], FACTS)).toBeNull()
    expect(outcomeOf(result({ hearings: [] })).kind).toBe('error')
    for (const clause of [
      clauseOf([result({})], FACTS),
      clauseOf([result({ scripted: 'part', notScripted: 'x' })], FACTS),
    ]) {
      expect(clause).not.toMatch(/\bpass\b/)
    }
  })

  it('makes one clause of the rows that share a table row', () => {
    const clause = clauseOf(
      [
        result({ row: 'Geographic view', scripted: 'part', notScripted: 'the keys' }),
        result({
          row: 'Geographic view, while a layout runs',
          scripted: 'none',
          notScripted: 'a layout watched',
          hearings: [],
        }),
      ],
      FACTS,
    )
    expect(legendForm(clause ?? '')).toBe(1)
    expect(clause).toContain(
      'not scripted: Geographic view: the keys / Geographic view, while a layout runs: all of it',
    )
    // A not heard in any of them is the cell's.
    const failed = clauseOf(
      [result({}), result({ row: 'B', hearings: [hearing(['collapsed'])] })],
      FACTS,
    )
    expect(legendForm(failed ?? '')).toBe(2)
  })

  it('keeps the clause in one cell and one clause', () => {
    const clause =
      clauseOf(
        [
          result({
            hearings: [
              {
                ...hearing(['A "quoted"; phrase | here']),
                action: 'Enter; then | more',
              },
            ],
          }),
        ],
        FACTS,
      ) ?? ''
    expect(legendForm(clause)).toBe(2)
  })

  it('refuses versions that would not read back', () => {
    expect(() => clauseOf([result({})], { ...FACTS, run: 'local' })).toThrow(/run/)
    expect(() => clauseOf([result({})], { ...FACTS, voiceOver: '' })).toThrow(/VoiceOver/)
  })

  it('appends to a cell and changes nothing else', () => {
    const table = 'Heading, and the New project card first among the cards'
    const before = voiceOverCell(record, table)
    const clauses = clausesByTable([result({})], FACTS)
    const after = appendClauses(record, clauses)
    expect(voiceOverCell(after, table)).toBe(`${before}; ${clauses.get(table)}`)
    const changed = after
      .split('\n')
      .map((line, i) => ({ line, was: record.split('\n')[i] }))
      .filter(({ line, was }) => line !== was)
    expect(changed).toHaveLength(1)
    const [line] = changed
    const cells = (row: string): string[] => row.split('|')
    // Every cell but the VoiceOver one is the same, byte for byte.
    const kept = (row: string): string[] => cells(row).filter((_, i) => i !== 8)
    expect(kept(line?.line ?? '')).toEqual(kept(line?.was ?? ''))
    expect(cells(line?.line ?? '')).toHaveLength(cells(line?.was ?? '').length)
  })

  it('refuses a row it cannot find, or a clause that would break the table', () => {
    expect(() => appendClauses(record, new Map([['No such part', 'heard']]))).toThrow(
      /0 screen rows/,
    )
    expect(() => appendClauses(record, new Map([['Fields', 'a | b']]))).toThrow(/break the table/)
  })
})
