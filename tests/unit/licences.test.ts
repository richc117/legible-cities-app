// The Licences section's list and its buttons (issue 108, specs/027): the
// components the screen names are the ones THIRD_PARTY_NOTICES.md's table
// names, both ways, so neither can drift; and an unavailable button says why
// rather than opening nothing.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { licenceAnnouncer, licenceButtons } from '../../src/renderer/src/Settings'
import { APP_LICENCE, BUNDLED_COMPONENTS, describeUnavailable } from '../../src/shared/licences'

const repo = resolve(__dirname, '../..')

/** Every row of the notices file's component table: its first cell and its licence cell. */
function noticeTable(): Map<string, string> {
  const text = readFileSync(resolve(repo, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex((line) => line.startsWith('| Component |'))
  expect(header, 'the component table').toBeGreaterThan(-1)
  const rows = new Map<string, string>()
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const cells = line.split('|').map((cell) => cell.trim())
    // | Component | Role | Licence | Source |
    rows.set(cells[1], cells[3])
  }
  return rows
}

const noticeRows = (): string[] => [...noticeTable().keys()]

/**
 * Rows the notices file keeps for what the installers do not carry: tooling,
 * a measured alternative, a planned dependency, test data and the code of
 * conduct. A new row is either shipped, and on the screen, or added here.
 */
const NOT_SHIPPED = [
  'electron-vite, Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, electron-builder',
  'PyInstaller (measured, not chosen: ADR-020)',
  'vscode-jsonrpc (planned)',
  'Spec Kit',
  'BART GTFS feed (test fixture)',
  'Contributor Covenant 2.1',
]

describe('the components the Licences section names', () => {
  it('each has a row in THIRD_PARTY_NOTICES.md', () => {
    const rows = new Set(noticeRows())
    for (const component of BUNDLED_COMPONENTS) {
      expect(rows.has(component.notice), `no notices row "${component.notice}"`).toBe(true)
      expect(component.name.length).toBeGreaterThan(0)
      expect(component.licence.length).toBeGreaterThan(0)
    }
  })

  it('covers every row of the notices that ships, and nothing else', () => {
    const named = new Set(BUNDLED_COMPONENTS.map((component) => component.notice))
    for (const row of noticeRows()) {
      const shipped = !NOT_SHIPPED.includes(row)
      expect(
        named.has(row),
        `"${row}" ${shipped ? 'is not on the screen' : 'is not shipped'}`,
      ).toBe(shipped)
    }
    expect(new Set(BUNDLED_COMPONENTS.map((c) => c.name)).size).toBe(BUNDLED_COMPONENTS.length)
  })

  it('names the licences its notices row names', () => {
    const table = noticeTable()
    for (const component of BUNDLED_COMPONENTS) {
      expect(component.identifiers.length, component.name).toBeGreaterThan(0)
      for (const identifier of component.identifiers) {
        expect(component.licence, `${component.name} on the screen`).toContain(identifier)
        expect(table.get(component.notice), `${component.name} in its notices row`).toContain(
          identifier,
        )
      }
    }
  })

  it("says the app's own licence as package.json does", () => {
    const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
    expect(APP_LICENCE).toBe(pkg.license)
  })
})

const ALL_AVAILABLE = { notices: 'available', texts: 'available', chromium: 'available' } as const

describe('the Licences buttons', () => {
  function setUp(failure: Error | null = null) {
    const opened: string[] = []
    const said: (string | null)[] = []
    const bridge = {
      openNotices: async () => {
        opened.push('notices')
        if (failure !== null) throw failure
      },
      showTexts: async () => {
        opened.push('texts')
        if (failure !== null) throw failure
      },
      openChromium: async () => {
        opened.push('chromium')
        if (failure !== null) throw failure
      },
    }
    return { opened, said, say: (m: string | null) => said.push(m), bridge }
  }

  it('say in a development run that nothing is bundled, and open nothing', () => {
    const { opened, said, say, bridge } = setUp()
    const buttons = licenceButtons(
      { notices: 'development', texts: 'development', chromium: 'development' },
      say,
      bridge,
    )
    expect(buttons.map((b) => b.label)).toEqual([
      'Open the notices',
      'Show the licence texts',
      "Open Chromium's licences",
    ])
    for (const button of buttons) {
      expect(button.unavailable).toBe(describeUnavailable(button.what, 'development'))
      expect(button.unavailable).toContain('not bundled in a development run')
      button.press()
    }
    expect(opened).toEqual([])
    expect(said).toEqual(buttons.map((b) => b.unavailable))
  })

  it('open their own file when it is there, and say a refusal as a sentence', async () => {
    const ok = setUp()
    for (const button of licenceButtons(ALL_AVAILABLE, ok.say, ok.bridge)) {
      expect(button.unavailable).toBeNull()
      button.press()
    }
    expect(ok.opened).toEqual(['notices', 'texts', 'chromium'])
    expect(ok.said).toEqual([null, null, null])

    const refused = setUp(new Error('The licence texts’ folder could not be opened: gone'))
    licenceButtons(ALL_AVAILABLE, refused.say, refused.bridge)[1].press()
    await expect
      .poll(() => refused.said)
      .toEqual([null, 'The licence texts’ folder could not be opened: gone'])
  })

  it('say the same sentence again on a second press, emptying the line between', () => {
    const written: (string | null)[] = []
    const frames: (() => void)[] = []
    const say = licenceAnnouncer(
      (message) => written.push(message),
      (then) => frames.push(then),
    )
    const { bridge } = setUp()
    const [notices] = licenceButtons(
      { notices: 'development', texts: 'development', chromium: 'development' },
      say,
      bridge,
    )
    notices.press()
    frames.shift()?.()
    notices.press()
    frames.shift()?.()
    expect(written).toEqual([null, notices.unavailable, null, notices.unavailable])
  })

  it('names a missing file in a packaged app differently from a development run', () => {
    expect(describeUnavailable('notices', 'missing')).toBe(
      'The notices file is missing from this installation.',
    )
    expect(describeUnavailable('texts', 'available')).toBeNull()
  })
})
