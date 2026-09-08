// The engine pin is data the handshake trusts, so its shape is checked here
// rather than discovered at the first launch against the wrong engine.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(resolve(repo, 'vendor/pins.json'), 'utf8'))

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

  // The committed description and its fingerprint move together or the
  // boundary is not guarded. This needs no engine, so it runs everywhere,
  // including on the machines that build the app.
  it('fingerprints the committed protocol description', () => {
    const schema = readFileSync(resolve(repo, 'vendor/protocol.schema.json'), 'utf8')
    const digest = createHash('sha256').update(schema, 'utf8').digest('hex')
    expect(pins.engine.schema_sha256, 'a 64-character SHA-256').toMatch(/^[0-9a-f]{64}$/)
    expect(
      digest,
      'vendor/protocol.schema.json and engine.schema_sha256 disagree; run `npm run typegen`',
    ).toBe(pins.engine.schema_sha256)
  })

  it('describes the protocol the pin claims', () => {
    const schema = JSON.parse(readFileSync(resolve(repo, 'vendor/protocol.schema.json'), 'utf8'))
    expect(schema.protocol).toBe(pins.engine.protocol)
  })
})
