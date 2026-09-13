// "Copy diagnostics" on the page's side (A6-03): what the page sends is
// bounded before it reaches the bridge, a project list that cannot be read
// costs the names and not the copy, and a refusal is a sentence.

import { describe, expect, it } from 'vitest'
import {
  copyDiagnostics,
  DIAGNOSTICS_COPIED,
  diagnosticsNotCopied,
} from '../../src/renderer/src/Settings'
import { DIAGNOSTICS_REPORTS } from '../../src/shared/api'

function bridge(
  over: {
    reports?: string[]
    list?: () => Promise<{ id: string; name: string }[]>
    copy?: (reports: string[]) => Promise<void>
  } = {},
) {
  const sent: string[][] = []
  const askedFor: (string | undefined)[] = []
  return {
    sent,
    askedFor,
    bridge: {
      listProjects: over.list ?? (async () => [{ id: 'p1', name: 'Bart' }]),
      reports: (nameOf: (id: string) => string | undefined) => {
        askedFor.push(nameOf('p1'), nameOf('gone'))
        return over.reports ?? ['a report']
      },
      copy:
        over.copy ??
        (async (reports: string[]) => {
          sent.push(reports)
        }),
    },
  }
}

describe('copying diagnostics from the page', () => {
  it('names the reports from the project list, sends them and says so', async () => {
    const b = bridge()
    expect(await copyDiagnostics(b.bridge)).toBe(DIAGNOSTICS_COPIED)
    expect(b.askedFor).toEqual(['Bart', undefined])
    expect(b.sent).toEqual([['a report']])
  })

  it('leaves out a report over 64 KB, in bytes rather than characters', async () => {
    const fits = 'é'.repeat(DIAGNOSTICS_REPORTS.bytes / 2)
    const over = 'é'.repeat(DIAGNOSTICS_REPORTS.bytes / 2 + 1)
    const b = bridge({ reports: [fits, over, 'short'] })
    await copyDiagnostics(b.bridge)
    expect(b.sent).toEqual([[fits, 'short']])
  })

  it('sends at most twenty reports, the newest', async () => {
    const reports = Array.from({ length: 25 }, (_, i) => `report ${i}`)
    const b = bridge({ reports })
    await copyDiagnostics(b.bridge)
    expect(b.sent[0]).toHaveLength(DIAGNOSTICS_REPORTS.count)
    expect(b.sent[0][0]).toBe('report 5')
    expect(b.sent[0][19]).toBe('report 24')
  })

  it('copies without names when the project list cannot be read', async () => {
    const b = bridge({ list: () => Promise.reject(new Error('the store is being reset')) })
    expect(await copyDiagnostics(b.bridge)).toBe(DIAGNOSTICS_COPIED)
    expect(b.askedFor).toEqual([undefined, undefined])
    expect(b.sent).toEqual([['a report']])
  })

  it('says why when the main process refuses, and throws nothing', async () => {
    const b = bridge({
      copy: () =>
        Promise.reject(
          new Error('the diagnostics still named your home folder, so nothing was copied'),
        ),
    })
    expect(await copyDiagnostics(b.bridge)).toBe(
      diagnosticsNotCopied('the diagnostics still named your home folder, so nothing was copied'),
    )
  })
})
