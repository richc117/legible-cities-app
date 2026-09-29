// A name said twice, one inside the other (issue 208): the rule the
// accessibility sweep runs over Playwright's snapshot of the accessibility
// tree, beside `expectNamed` in `tests/support/a11y.ts`.
//
// The defect it exists for shipped to a pull request: cell 02's engine log
// gave its disclosure's region and the box of lines inside it the same
// `aria-label`, so a screen reader entering the panel heard one name twice,
// nested, with nothing to say which was which. `expectNamed` asks whether a
// control has a name and never whether the name is its own, so the sweep
// passed; three locators that matched two elements are what caught it.
//
// This module is pure: it takes the snapshot's text and imports nothing
// from Playwright, so the rule is tested in `tests/unit/a11y-names.test.ts`
// without an application to launch.
//
// **The rule.** A node is flagged when its name equals the name of one of
// its ancestors, unless
//
// - the node is a `heading`: a section named by its own heading,
//   `<section aria-labelledby="x">` around `<h2 id="x">`, is the correct
//   pattern, and every dialog and every section of Settings is one; or
// - the ancestor takes its name from its content (`NAMED_BY_CONTENT`): a
//   heading around a button says the button's words because they are the
//   only words it has. Each cell's row is a heading around its toggle
//   (`kit/Disclosure.tsx`) and cell 01's sortable columns are a
//   `columnheader` around a button; or
// - the pair is in `KNOWN_PAIRS`, by name and by both roles, with the issue
//   that decided it: a pair that is right as it stands, or a real one
//   carried until its issue closes.
//
// The exemptions are judged pair by pair. A button inside a heading inside
// a region, all three with one name, is still flagged against the region.
//
// **The text it reads** is what `renderAriaSnapshotAsYaml` writes in
// `playwright-core`, one node a line:
//
//     - role "name" [attribute] [attribute=value]: text
//
// - The name is a JSON string. A name that begins and ends with a slash is
//   written bare (`- group /tmp/`), and is read as a name all the same.
// - A key that YAML would misread - one holding a colon and a space, a
//   brace, a space and a hash - is wrapped whole in single quotes, with
//   each apostrophe inside it doubled: `- 'button "Copy log: the last
//   run"'`. `expectNamed`'s expression steps over such a line in silence;
//   this reads it.
// - `- text: "Routes: 6"` is a run of text and `- caption: Routes` is a
//   node with text and no name: what follows the key's colon is never a
//   name. `- /url: ...` and `- /placeholder: ...` are properties of the
//   node above them.
// - Depth is indentation, two spaces a level, read as "deeper than" and
//   never as a count.
//
// A line that fits none of this is answered as `unread` rather than
// stepped over, so the day the format moves the sweep says so instead of
// passing on a tree it has stopped seeing.
//
// **What it cannot see.** Playwright drops a name longer than 900
// characters, so the node arrives unnamed. Two siblings with one name are
// not nested and are not this rule's. And the snapshot holds what the
// accessibility tree holds when it is taken: a closed disclosure's
// contents are `hidden`, so a name repeated inside one is seen only by a
// sweep that opens it.

/**
 * Roles that take their name from their content when nothing else names
 * them, so that what they hold repeats it by construction. As an
 * **ancestor**, one of these never makes a pair.
 */
export const NAMED_BY_CONTENT: readonly string[] = [
  'heading',
  'columnheader',
  'rowheader',
  'cell',
  'row',
  'button',
  'link',
  'tab',
  'option',
]

/**
 * A pair that was looked at and decided: right as it stands, or a defect
 * carried under the issue that will mend it.
 */
export interface KnownPair {
  ancestorRole: string
  role: string
  name: string
  /** The issue on which it was decided. */
  issue: number
}

/**
 * The exact pairs the rule leaves alone. Each is one name under two roles,
 * decided with the sweep's own run in hand, and each says in a comment what
 * it is, whether the repetition is right or is a defect being carried, the
 * issue that decides it, and when the entry goes.
 *
 * Nothing is added here to make a red run green: a pair the rule finds is
 * a defect until someone has listened to it. An entry is matched wherever
 * its two roles and its name meet, on any screen, so each one is also a
 * place the rule has stopped looking.
 */
export const KNOWN_PAIRS: readonly KnownPair[] = [
  // Cell 06, once an export has run: a region named "Export" holds a button
  // named "Export". **A real duplicate, not a false positive.** The sweep
  // found it on its first run (29 Sep 2026), the one pair on any screen or
  // dialog in either theme. It is carried and not mended here because
  // renaming the region changes an accessible name that the release gate's
  // documents follow. Issue 258 decides it, and this entry goes when that
  // issue closes.
  { ancestorRole: 'region', role: 'button', name: 'Export', issue: 258 },
]

/** A named node of the snapshot, and the line it was read from, from 1. */
export interface NamedNode {
  role: string
  name: string
  line: number
}

export interface DuplicatedPair {
  ancestor: NamedNode
  node: NamedNode
  /** From the top of the snapshot down to the node: where on the screen it is. */
  path: string[]
}

export interface UnreadLine {
  line: number
  text: string
}

export interface Reading {
  pairs: DuplicatedPair[]
  /** Lines the rule could not read, which is a failure of the rule and is said. */
  unread: UnreadLine[]
}

interface Key {
  role: string
  name: string | null
}

const ATTRIBUTES = /^(?: \[[^\]\s]+\])*$/

/** `role`, then a name, then attributes; null when the key is not that. */
function readKey(key: string): Key | null {
  const m = /^([a-z][a-z0-9-]*)(.*)$/.exec(key)
  if (m === null) return null
  const role = m[1]
  const rest = m[2]
  if (rest.startsWith(' "')) {
    // A JSON string: to the first quote no backslash has escaped.
    let end = 2
    while (end < rest.length && rest[end] !== '"') end += rest[end] === '\\' ? 2 : 1
    if (end >= rest.length || !ATTRIBUTES.test(rest.slice(end + 1))) return null
    try {
      const name: unknown = JSON.parse(rest.slice(1, end + 1))
      return typeof name === 'string' ? { role, name } : null
    } catch {
      return null
    }
  }
  if (rest.startsWith(' /')) {
    // A name written bare: the shortest that leaves only attributes after it.
    const bare = /^ (\/.*?)((?: \[[^\]\s]+\])*)$/.exec(rest)
    return bare === null ? null : { role, name: bare[1] }
  }
  return ATTRIBUTES.test(rest) ? { role, name: null } : null
}

/** The key of one line: the part before the colon, out of its quotes. */
function keyOf(item: string): string | null {
  if (!item.startsWith("'")) {
    // A bare key holds no colon before a space or the line's end: one that
    // did would have been quoted.
    const colon = /:(?:\s|$)/.exec(item)
    return colon === null ? item : item.slice(0, colon.index)
  }
  let key = ''
  let at = 1
  while (at < item.length) {
    if (item[at] !== "'") key += item[at++]
    else if (item[at + 1] === "'") {
      key += "'"
      at += 2
    } else break
  }
  if (at >= item.length) return null
  return /^(?::(?:\s.*)?)?$/.test(item.slice(at + 1)) ? key : null
}

const said = (role: string, name: string | null): string =>
  name === null ? role : `${role} ${JSON.stringify(name)}`

/** A name as this repository's formatter would leave it in `KNOWN_PAIRS`. */
const literal = (name: string): string =>
  /['\\]/.test(name) || /[^\x20-\x7e]/.test(name) ? JSON.stringify(name) : `'${name}'`

/**
 * Every node of the snapshot whose name is an ancestor's too, less the
 * exemptions above; and every line that could not be read.
 */
export function duplicatedNames(
  snapshot: string,
  known: readonly KnownPair[] = KNOWN_PAIRS,
): Reading {
  const pairs: DuplicatedPair[] = []
  const unread: UnreadLine[] = []
  // The nodes the current line is inside, outermost first.
  const above: { depth: number; role: string; name: string | null; line: number }[] = []

  snapshot.split('\n').forEach((text, index) => {
    const line = index + 1
    if (text.trim() === '') return
    const item = /^(\s*)- (.*)$/.exec(text)
    const key = item === null ? null : keyOf(item[2])
    if (item === null || key === null) {
      unread.push({ line, text })
      return
    }
    // A property of the node above, not a node.
    if (/^\/[a-z]+$/.test(key)) return
    const read = readKey(key)
    if (read === null) {
      unread.push({ line, text })
      return
    }
    const depth = item[1].length
    while (above.length > 0 && above[above.length - 1].depth >= depth) above.pop()
    const { role, name } = read
    if (name !== null && role !== 'heading') {
      for (const ancestor of above) {
        if (ancestor.name !== name) continue
        if (NAMED_BY_CONTENT.includes(ancestor.role)) continue
        if (
          known.some(
            (pair) =>
              pair.ancestorRole === ancestor.role && pair.role === role && pair.name === name,
          )
        )
          continue
        pairs.push({
          ancestor: { role: ancestor.role, name, line: ancestor.line },
          node: { role, name, line },
          path: [...above.map((node) => said(node.role, node.name)), said(role, name)],
        })
      }
    }
    above.push({ depth, role, name, line })
  })
  return { pairs, unread }
}

/** One pair on one line: the ancestor's role and name, then the node's. */
export const describePair = (pair: DuplicatedPair): string =>
  `${said(pair.ancestor.role, pair.ancestor.name)} contains ${said(pair.node.role, pair.node.name)}`

/**
 * What a red run says: every pair, each with where it is and the entry
 * that would make it a known one, so the pairs of one run can be decided
 * from that run; and every line that could not be read.
 */
export function describeReading(reading: Reading): string {
  const out: string[] = []
  if (reading.pairs.length > 0) {
    out.push(`a name repeated inside the element it names (${reading.pairs.length}):`)
    reading.pairs.forEach((pair, i) => {
      out.push(
        `  ${i + 1}. ${describePair(pair)}`,
        `     at lines ${pair.ancestor.line} and ${pair.node.line} of the snapshot: ${pair.path.join(' > ')}`,
        `     once an issue has decided it, in KNOWN_PAIRS: { ancestorRole: '${pair.ancestor.role}', role: '${pair.node.role}', name: ${literal(pair.node.name)}, issue: <that issue> }`,
      )
    })
  }
  if (reading.unread.length > 0) {
    out.push(`lines of the snapshot the rule could not read (${reading.unread.length}):`)
    for (const { line, text } of reading.unread) out.push(`  line ${line}: ${text}`)
  }
  return out.join('\n')
}
