// The theme the app last wrote to a project's record, kept where the viewer's
// restore reads it at the moment it sends (issue 349). No React and no
// window: what is asserted is which theme a call is given and when that
// is decided, which is the whole of the fix for a press that lands while a
// document is loading. Each test names a project of its own, because the
// memory is the module's and lives for the session.

import { describe, expect, it } from 'vitest'
import {
  asDispatchedTheme,
  forgetTheme,
  rememberTheme,
  themeAsItStands,
} from '../../src/renderer/src/themeMemory'

describe('the theme as it stands', () => {
  it('is the record’s where nothing has been written this session', () => {
    expect(themeAsItStands('memory-none-1', 'warm-dark')).toBe('warm-dark')
    expect(themeAsItStands('memory-none-2', 'sepia')).toBe('sepia')
  })

  it('is what the last write returned, whatever the record the screen holds says', () => {
    // The screen's record catches up a render later than the write returns;
    // the memory does not wait for it.
    rememberTheme('memory-wrote-1', 'sepia')
    expect(themeAsItStands('memory-wrote-1', 'warm-dark')).toBe('sepia')
    rememberTheme('memory-wrote-1', 'warm-dark')
    expect(themeAsItStands('memory-wrote-1', 'sepia'), 'the later write wins').toBe('warm-dark')
  })

  it('is each project’s own', () => {
    rememberTheme('memory-own-1', 'sepia')
    expect(themeAsItStands('memory-own-1', 'warm-dark')).toBe('sepia')
    expect(themeAsItStands('memory-own-2', 'warm-dark'), 'another project is not touched').toBe(
      'warm-dark',
    )
  })
})

describe('forgetting a project that is gone', () => {
  it('leaves the memory holding nothing for it, so its record answers again', () => {
    rememberTheme('memory-gone-1', 'sepia')
    expect(themeAsItStands('memory-gone-1', 'warm-dark')).toBe('sepia')
    forgetTheme('memory-gone-1')
    expect(themeAsItStands('memory-gone-1', 'warm-dark'), 'nothing is kept for it').toBe(
      'warm-dark',
    )
    expect(themeAsItStands('memory-gone-1', 'sepia')).toBe('sepia')
  })

  it('touches no other project, and is not an error for one it never held', () => {
    rememberTheme('memory-gone-2', 'sepia')
    expect(() => forgetTheme('memory-gone-never')).not.toThrow()
    forgetTheme('memory-gone-3')
    expect(themeAsItStands('memory-gone-2', 'warm-dark'), 'another project’s is kept').toBe('sepia')
  })
})

describe('asDispatchedTheme', () => {
  it('gives setTheme the theme as it stands, and not the one it was composed with', () => {
    expect(asDispatchedTheme('setTheme', ['warm-dark'], 'sepia')).toEqual(['sepia'])
  })

  it('leaves every other call’s arguments as they are', () => {
    for (const [method, args] of [
      ['seek', [26_400]],
      ['showView', ['schematic', 0]],
      ['setLabels', [true]],
      ['setSpeed', [30]],
      ['setPlaying', [false]],
    ] as const)
      expect(asDispatchedTheme(method, [...args], 'sepia'), method).toEqual(args)
  })
})
