// The engine pin is data the handshake trusts, so its shape is checked here
// rather than discovered at the first launch against the wrong engine.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pins = JSON.parse(readFileSync(resolve(__dirname, '../../vendor/pins.json'), 'utf8'))

describe('vendor/pins.json engine block', () => {
  it('names the repository, a tag, the version and the protocol', () => {
    const engine = pins.engine
    expect(engine.repo).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(engine.tag).toBe(`v${engine.version}`)
    expect(engine.protocol).toBe(1)
    expect(typeof engine.note).toBe('string')
    expect(engine.licence).toBe('GPL-3.0-or-later')
  })
})
