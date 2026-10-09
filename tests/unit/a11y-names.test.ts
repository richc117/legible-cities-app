// The sweep's rule for a name said twice, nested (issue 208), over the text
// of Playwright's snapshot of the accessibility tree.
//
// The fixtures are the snapshot's own text. Each shape below was taken from
// `locator.ariaSnapshot()` over a page in Chromium and then cut down, so
// the quoting, the attributes and the indentation are Playwright's and not
// a guess at them. What only the running app shows - which pairs its
// screens actually hold - is the sweep's, in `tests/e2e/`.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  describePair,
  describeReading,
  duplicatedNames,
  KNOWN_PAIRS,
  NAMED_BY_CONTENT,
  type KnownPair,
  type Reading,
} from '../support/a11y-names'

// Two ways to ask, and every test says which it means. `read` and `pairsOf`
// are the rule alone, with no pair decided, so that what is asserted about
// the rule does not move when an entry joins `KNOWN_PAIRS` or leaves it.
// `swept` is the rule as the sweep runs it, with that list.

/** The rule alone over a snapshot, or with the pairs given. */
const read = (snapshot: string, known: readonly KnownPair[] = []): Reading =>
  duplicatedNames(snapshot, known)

/**
 * The pairs of a reading, each on its one line, **and every line of the
 * fixture was read**. Without that a fixture line the rule had stopped
 * reading would leave a test that expects no pair green for the wrong
 * reason: nothing found, because nothing was looked at. The one test about
 * unreadable lines asks `read` and not this.
 */
const described = (reading: Reading): string[] => {
  expect(reading.unread, 'every line of the fixture is read').toEqual([])
  return reading.pairs.map(describePair)
}

/** The pairs of a snapshot: the rule alone, or with the pairs given. */
const pairsOf = (snapshot: string, known: readonly KnownPair[] = []): string[] =>
  described(read(snapshot, known))

/** The pairs the sweep would report: the rule with the list it ships with. */
const swept = (snapshot: string): string[] => described(duplicatedNames(snapshot))

// What the engine log's panel drew before it was fixed: the disclosure's
// region and the box of lines inside it, under one name.
const ENGINE_LOG = [
  '- main:',
  '  - heading "Bart" [level=1]',
  '  - button "The engine\'s log" [expanded]',
  '  - region "The engine\'s log for this run":',
  '    - group "The engine\'s log for this run": line one line two',
].join('\n')

describe('a name repeated inside the element it names', () => {
  it('is found: a region and, inside it, a group with the region’s name', () => {
    const { pairs, unread } = read(ENGINE_LOG)
    expect(unread).toEqual([])
    expect(pairs).toEqual([
      {
        ancestor: { role: 'region', name: "The engine's log for this run", line: 4 },
        node: { role: 'group', name: "The engine's log for this run", line: 5 },
        path: [
          'main',
          'region "The engine\'s log for this run"',
          'group "The engine\'s log for this run"',
        ],
      },
    ])
  })

  it('is not found once the inner name is its own', () => {
    const fixed = ENGINE_LOG.replace('group "The engine\'s log for this run"', 'group "Log lines"')
    expect(fixed).not.toBe(ENGINE_LOG)
    expect(read(fixed)).toEqual({ pairs: [], unread: [] })
  })

  it('is found however far down the node is', () => {
    const deep = [
      '- region "Export":',
      '  - group "Options":',
      '    - list:',
      '      - listitem:',
      '        - group "Export"',
    ].join('\n')
    expect(pairsOf(deep)).toEqual(['region "Export" contains group "Export"'])
  })

  it('is found once for each ancestor that has the name', () => {
    const thrice = ['- region "Log":', '  - group "Log":', '    - group "Log"'].join('\n')
    expect(pairsOf(thrice)).toEqual([
      'region "Log" contains group "Log"',
      'region "Log" contains group "Log"',
      'group "Log" contains group "Log"',
    ])
    expect(read(thrice).pairs.map((pair) => [pair.ancestor.line, pair.node.line])).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ])
  })

  it('compares the name whole, and by case', () => {
    const near = [
      '- region "Export":',
      '  - group "Export options"',
      '  - group "export"',
      '  - group "Export "',
    ].join('\n')
    expect(pairsOf(near)).toEqual([])
  })
})

describe('what is nested and what is not', () => {
  it('two siblings with one name are not a pair', () => {
    const siblings = ['- main:', '  - group "Lines"', '  - group "Lines"'].join('\n')
    expect(pairsOf(siblings)).toEqual([])
  })

  it('a node that follows a branch is not inside it', () => {
    const after = [
      '- main:',
      '  - region "Export":',
      '    - list:',
      '      - listitem: PNG',
      '  - group "Export"',
      '- group "Export"',
    ].join('\n')
    expect(pairsOf(after)).toEqual([])
  })

  it('depth is deeper than, not a count of spaces', () => {
    const uneven = [
      '- region "Export":',
      '      - group "Export"',
      '   - group "Export"',
      '- group "Export"',
    ].join('\n')
    expect(pairsOf(uneven)).toEqual([
      'region "Export" contains group "Export"',
      'region "Export" contains group "Export"',
    ])
    expect(read(uneven).pairs.map((pair) => pair.node.line)).toEqual([2, 3])
  })
})

describe('the heading that names its section', () => {
  const SECTION = [
    '- main "Settings":',
    '  - heading "Settings" [level=1]',
    '  - region "Folders":',
    '    - heading "Folders" [level=2]',
    '    - paragraph: Where things go.',
    '- dialog "Delete Bart?":',
    '  - heading "Delete Bart?" [level=2]',
  ].join('\n')

  it('is not a pair', () => {
    expect(read(SECTION)).toEqual({ pairs: [], unread: [] })
  })

  it('and the same names on anything but a heading are', () => {
    expect(pairsOf(SECTION.replaceAll('heading', 'group'))).toEqual([
      'main "Settings" contains group "Settings"',
      'region "Folders" contains group "Folders"',
      'dialog "Delete Bart?" contains group "Delete Bart?"',
    ])
  })
})

describe('an ancestor named by what it holds', () => {
  // A cell's row (`kit/Disclosure.tsx`), cell 01's sortable column, and a
  // table's rows, as Chromium answers them; then what the app does not
  // hold yet and one day will - a tree, a menu, a grid, a switch, a radio
  // and a tooltip - each as Chromium answered a page that had one.
  const BY_CONTENT = [
    '- heading "06 Export" [level=2]:',
    '  - button "06 Export" [expanded]',
    '- table "Routes":',
    '  - caption: Routes',
    '  - rowgroup:',
    '    - row "Name":',
    '      - columnheader "Name":',
    '        - button "Name"',
    '  - rowgroup:',
    '    - row "Red":',
    '      - rowheader "Red":',
    '        - link "Red":',
    '          - /url: "#red"',
    '- tree "Layers":',
    '  - treeitem "Lines" [expanded]:',
    '    - button "Lines"',
    '- menu "File":',
    '  - menuitem "Open":',
    '    - group "Open"',
    '- grid "Grid":',
    '  - row "Go":',
    '    - gridcell "Go":',
    '      - button "Go"',
    '- switch "Follow" [checked]:',
    '  - group "Follow"',
    '- radio "One":',
    '  - group "One"',
    '- tooltip "Tip":',
    '  - group "Tip"',
  ].join('\n')

  it('is not half of a pair', () => {
    expect(read(BY_CONTENT)).toEqual({ pairs: [], unread: [] })
  })

  it.each(NAMED_BY_CONTENT.map((role) => [role]))('%s around a group with its name', (role) => {
    const held = [`- ${role} "Map":`, '  - group "Map"'].join('\n')
    expect(pairsOf(held)).toEqual([])
    // The same two lines under a role that is named from outside.
    expect(pairsOf(held.replace(role, 'region'))).toEqual(['region "Map" contains group "Map"'])
  })

  // Playwright's list, as `allowsNameFromContent` gives it in
  // `packages/injected/src/roleUtils.ts` at 1.63.0.
  const PLAYWRIGHTS = [
    'button',
    'cell',
    'checkbox',
    'columnheader',
    'gridcell',
    'heading',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'radio',
    'row',
    'rowheader',
    'switch',
    'tab',
    'tooltip',
    'treeitem',
  ]

  it('names the eighteen roles Playwright names from their content', () => {
    expect(NAMED_BY_CONTENT).toEqual(PLAYWRIGHTS)
    expect(new Set(NAMED_BY_CONTENT).size).toBe(18)
  })

  it('which is the list in the Playwright that is installed', () => {
    // Read out of the bundle, where the injected script is a string. A
    // version that renames the list, moves it or changes it fails here, and
    // that is the day to reread `allowsNameFromContent` and
    // `NAMED_BY_CONTENT` side by side.
    const bundle = readFileSync(
      resolve(__dirname, '../../node_modules/playwright-core/lib/coreBundle.js'),
      'utf8',
    )
    const lists = [
      ...bundle.matchAll(/alwaysAllowsNameFromContent = (\[[^\]]*\])\.includes\(role\)/g),
    ]
    expect(
      lists.map((list) => list[1]),
      'one list named alwaysAllowsNameFromContent in playwright-core/lib/coreBundle.js',
    ).toHaveLength(1)
    expect(JSON.parse(lists[0][1])).toEqual([...NAMED_BY_CONTENT])
  })

  it('does not excuse the ancestor above it', () => {
    const under = [
      '- region "Export":',
      '  - heading "Export" [level=3]:',
      '    - button "Export"',
    ].join('\n')
    expect(pairsOf(under)).toEqual(['region "Export" contains button "Export"'])
  })

  it('a node of one of those roles is still a node', () => {
    const inner = ['- group "06 Export":', '  - region "Export":', '    - button "Export"'].join(
      '\n',
    )
    expect(pairsOf(inner)).toEqual(['region "Export" contains button "Export"'])
  })
})

describe('the snapshot’s text', () => {
  it('a key in single quotes is read, which the older expression stepped over', () => {
    const quoted = [
      '- \'group "Copy log: the last run"\':',
      '  - \'button "Copy log: the last run"\': Copy',
    ].join('\n')
    // What `expectNamed` reads a line with: it does not match this one.
    expect(/^\s*- ([a-z]+)(.*)$/.test(quoted.split('\n')[1])).toBe(false)
    expect(read(quoted)).toEqual({
      pairs: [
        {
          ancestor: { role: 'group', name: 'Copy log: the last run', line: 1 },
          node: { role: 'button', name: 'Copy log: the last run', line: 2 },
          path: ['group "Copy log: the last run"', 'button "Copy log: the last run"'],
        },
      ],
      unread: [],
    })
  })

  it('an apostrophe inside those quotes is doubled, and is one', () => {
    const doubled = ["- 'region \"It''s: here\"':", "  - 'group \"It''s: here\" [disabled]'"].join(
      '\n',
    )
    const { pairs, unread } = read(doubled)
    expect(unread).toEqual([])
    expect(pairs.map((pair) => pair.node)).toEqual([{ role: 'group', name: "It's: here", line: 2 }])
  })

  it('a quoted key and a bare one with the same name are the same name', () => {
    const mixed = ['- \'region "Log" [active]\':', '  - group "Log"'].join('\n')
    expect(pairsOf(mixed)).toEqual(['region "Log" contains group "Log"'])
  })

  it('text is not a name, whatever it says', () => {
    const text = [
      '- \'group "Routes: 6"\':',
      '  - text: "Routes: 6"',
      '  - paragraph: "Routes: 6"',
      '- table "Routes":',
      '  - caption: Routes',
      '- region "Log":',
      '  - group: Log',
      '  - text: group "Log"',
      '  - paragraph: "\'group \\"Log\\"\'"',
    ].join('\n')
    expect(read(text)).toEqual({ pairs: [], unread: [] })
  })

  it('a property of a node is not a node', () => {
    const properties = [
      '- \'group "type: here"\':',
      '  - textbox "Address":',
      '    - /placeholder: "type: here"',
      '  - link "Home":',
      '    - /url: https://example.org/a?b=c',
    ].join('\n')
    expect(read(properties)).toEqual({ pairs: [], unread: [] })
  })

  it('a line separator inside a line does not end it', () => {
    // U+2028 and U+2029, which Playwright writes as they are in a
    // placeholder. Built from their numbers, so that no editor and no tool
    // between here and the file can turn them into something else unseen.
    const LS = String.fromCharCode(0x2028)
    const PS = String.fromCharCode(0x2029)
    const separated = [
      '- region "Search":',
      '  - textbox "Search":',
      `    - /placeholder: a${LS}b${PS}c`,
      '  - link "Search":',
      `    - /url: https://example.org/${LS}`,
      `  - paragraph: before${LS}after`,
      `  - text: before${PS}after`,
      `  - 'group "Search" [disabled]': before${LS}after`,
    ].join('\n')
    expect(separated.split('\n')).toHaveLength(8)
    expect(read(separated)).toEqual({
      pairs: [
        {
          ancestor: { role: 'region', name: 'Search', line: 1 },
          node: { role: 'textbox', name: 'Search', line: 2 },
          path: ['region "Search"', 'textbox "Search"'],
        },
        {
          ancestor: { role: 'region', name: 'Search', line: 1 },
          node: { role: 'link', name: 'Search', line: 4 },
          path: ['region "Search"', 'link "Search"'],
        },
        {
          ancestor: { role: 'region', name: 'Search', line: 1 },
          node: { role: 'group', name: 'Search', line: 8 },
          path: ['region "Search"', 'group "Search"'],
        },
      ],
      unread: [],
    })
  })

  it('nor does one inside a name, should Playwright ever leave one there', () => {
    // It does not today: a name's separators arrive as spaces, which a
    // page in Chromium showed. The key is read to its end all the same.
    const LS = String.fromCharCode(0x2028)
    const named = [
      `- region "one${LS}two":`,
      `  - group "one${LS}two"`,
      `- region /one${LS}two/:`,
      `  - group /one${LS}two/ [disabled]`,
    ].join('\n')
    expect(named.split('\n')).toHaveLength(4)
    const { pairs, unread } = read(named)
    expect(unread).toEqual([])
    expect(pairs.map((pair) => [pair.ancestor.line, pair.node.line, pair.node.name])).toEqual([
      [1, 2, `one${LS}two`],
      [3, 4, `/one${LS}two/`],
    ])
  })

  it('attributes follow the name and are not part of it', () => {
    const attributes = [
      '- region "Export" [active]:',
      '  - button "Export" [disabled] [pressed=mixed]: Export',
      '  - checkbox "Export" [checked]',
      '  - tab "Export" [selected]',
    ].join('\n')
    expect(pairsOf(attributes)).toEqual([
      'region "Export" contains button "Export"',
      'region "Export" contains checkbox "Export"',
      'region "Export" contains tab "Export"',
    ])
  })

  it('a name is read out of its JSON, quotes and backslashes included', () => {
    const escaped = [
      '- group "She said \\"hi\\" \\\\ bye":',
      '  - group "She said \\"hi\\" \\\\ bye"',
      '  - group "She said \\"hi\\""',
    ].join('\n')
    const { pairs, unread } = read(escaped)
    expect(unread).toEqual([])
    expect(pairs.map((pair) => [pair.node.name, pair.node.line])).toEqual([
      ['She said "hi" \\ bye', 2],
    ])
  })

  it('a name between slashes is written bare, and is a name', () => {
    const bare = [
      '- group /tmp/:',
      '  - group /tmp/ [disabled]:',
      '    - link /:',
      '      - /url: https://example.org/',
    ].join('\n')
    const { pairs, unread } = read(bare)
    expect(unread).toEqual([])
    expect(pairs.map(describePair)).toEqual(['group "/tmp/" contains group "/tmp/"'])
  })

  it('a node with no name is never half of a pair', () => {
    // Which is also what a name over 900 characters becomes: Playwright
    // drops it, and the node arrives bare.
    const bare = ['- group:', '  - group:', '    - button: long'].join('\n')
    expect(read(bare)).toEqual({ pairs: [], unread: [] })
  })

  it('an empty snapshot holds nothing, and nothing unread', () => {
    expect(read('')).toEqual({ pairs: [], unread: [] })
    expect(read('\n')).toEqual({ pairs: [], unread: [] })
  })
})

describe('a line the rule cannot read', () => {
  it('is answered, not stepped over', () => {
    const odd = [
      '- region "Log":',
      '  group "Log"',
      '  - group "Log',
      '  - \'group "Log"',
      '  - \'group "Log"\' trailing',
      '  - group "Log" trailing',
      '  - Group "Log"',
      '  - group "Log"',
    ].join('\n')
    const { pairs, unread } = read(odd)
    expect(unread).toEqual([
      { line: 2, text: '  group "Log"' },
      { line: 3, text: '  - group "Log' },
      { line: 4, text: '  - \'group "Log"' },
      { line: 5, text: '  - \'group "Log"\' trailing' },
      { line: 6, text: '  - group "Log" trailing' },
      { line: 7, text: '  - Group "Log"' },
    ])
    // And the line after them is still read, against the same ancestor.
    expect(pairs.map((pair) => [pair.ancestor.line, pair.node.line])).toEqual([[1, 8]])
  })
})

describe('the pairs that were decided', () => {
  const EXPORT = [
    '- group "06 Export":',
    '  - region "Export":',
    '    - button "Export"',
    '    - group "Export"',
    '  - region "Preview":',
    '    - button "Preview"',
  ].join('\n')
  const known: KnownPair[] = [{ ancestorRole: 'region', role: 'button', name: 'Export', issue: 1 }]

  it('are left alone, by name and by both roles, and nothing else is', () => {
    expect(pairsOf(EXPORT, [])).toEqual([
      'region "Export" contains button "Export"',
      'region "Export" contains group "Export"',
      'region "Preview" contains button "Preview"',
    ])
    expect(pairsOf(EXPORT, known)).toEqual([
      'region "Export" contains group "Export"',
      'region "Preview" contains button "Preview"',
    ])
  })
})

describe('the list the sweep ships with', () => {
  // Cell 06 once an export has run, as it was drawn until issue 258: the
  // pair the sweep's first run found (macOS, 2026-09-29), and beside it the
  // three nearest things that pair is not: another role inside, another role
  // outside, another name.
  const CELL_06_BEFORE = [
    '- main:',
    '  - heading "06 Export" [level=2]:',
    '    - button "06 Export" [expanded]',
    '  - group "06 Export":',
    '    - region "Export":',
    '      - button "Export"',
    '      - link "Export":',
    '        - /url: "#export"',
    '    - group "Export":',
    '      - button "Export"',
    '    - region "Reveal":',
    '      - button "Reveal"',
  ].join('\n')

  // The same screen as it is drawn now: the run's region is named for the
  // run, as cell 02's is "Layout run", and holds the verbs.
  const CELL_06_NOW = [
    '- main:',
    '  - heading "06 Export" [level=2]:',
    '    - button "06 Export" [expanded]',
    '  - group "06 Export":',
    '    - region "Export run":',
    '      - button "Reveal"',
    '      - button "Export"',
  ].join('\n')

  it('holds no pair, which issue 258 closed', () => {
    expect(KNOWN_PAIRS.filter((pair) => pair.issue === 258)).toEqual([])
  })

  it('so the sweep reports the pair the first run found, should a region be named so again', () => {
    // The rule alone finds four, the first of them that pair.
    expect(pairsOf(CELL_06_BEFORE)).toEqual([
      'region "Export" contains button "Export"',
      'region "Export" contains link "Export"',
      'group "Export" contains button "Export"',
      'region "Reveal" contains button "Reveal"',
    ])
    // And the sweep reports all four.
    expect(swept(CELL_06_BEFORE)).toEqual(pairsOf(CELL_06_BEFORE))
  })

  it('and finds nothing on the screen as it is drawn now', () => {
    expect(pairsOf(CELL_06_NOW)).toEqual([])
    expect(swept(CELL_06_NOW)).toEqual([])
  })

  it('does not excuse the defect the rule was written for', () => {
    expect(pairsOf(ENGINE_LOG)).toHaveLength(1)
    expect(swept(ENGINE_LOG)).toEqual(pairsOf(ENGINE_LOG))
    expect(swept(ENGINE_LOG)).toEqual([
      'region "The engine\'s log for this run" contains group "The engine\'s log for this run"',
    ])
  })

  // Over the list as it stands, which is empty and so draws no test here
  // today; the day an entry is added, each one is held to these.
  it.each(KNOWN_PAIRS.map((pair) => [JSON.stringify(pair), pair] as const))(
    '%s names the issue that decided it, is one the rule would find, and is said once',
    (_, pair) => {
      // An issue, by its number.
      expect(Number.isInteger(pair.issue) && pair.issue > 0).toBe(true)
      // The two roles and the name, alone on a screen: the rule finds that
      // pair and no other, so the entry is not one a heading or an ancestor
      // named by what it holds had excused already, which would be an entry
      // that does nothing and looks as though it does.
      const alone = [
        `- ${pair.ancestorRole} ${JSON.stringify(pair.name)}:`,
        `  - ${pair.role} ${JSON.stringify(pair.name)}`,
      ].join('\n')
      expect(read(alone)).toEqual({
        pairs: [
          {
            ancestor: { role: pair.ancestorRole, name: pair.name, line: 1 },
            node: { role: pair.role, name: pair.name, line: 2 },
            path: [
              `${pair.ancestorRole} ${JSON.stringify(pair.name)}`,
              `${pair.role} ${JSON.stringify(pair.name)}`,
            ],
          },
        ],
        unread: [],
      })
      // And the sweep, with the list, does not report it.
      expect(swept(alone)).toEqual([])
      // Once in the list: a second entry for the same pair would outlive
      // the first one's issue.
      expect(
        KNOWN_PAIRS.filter(
          (other) =>
            other.ancestorRole === pair.ancestorRole &&
            other.role === pair.role &&
            other.name === pair.name,
        ),
      ).toHaveLength(1)
    },
  )
})

describe('the sweep', () => {
  // Read from the source, which is as much as can be asked of it without
  // the application. The two end-to-end specs are green whether the sweep
  // calls the rule or not, there being no pair on any screen to find, and
  // the check beside cell 06 in `notebook-a11y.spec.ts` asks the rule itself
  // and not the sweep: **this is the only thing that notices the call being
  // deleted.**
  // It notices the text of it and no more - a call that is there and handed
  // the wrong thing is past it.
  const source = readFileSync(resolve(__dirname, '../support/a11y.ts'), 'utf8')
  const body = (name: string): string =>
    new RegExp(`^export async function ${name}\\([\\s\\S]*?^}$`, 'm').exec(source)?.[0] ?? ''

  it('takes the snapshot once and hands it to both checks of it', () => {
    const sweep = body('sweep')
    expect(sweep).toContain('for (const theme of THEMES)')
    expect(sweep.match(/\.ariaSnapshot\(\)/g)).toHaveLength(1)
    expect(sweep).toMatch(/^ +const snapshot = await .+\.ariaSnapshot\(\)$/m)
    expect(sweep).toMatch(/^ +await expectNamed\(snapshot, here\)$/m)
    expect(sweep).toMatch(/^ +await expectNoDuplicatedNames\(snapshot, here\)$/m)
  })

  it('whose check asks the rule, with the list it ships with, softly', () => {
    const check = body('expectNoDuplicatedNames')
    expect(check).toMatch(/^ +const reading = duplicatedNames\(snapshot\)$/m)
    expect(check).toMatch(/^ +expect\n +\.soft\(/m)
    expect(check).toContain('...reading.pairs.map(describePair),')
    expect(check).toContain('...reading.unread.map(')
    expect(check).toMatch(/^ +\.toEqual\(\[\]\)$/m)
  })
})

describe('what a red run says', () => {
  it('every pair, each with both roles and both names, where it is, and its entry', () => {
    const screen = [
      '- main:',
      '  - group "06 Export":',
      '    - region "Export":',
      '      - button "Export"',
      '  - \'region "Copy log: the last run"\':',
      '    - \'group "Copy log: the last run"\'',
    ].join('\n')
    expect(describeReading(read(screen))).toBe(
      [
        'a name repeated inside the element it names (2):',
        '  1. region "Export" contains button "Export"',
        '     at lines 3 and 4 of the snapshot: main > group "06 Export" > region "Export" > button "Export"',
        "     once an issue has decided it, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'button', name: 'Export', issue: <that issue> }",
        '  2. region "Copy log: the last run" contains group "Copy log: the last run"',
        '     at lines 5 and 6 of the snapshot: main > region "Copy log: the last run" > group "Copy log: the last run"',
        "     once an issue has decided it, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'group', name: 'Copy log: the last run', issue: <that issue> }",
      ].join('\n'),
    )
  })

  it('the entry is written as the formatter would leave it, an apostrophe and all', () => {
    expect(describeReading(read(ENGINE_LOG)).split('\n')[3]).toBe(
      `     once an issue has decided it, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'group', name: "The engine's log for this run", issue: <that issue> }`,
    )
  })

  it('and every line that could not be read', () => {
    expect(describeReading(read('- region "Log":\n  - Group "Log"'))).toBe(
      ['lines of the snapshot the rule could not read (1):', '  line 2:   - Group "Log"'].join(
        '\n',
      ),
    )
  })

  it('and nothing when there is nothing to say', () => {
    expect(describeReading(read(ENGINE_LOG.replace('group "The', 'group "Its')))).toBe('')
  })
})
