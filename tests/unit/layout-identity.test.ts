// The layout's identifier and what it refuses. The engine names the four
// stage graphs; the app hashes them, and trusts none of the paths, because
// they reached the main process by way of a page.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layoutIdentity } from '../../src/main/layout'

let home: string
let outside: string
let stages: string[]

const write = (path: string, text: string): string => {
  writeFileSync(path, text)
  return path
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'lc-layout-home-'))
  outside = mkdtempSync(join(tmpdir(), 'lc-layout-out-'))
  const graphs = join(home, 'data', 'graphs', 'la-metro-rail')
  mkdirSync(graphs, { recursive: true })
  stages = ['00_gtfs2graph', '01_topo', '02_loom', '03_octi'].map((name, i) =>
    write(join(graphs, `${name}.json`), `{"stage":${i}}`),
  )
  write(join(outside, 'secret.json'), 'not yours')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('layoutIdentity', () => {
  it('is 64 hexadecimal characters and the same for the same bytes', async () => {
    const first = await layoutIdentity(stages, home)
    const second = await layoutIdentity(stages, home)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
  })

  it('changes when any one stage changes', async () => {
    const before = await layoutIdentity(stages, home)
    write(stages[2], '{"stage":2,"changed":true}')
    const after = await layoutIdentity(stages, home)
    expect(after).not.toBe(before)
    write(stages[2], '{"stage":2}')
    expect(await layoutIdentity(stages, home)).toBe(before)
  })

  // The length goes into the hash before the bytes, so moving a byte from
  // one stage to the next cannot produce the same digest.
  it('distinguishes two different splits of the same bytes', async () => {
    const dir = join(home, 'data', 'graphs', 'split')
    mkdirSync(dir, { recursive: true })
    const four = (a: string, b: string): string[] => [
      write(join(dir, 'a.json'), a),
      write(join(dir, 'b.json'), b),
      write(join(dir, 'c.json'), 'c'),
      write(join(dir, 'd.json'), 'd'),
    ]
    const left = await layoutIdentity(four('xy', 'z'), home)
    const right = await layoutIdentity(four('x', 'yz'), home)
    expect(left).not.toBe(right)
  })

  it('refuses anything but four stage graphs', async () => {
    await expect(layoutIdentity(stages.slice(0, 3), home)).rejects.toThrow(/4 stage graphs/)
    await expect(layoutIdentity([...stages, stages[0]], home)).rejects.toThrow(/4 stage graphs/)
    await expect(layoutIdentity([], home)).rejects.toThrow(/named 0/)
  })

  it('refuses a path that is not absolute', async () => {
    const relative = [...stages]
    relative[1] = 'data/graphs/la-metro-rail/01_topo.json'
    await expect(layoutIdentity(relative, home)).rejects.toThrow(/topo/)
  })

  it('refuses a path outside the engine home', async () => {
    const escaped = [...stages]
    escaped[0] = join(outside, 'secret.json')
    await expect(layoutIdentity(escaped, home)).rejects.toThrow(/outside the engine's home/)
  })

  it('refuses a symbolic link that points outside', async () => {
    const link = join(home, 'data', 'graphs', 'la-metro-rail', 'link.json')
    rmSync(link, { force: true })
    symlinkSync(join(outside, 'secret.json'), link)
    const escaped = [...stages]
    escaped[3] = link
    await expect(layoutIdentity(escaped, home)).rejects.toThrow(/outside the engine's home/)
  })

  it('refuses a directory and a file that is not there', async () => {
    const dir = [...stages]
    dir[2] = join(home, 'data', 'graphs', 'la-metro-rail')
    await expect(layoutIdentity(dir, home)).rejects.toThrow(/not a file/)
    const missing = [...stages]
    missing[1] = join(home, 'data', 'graphs', 'la-metro-rail', 'nope.json')
    await expect(layoutIdentity(missing, home)).rejects.toThrow(/not where the engine said/)
  })

  it('refuses an engine home that is not there', async () => {
    await expect(layoutIdentity(stages, join(outside, 'gone'))).rejects.toThrow(/engine home/)
  })

  // A refusal is shown to a person, so it names the stage and never a path.
  it('never puts a path in a refusal', async () => {
    const attempts: Promise<unknown>[] = [
      layoutIdentity(stages.slice(0, 2), home),
      layoutIdentity([join(outside, 'secret.json'), ...stages.slice(1)], home),
      layoutIdentity([...stages.slice(0, 3), join(home, 'nope.json')], home),
    ]
    for (const attempt of attempts) {
      const error = (await attempt.catch((e: Error) => e)) as Error
      expect(error).toBeInstanceOf(Error)
      expect(error.message, error.message).not.toMatch(/[/\\]/)
      expect(error.message).not.toContain(tmpdir())
    }
  })
})
