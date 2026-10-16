import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The index in docs/adr/README.md and each record's own Status line said
// different things for ADR-037 (issue 431). The lead word of each must agree;
// what follows it (a date, "the mark superseded by 044") is prose.

const dir = join(__dirname, '..', '..', 'docs', 'adr')
const lead = (status: string): string => status.trim().split(/[;,\s]/)[0] ?? ''

const rows = new Map<string, string>()
for (const line of readFileSync(join(dir, 'README.md'), 'utf8').split('\n')) {
  const m = /^\| (\d{3}) \|.*\| ([^|]*?) \|$/.exec(line)
  if (m) rows.set(m[1]!, m[2]!)
}

const files = new Map<string, string>()
for (const name of readdirSync(dir)) {
  const m = /^(\d{3})-.*\.md$/.exec(name)
  // 000 is the template, which the index lists as n/a.
  if (!m || m[1] === '000') continue
  const status = /^(?:- \*\*Status:\*\*|Status:) (.+)$/m.exec(readFileSync(join(dir, name), 'utf8'))
  expect(status, `${name} has a Status line`).not.toBeNull()
  files.set(m[1]!, status![1]!)
}

describe('docs/adr index', () => {
  it('reads both sides', () => {
    expect(rows.size).toBeGreaterThan(50)
    expect(files.size).toBeGreaterThan(35)
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
})
