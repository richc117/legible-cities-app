// The determinism test's two instruments, checked without the app (A5-04):
// the frame comparison, in RGB at a channel tolerance of 8, and the layout
// check, which must fail when the identifier between two exports changes.
// The end-to-end test (tests/e2e/determinism.spec.ts) relies on both.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  FIXTURE,
  fixtureLayoutId,
  layoutDrift,
  layoutSnapshot,
  seedHome,
  type LayoutSnapshot,
} from '../support/determinism'
import { compareStreams, decodeArgs, TOLERANCE } from '../support/frames'

async function* chunks(...parts: number[][]): AsyncGenerator<Buffer> {
  for (const part of parts) yield Buffer.from(part)
}

describe('the frame comparison', () => {
  it('is in RGB, eight bits a channel, and never RGBA', () => {
    const args = decodeArgs('a.gif')
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('rgb24')
    // Each of the file's frames once, so a frame index names the file's frame.
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough')
    expect(args.join(' ')).not.toMatch(/rgba|argb|bgra/)
  })

  it('holds a difference of exactly the tolerance to be the same pixel', async () => {
    expect(TOLERANCE).toBe(8)
    const result = await compareStreams(
      chunks([10, 20, 30, 40, 50, 60]),
      chunks([18, 12, 30, 40, 50, 60]),
      {
        frameBytes: 3,
      },
    )
    expect(result).toMatchObject({ bytes: 6, maxDiff: 8, over: 0, sameLength: true, frames: 2 })
    expect(result.differing).toEqual([])
  })

  it('refuses one more than the tolerance, and names the frame it is in', async () => {
    const a = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    const b = [0, 0, 0, 0, 0, 0, 0, 9, 0]
    const result = await compareStreams(chunks(a), chunks(b), { frameBytes: 3 })
    expect(result.over).toBe(1)
    expect(result.maxDiff).toBe(9)
    expect(result.differing).toEqual([2])
  })

  it('is not exact equality: two frames a level apart everywhere agree', async () => {
    const a = Array.from({ length: 30 }, (_, i) => i)
    const b = a.map((v) => v + 1)
    const result = await compareStreams(chunks(a), chunks(b), { frameBytes: 3 })
    expect(result.over).toBe(0)
    expect(result.frames).toBe(10)
  })

  it('compares across chunk boundaries that differ between the two streams', async () => {
    const result = await compareStreams(
      chunks([1, 2], [3, 4, 5, 6]),
      chunks([1], [2, 3, 4], [5, 99]),
      {
        frameBytes: 2,
      },
    )
    expect(result.bytes).toBe(6)
    expect(result.differing).toEqual([2])
    expect(result.sameLength).toBe(true)
  })

  it('says when one file has frames the other does not', async () => {
    const result = await compareStreams(chunks([1, 2, 3], [4, 5, 6]), chunks([1, 2, 3]))
    expect(result.sameLength).toBe(false)
    expect(result.over).toBe(0)
  })
})

describe('the layout check', () => {
  const id = 'a'.repeat(64)
  const other = 'b'.repeat(64)
  const snapshot: LayoutSnapshot = {
    layout: id,
    made: '2026-09-11T04:39:55+00:00',
    stored: { [id]: '2026-09-11T04:39:55+00:00' },
  }

  it('finds nothing between two exports from the same stored layout', () => {
    expect(layoutDrift(snapshot, structuredClone(snapshot))).toEqual([])
  })

  it('fails when the layout identifier changes between the two exports', () => {
    const swapped: LayoutSnapshot = {
      ...snapshot,
      layout: other,
      stored: { ...snapshot.stored, [other]: snapshot.made },
    }
    const drift = layoutDrift(snapshot, swapped)
    expect(drift).toContain(`the record's layout moved from ${id} to ${other}`)
    expect(drift).toContain(`stored layout ${other} appeared`)
  })

  it('fails when the record names a layout that is not stored', () => {
    expect(layoutDrift(snapshot, { ...snapshot, layout: other })).toContain(
      `the record names ${other}, which is not stored`,
    )
  })

  it('fails when the same id was laid out again', () => {
    const again: LayoutSnapshot = {
      ...snapshot,
      stored: { [id]: '2026-09-12T10:00:00+00:00' },
    }
    expect(layoutDrift(snapshot, again)).toEqual([
      `stored layout ${id} was made again (2026-09-11T04:39:55+00:00 to 2026-09-12T10:00:00+00:00)`,
    ])
  })

  it('reads a home: a swapped id in the record is found on disk too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-determinism-unit-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    const home = join(dir, 'engine')
    seedHome(home)
    const project = join(home, 'projects', 'determinism1')
    mkdirSync(project, { recursive: true })
    const fixture = fixtureLayoutId()
    const write = (layout: string): void =>
      writeFileSync(join(project, 'project.json'), JSON.stringify({ layout, made: null }))
    write(fixture)
    const before = layoutSnapshot(home)
    expect(Object.keys(before.stored)).toEqual([fixture])
    expect(layoutDrift(before, layoutSnapshot(home))).toEqual([])
    write(other)
    expect(layoutDrift(before, layoutSnapshot(home))).not.toEqual([])
  })
})

describe('the committed fixture', () => {
  it('is the BART feed and one stored layout, whole, with nothing personal in its meta', () => {
    const id = fixtureLayoutId()
    const folder = join(FIXTURE, 'data', 'graphs', 'bart', id)
    expect(readdirSync(folder).sort()).toEqual([
      '.meta.json',
      '00_gtfs2graph.json',
      '01_topo.json',
      '02_loom.json',
      '03_octi.json',
    ])
    expect(existsSync(join(FIXTURE, 'data', 'feeds', 'bart.zip'))).toBe(true)
    const meta = readFileSync(join(folder, '.meta.json'), 'utf8')
    expect(JSON.parse(meta)).toMatchObject({ feed: 'bart', mode: 'all', agency: null, loom: null })
    expect(meta).not.toMatch(/[/\\](Users|home)[/\\]|[A-Za-z]:\\/)
  })
})
