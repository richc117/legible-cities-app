// The address the map's frame is sent to, and when it is sent somewhere new
// (issue 349). No React and no window: the rule is that a theme change alone
// never changes the address, because an address that changes is a navigation
// and a navigation is a new document that loses the page's clock, view,
// labels and scrub position. The end-to-end suite shows it on a real frame
// (`tests/e2e/theme.spec.ts`); this is the rule without one.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressFor, wantedAddress } from '../../src/renderer/src/viewerAddress'
import { roleOfAddress } from '../../src/main/viewer'
import type { Theme } from '../../src/shared/project'

const PROJECT = { id: 'abcdefghijk1', feed: 'la-metro-rail', theme: 'warm-dark' as Theme }

describe('addressFor', () => {
  it('names the page, the map frame’s own word, the theme at navigation and the redraw', () => {
    expect(addressFor(PROJECT, 0, 'warm-dark')).toBe(
      'app://local/projects/abcdefghijk1/la-metro-rail.html?present=1&controls=1&theme=warm-dark&redraw=0',
    )
    expect(addressFor(PROJECT, 3, 'sepia')).toBe(
      'app://local/projects/abcdefghijk1/la-metro-rail.html?present=1&controls=1&theme=sepia&redraw=3',
    )
  })

  it('is read by the main process as the map’s frame, whichever theme it carries', () => {
    // `controls=1` is what `roleOfAddress` reads as the map, and an address
    // it read as anything else would never be held and never be driven.
    for (const theme of ['warm-dark', 'sepia'] as const)
      expect(roleOfAddress(addressFor(PROJECT, 0, theme), PROJECT.id), theme).toBe('map')
  })
})

describe('wantedAddress', () => {
  it('begins with the project theme on its address', () => {
    expect(wantedAddress(null, { ...PROJECT, theme: 'sepia' }, 0).address).toBe(
      addressFor(PROJECT, 0, 'sepia'),
    )
  })

  it('is the same address, as the same object, when only the theme has changed', () => {
    const before = wantedAddress(null, PROJECT, 0)
    const pressed = wantedAddress(before, { ...PROJECT, theme: 'sepia' }, 0)
    expect(pressed, 'the same answer, so nothing downstream sees a change').toBe(before)
    expect(pressed.address, 'and the theme on it is the one the address was made with').toContain(
      'theme=warm-dark',
    )
    // And back again, and again: a person can press all day.
    const back = wantedAddress(pressed, { ...PROJECT, theme: 'warm-dark' }, 0)
    expect(back).toBe(before)
    expect(wantedAddress(back, { ...PROJECT, theme: 'sepia' }, 0)).toBe(before)
  })

  it('is made again by a redraw, with the theme the project has then', () => {
    const before = wantedAddress(null, PROJECT, 0)
    const pressed = { ...PROJECT, theme: 'sepia' as Theme }
    expect(wantedAddress(before, pressed, 0).address, 'the press alone changes nothing').toBe(
      before.address,
    )
    const redrawn = wantedAddress(before, pressed, 1)
    expect(redrawn).not.toBe(before)
    expect(redrawn.address).toBe(addressFor(PROJECT, 1, 'sepia'))
    expect(redrawn.address, 'a page a run has rewritten boots in the chosen theme').toContain(
      'theme=sepia&redraw=1',
    )
  })

  it('keeps the theme it was made with through a redraw it is the same theme for', () => {
    const redrawn = wantedAddress(wantedAddress(null, PROJECT, 0), PROJECT, 1)
    expect(redrawn.address).toContain('theme=warm-dark&redraw=1')
  })

  it('is made again for another project or another feed', () => {
    const before = wantedAddress(null, PROJECT, 0)
    const other = wantedAddress(before, { ...PROJECT, id: 'zzzzzzzzzzz1' }, 0)
    expect(other).not.toBe(before)
    expect(other.address).toContain('/projects/zzzzzzzzzzz1/')
    const feed = wantedAddress(before, { ...PROJECT, feed: 'bart' }, 0)
    expect(feed).not.toBe(before)
    expect(feed.address).toContain('/bart.html')
  })
})

// What the component does with them cannot be rendered here (a frame is a
// browser's), so the two lines that carry the rule are read: the end-to-end
// suite is the proof, and this is what says which line a failure there is
// about.
describe('the viewer', () => {
  const source = readFileSync(resolve(__dirname, '../../src/renderer/src/Viewer.tsx'), 'utf8')

  it('takes its address from wantedAddress, and never builds one from the live theme', () => {
    expect(source, 'the address comes from the rule').toMatch(/\bwantedAddress\(/)
    expect(source, 'and is not built beside it').not.toMatch(/\baddressFor\(/)
    expect(source, 'nor from a template of its own').not.toMatch(/app:\/\/local\/projects/)
  })

  it('gives every load the project theme as it stands, as the restore’s theme', () => {
    expect(source).toMatch(/\brestoreCalls\([^;]*\btheme\.current\b/)
  })
})
