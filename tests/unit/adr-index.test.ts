import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The index in docs/adr/README.md and each record's own Status line said
// different things for ADR-037 (issue 431). The lead word of each must agree;
// what follows it (a date, "the mark superseded by 044") is prose.

const dir = join(__dirname, '..', '..', 'docs', 'adr')
const lead = (status: string): string => status.trim().split(/[;,\s]/)[0] ?? ''

// Number | Title | Status | Relations: four cells, no `|` inside a title.
const rows = new Map<string, string>()
const relations = new Map<string, string>()
for (const line of readFileSync(join(dir, 'README.md'), 'utf8').split('\n')) {
  const num = /^\| (\d{3}) \|/.exec(line)
  if (!num) continue
  const cells = line.slice(1, -1).split('|')
  expect(cells.length, `the index row for ADR-${num[1]} has four cells: ${line}`).toBe(4)
  rows.set(num[1]!, cells[2]!.trim())
  relations.set(num[1]!, cells[3]!.trim())
}

const files = new Map<string, string>()
// The ADR numbers each record's Supersedes / Superseded by / Amends / Amended by
// header lines name (a line and its indented continuation, up to the first heading).
const named = new Map<string, Set<string>>()
const RELATION = /^(?:- \*\*)?(Supersedes|Superseded by|Amends|Amended by):(?:\*\*)? ?(.*)$/
for (const name of readdirSync(dir)) {
  const m = /^(\d{3})-.*\.md$/.exec(name)
  // 000 is the template, which the index lists as n/a.
  if (!m || m[1] === '000') continue
  const text = readFileSync(join(dir, name), 'utf8')
  const status = /^(?:- \*\*Status:\*\*|Status:) (.+)$/m.exec(text)
  expect(status, `${name} has a Status line`).not.toBeNull()
  files.set(m[1]!, status![1]!)
  const set = new Set<string>()
  let inRelation = false
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) break
    const r = RELATION.exec(line)
    if (r) inRelation = true
    else if (!/^\s+\S/.test(line)) inRelation = false
    if (inRelation) for (const n of line.matchAll(/ADR-(\d{3})/g)) set.add(n[1]!)
  }
  named.set(m[1]!, set)
}

describe('docs/adr index', () => {
  it('reads both sides', () => {
    expect(rows.size).toBeGreaterThan(50)
    expect(files.size).toBeGreaterThan(35)
    expect([...named.values()].reduce((n, set) => n + set.size, 0)).toBeGreaterThan(20)
  })

  it('has a row for every record, and for every number below the highest', () => {
    for (const n of files.keys()) expect(rows.has(n), `ADR-${n} has a row`).toBe(true)
    const highest = Math.max(...[...files.keys()].map(Number))
    for (let i = 1; i <= highest; i++) {
      const n = String(i).padStart(3, '0')
      expect(rows.has(n), `ADR-${n} has a row, a reserved one if it has no record`).toBe(true)
    }
  })

  it('gives each record the status its file gives it', () => {
    for (const [n, status] of files) {
      expect(lead(rows.get(n) ?? ''), `ADR-${n}`).toBe(lead(status))
    }
  })

  it('shows in each row every record its header lines name', () => {
    for (const [n, set] of named) {
      const cell = relations.get(n) ?? ''
      const shown = new Set([...cell.matchAll(/\d{3}/g)].map((x) => x[0]))
      for (const other of set) {
        expect(
          shown.has(other),
          `ADR-${n}'s header names ADR-${other}; its Relations cell says "${cell}"`,
        ).toBe(true)
      }
    }
  })
})
