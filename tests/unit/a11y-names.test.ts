// The sweep's rule for a name said twice, nested (issue 208), over the text
// of Playwright's snapshot of the accessibility tree.
//
// The fixtures are the snapshot's own text. Each shape below was taken from
// `locator.ariaSnapshot()` over a page in Chromium and then cut down, so
// the quoting, the attributes and the indentation are Playwright's and not
// a guess at them. What only the running app shows - which pairs its
// screens actually hold - is the sweep's, in `tests/e2e/`.

import { describe, expect, it } from 'vitest'
import {
  describePair,
  describeReading,
  duplicatedNames,
  KNOWN_PAIRS,
  NAMED_BY_CONTENT,
  type KnownPair,
} from '../support/a11y-names'

/** The pairs of a snapshot, each on its one line. */
const pairsOf = (snapshot: string, known?: readonly KnownPair[]): string[] =>
  duplicatedNames(snapshot, known).pairs.map(describePair)

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
    const { pairs, unread } = duplicatedNames(ENGINE_LOG)
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
    expect(duplicatedNames(fixed)).toEqual({ pairs: [], unread: [] })
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
    expect(
      duplicatedNames(thrice).pairs.map((pair) => [pair.ancestor.line, pair.node.line]),
    ).toEqual([
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
    expect(duplicatedNames(uneven).pairs.map((pair) => pair.node.line)).toEqual([2, 3])
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
    expect(duplicatedNames(SECTION)).toEqual({ pairs: [], unread: [] })
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
  // table's rows, as Chromium answers them.
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
  ].join('\n')

  it('is not half of a pair', () => {
    expect(duplicatedNames(BY_CONTENT)).toEqual({ pairs: [], unread: [] })
  })

  it.each(NAMED_BY_CONTENT.map((role) => [role]))('%s around a group with its name', (role) => {
    const held = [`- ${role} "Map":`, '  - group "Map"'].join('\n')
    expect(pairsOf(held)).toEqual([])
    // The same two lines under a role that is named from outside.
    expect(pairsOf(held.replace(role, 'region'))).toEqual(['region "Map" contains group "Map"'])
  })

  it('names nine roles, the brief’s', () => {
    expect([...NAMED_BY_CONTENT].sort()).toEqual(
      [
        'button',
        'cell',
        'columnheader',
        'heading',
        'link',
        'option',
        'row',
        'rowheader',
        'tab',
      ].sort(),
    )
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
    expect(duplicatedNames(quoted)).toEqual({
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
    const { pairs, unread } = duplicatedNames(doubled)
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
    expect(duplicatedNames(text)).toEqual({ pairs: [], unread: [] })
  })

  it('a property of a node is not a node', () => {
    const properties = [
      '- \'group "type: here"\':',
      '  - textbox "Address":',
      '    - /placeholder: "type: here"',
      '  - link "Home":',
      '    - /url: https://example.org/a?b=c',
    ].join('\n')
    expect(duplicatedNames(properties)).toEqual({ pairs: [], unread: [] })
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
    const { pairs, unread } = duplicatedNames(escaped)
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
    const { pairs, unread } = duplicatedNames(bare)
    expect(unread).toEqual([])
    expect(pairs.map(describePair)).toEqual(['group "/tmp/" contains group "/tmp/"'])
  })

  it('a node with no name is never half of a pair', () => {
    // Which is also what a name over 900 characters becomes: Playwright
    // drops it, and the node arrives bare.
    const bare = ['- group:', '  - group:', '    - button: long'].join('\n')
    expect(duplicatedNames(bare)).toEqual({ pairs: [], unread: [] })
  })

  it('an empty snapshot holds nothing, and nothing unread', () => {
    expect(duplicatedNames('')).toEqual({ pairs: [], unread: [] })
    expect(duplicatedNames('\n')).toEqual({ pairs: [], unread: [] })
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
    const { pairs, unread } = duplicatedNames(odd)
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

  it('the list the sweep uses does not excuse the defect the rule was written for', () => {
    expect(pairsOf(ENGINE_LOG)).toEqual(pairsOf(ENGINE_LOG, []))
    expect(pairsOf(ENGINE_LOG)).toHaveLength(1)
  })

  it('each entry of that list names the issue that decided it, and is one the rule would find', () => {
    // Over the list as it stands, which may be empty; the fixture above it
    // is what shows the mechanism working.
    for (const pair of KNOWN_PAIRS) {
      expect(Number.isInteger(pair.issue) && pair.issue > 0, JSON.stringify(pair)).toBe(true)
      const one = [
        `- ${pair.ancestorRole} ${JSON.stringify(pair.name)}:`,
        `  - ${pair.role} ${JSON.stringify(pair.name)}`,
      ].join('\n')
      expect(pairsOf(one, []), `${JSON.stringify(pair)} excuses nothing`).toHaveLength(1)
    }
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
    expect(describeReading(duplicatedNames(screen))).toBe(
      [
        'a name repeated inside the element it names (2):',
        '  1. region "Export" contains button "Export"',
        '     at lines 3 and 4 of the snapshot: main > group "06 Export" > region "Export" > button "Export"',
        "     if it is right as it stands, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'button', name: 'Export', issue: <the issue that decided it> }",
        '  2. region "Copy log: the last run" contains group "Copy log: the last run"',
        '     at lines 5 and 6 of the snapshot: main > region "Copy log: the last run" > group "Copy log: the last run"',
        "     if it is right as it stands, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'group', name: 'Copy log: the last run', issue: <the issue that decided it> }",
      ].join('\n'),
    )
  })

  it('the entry is written as the formatter would leave it, an apostrophe and all', () => {
    expect(describeReading(duplicatedNames(ENGINE_LOG)).split('\n')[3]).toBe(
      `     if it is right as it stands, in KNOWN_PAIRS: { ancestorRole: 'region', role: 'group', name: "The engine's log for this run", issue: <the issue that decided it> }`,
    )
  })

  it('and every line that could not be read', () => {
    expect(describeReading(duplicatedNames('- region "Log":\n  - Group "Log"'))).toBe(
      ['lines of the snapshot the rule could not read (1):', '  line 2:   - Group "Log"'].join(
        '\n',
      ),
    )
  })

  it('and nothing when there is nothing to say', () => {
    expect(describeReading(duplicatedNames(ENGINE_LOG.replace('group "The', 'group "Its')))).toBe(
      '',
    )
  })
})
