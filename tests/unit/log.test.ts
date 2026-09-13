// The logger's surface is unchanged by the files behind it (A6-03, FR-004):
// the three call shapes, the tag that routes a line to engine.log, lines
// held until the files open, and a sink that fails never reaching a caller.

import { afterEach, describe, expect, it } from 'vitest'
import { byTag, ENGINE_TAG, holdingSink, log, setSink, toStderr } from '../../src/main/log'

afterEach(() => setSink(toStderr))

describe('the logger', () => {
  it('formats the three call shapes as before, and hands the sink the tag', () => {
    const got: [string, string][] = []
    setSink((line, tag) => got.push([line, tag]))
    log.info('config', 'SCHEMATIC_HOME=x (default)')
    log.warn('projects', 'skipped a folder')
    log.error('window', 'failed to load')
    expect(got).toEqual([
      ['[config] SCHEMATIC_HOME=x (default)', 'config'],
      ['[projects] warning: skipped a folder', 'projects'],
      ['[window] error: failed to load', 'window'],
    ])
  })

  it('still takes a sink that reads only the line', () => {
    const got: string[] = []
    setSink((line) => got.push(line))
    log.info('export', 'done')
    expect(got).toEqual(['[export] done'])
  })

  it('never lets a failing sink throw into the caller', () => {
    setSink(() => {
      throw new Error('disk full')
    })
    expect(() => log.error('engine', 'anything')).not.toThrow()
  })

  it('sends the engine tag to one sink and every other tag to the other', () => {
    const main: string[] = []
    const engine: string[] = []
    setSink(
      byTag(
        (line) => main.push(line),
        (line) => engine.push(line),
      ),
    )
    log.info(ENGINE_TAG, 'stderr: loom says hello')
    log.warn(ENGINE_TAG, 'the interpreter was not found')
    log.info('settings', 'reset removed nothing')
    log.info('engines', 'not the engine tag')
    expect(engine).toEqual([
      '[engine] stderr: loom says hello',
      '[engine] warning: the interpreter was not found',
    ])
    expect(main).toEqual(['[settings] reset removed nothing', '[engines] not the engine tag'])
  })
})

describe('the held lines', () => {
  it('are released in order, with their tags', () => {
    const held = holdingSink(10)
    held.sink('[config] a', 'config')
    held.sink('[engine] b', 'engine')
    const got: [string, string][] = []
    held.release((line, tag) => got.push([line, tag]))
    expect(got).toEqual([
      ['[config] a', 'config'],
      ['[engine] b', 'engine'],
    ])
    const again: string[] = []
    held.release((line) => again.push(line))
    expect(again, 'released once').toEqual([])
  })

  it('keep the newest when there are more than the limit, and say how many went', () => {
    const held = holdingSink(2)
    for (const n of [1, 2, 3, 4]) held.sink(`[config] ${n}`, 'config')
    const got: string[] = []
    held.release((line) => got.push(line))
    expect(got).toEqual([
      '[log] warning: 2 early line(s) were not kept',
      '[config] 3',
      '[config] 4',
    ])
  })
})
