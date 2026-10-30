import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { interpreterFailedReason } from '../../src/main/sidecar'
import { resolveInterpreter } from '../../src/main/interpreter'
import { FEED_REFUSALS } from '../../src/main/feeds-ipc'
import {
  failureSentence,
  type FailureKind,
  type FirstRunResult,
  type FirstRunTool,
  type ToolCheck,
} from '../../src/shared/first-run'
import { firstRunTitle } from '../../src/renderer/src/FirstRunDialog'
import { NOT_LAID_OUT } from '../../src/renderer/src/DownloadLine'

// docs/install.md's "Troubleshooting" quotes the app (issue 566): what the
// first-run dialog says, what the engine's unavailable reason says, and two
// sentences of the feed refusals and cell 02. CLAUDE.md makes a quotation of
// the app a copy of the code's sentence, and a document cannot import. So the
// guide sets each quotation apart as a blockquote line, and this holds the
// two together in both directions: every sentence the code draws that the
// guide promises to quote is there word for word, and every blockquote in the
// section is a sentence the code draws, so a reworded or a half-remembered
// one fails here and not on a stranger's screen.

const root = join(__dirname, '..', '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

/** The guide's Troubleshooting section, from its heading to the next one at its level. */
function troubleshooting(): string {
  const guide = read('docs/install.md')
  const from = guide.indexOf('\n## Troubleshooting\n')
  expect(from, 'the guide has a Troubleshooting section').toBeGreaterThan(-1)
  const to = guide.indexOf('\n## ', from + 1)
  return guide.slice(from, to === -1 ? undefined : to)
}

/** Each blockquote line of the section, without its marker; a list item may indent one. */
function quotations(section: string): string[] {
  return section
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith('> '))
    .map((line) => line.slice(2))
}

const failed = (kind: FailureKind, tool: FirstRunTool): ToolCheck => ({
  outcome: 'failed',
  kind,
  sentence: failureSentence(tool, kind, false),
  detail: '',
  ms: 1,
})
const passed: ToolCheck = { outcome: 'passed', ms: 1 }

/** The dialog's title for a check in which these tools failed. */
function titleFor(loom: boolean, ffmpeg: boolean): string {
  const result: FirstRunResult = {
    finished: true,
    loom: loom ? failed('missing', 'loom') : passed,
    ffmpeg: ffmpeg ? failed('missing', 'ffmpeg') : passed,
  }
  return firstRunTitle(result)
}

/** What the guide promises to quote: the code's sentences, by where they are made. */
function promised(): string[] {
  const dialog = [
    ...(['missing', 'timeout', 'not-running', 'install'] as const).map((kind) =>
      failureSentence('loom', kind, false),
    ),
    ...(['missing', 'timeout', 'not-running'] as const).map((kind) =>
      failureSentence('ffmpeg', kind, false),
    ),
    titleFor(true, false),
    titleFor(false, true),
    titleFor(true, true),
  ]
  // An installed app with no bundled Python, and one whose bundled engine
  // would not start: the two reasons a person with an installer can meet.
  const missing = resolveInterpreter({
    config: { enginePython: null, engineCheckout: null },
    packaged: true,
    resourcesPath: 'resources',
    platform: 'linux',
    exists: () => false,
  })
  if (missing.interpreter !== null) throw new Error('an installed app with no runtime resolved')
  const engine = [missing.reason, interpreterFailedReason('spawn failed', true)]
  return [...dialog, ...engine, FEED_REFUSALS.notUrl, FEED_REFUSALS.localHost, NOT_LAID_OUT]
}

describe('docs/install.md, Troubleshooting, against the app', () => {
  it('quotes every sentence it promises, word for word', () => {
    const quoted = new Set(quotations(troubleshooting()))
    for (const sentence of promised()) expect(quoted, sentence).toContain(sentence)
  })

  it('quotes no sentence the app does not draw', () => {
    const drawn = new Set(promised())
    const quoted = quotations(troubleshooting())
    // The shape is read, so a rewrite that stops using blockquotes is caught.
    expect(quoted.length).toBeGreaterThan(10)
    for (const sentence of quoted) expect(drawn, sentence).toContain(sentence)
  })
})

/** GitHub's anchor for a heading: lower case, punctuation gone, spaces as hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-')
}

/** The anchors a Markdown file's headings make. */
function anchors(path: string): Set<string> {
  const headings = [...read(path).matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]))
  return new Set(headings)
}

describe('SUPPORT.md and the guide it points at', () => {
  it('links only files and headings that exist', () => {
    const support = read('SUPPORT.md')
    const links = [...support.matchAll(/\]\(((?!https?:)[^)\s]+)\)/g)].map((m) => m[1])
    // The shape is read: the four parts each point somewhere.
    expect(links.length).toBeGreaterThanOrEqual(4)
    for (const link of links) {
      const [file, anchor] = link.split('#')
      expect(() => read(file), link).not.toThrow()
      if (anchor !== undefined) expect(anchors(file), link).toContain(anchor)
    }
  })

  it('is linked from the README and from CONTRIBUTING.md', () => {
    expect(read('README.md')).toContain('](SUPPORT.md)')
    expect(read('CONTRIBUTING.md')).toContain('`SUPPORT.md`')
  })

  it('has every in-page link of the install guide land on a heading', () => {
    const guide = read('docs/install.md')
    const known = anchors('docs/install.md')
    const links = [...guide.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(10)
    for (const anchor of links) expect(known, anchor).toContain(anchor)
  })
})
