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

// The licence texts the runtime owes (issue 108, ADR-042). The vendor job
// proves the lists against the archives; this keeps their shape honest
// where no archive is at hand, so a list cannot say two things at once.
interface PythonTargetPin {
  asset: string
  triple: string
  full: { asset: string; sha256: string }
  licences: {
    unlisted: Record<string, { library: string; file: string; contains: string[] }>
    named_absent: Record<string, string>
    not_linked: string[]
  }
}

describe('vendor/pins.json python licence texts', () => {
  const python = pins.python
  const targets = Object.entries(python.targets as Record<string, PythonTargetPin>)

  it("pins each target's full archive beside its install_only asset, from the same build", () => {
    for (const [target, pin] of targets) {
      expect(pin.full.sha256, target).toMatch(/^[0-9a-f]{64}$/)
      const prefix = `cpython-${python.version}+${python.release}-${pin.triple}-`
      expect(pin.asset, target).toBe(`${prefix}install_only.tar.gz`)
      expect(pin.full.asset, target).toMatch(
        new RegExp(`^${prefix.replace(/[.+]/g, '\\$&')}pgo(\\+lto)?-full\\.tar\\.zst$`),
      )
    }
  })

  it('accounts for each text once, and says why for every exception', () => {
    for (const [target, pin] of targets) {
      const { unlisted, named_absent: absent, not_linked: notLinked } = pin.licences
      const all = [...Object.keys(unlisted), ...Object.keys(absent), ...notLinked]
      expect(new Set(all).size, `${target}: a text on two lists`).toBe(all.length)
      for (const name of all) expect(name, target).toMatch(/^LICENSE\.[\w.+-]+\.txt$/)
      for (const why of Object.values(absent)) expect(why.length).toBeGreaterThan(40)
      for (const entry of Object.values(unlisted)) {
        expect(entry.library.length, target).toBeGreaterThan(10)
        expect(entry.file, target).toMatch(/^[\w./-]+$/)
        expect(entry.contains.length, target).toBeGreaterThan(0)
        // A version is the C string it is in the binary, NUL on both sides,
        // so a later version that begins with it does not match.
        for (const text of entry.contains) {
          if (/\d\.\d/.test(text)) expect(text, `${target}: ${entry.file}`).toMatch(/^\0.+\0$/s)
        }
      }
    }
  })

  it("fetches CPython's notices by the commit of the pinned version's tag", () => {
    const notices = python.licence_texts.cpython_incorporated
    expect(notices.tag).toBe(`v${python.version}`)
    expect(notices.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(notices.url).toBe(
      `https://raw.githubusercontent.com/python/cpython/${notices.commit}/Doc/license.rst`,
    )
    expect(notices.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(notices.file).toMatch(/^[\w.-]+\.rst$/)
    expect(python.licence_texts.note).toContain('intended cost')
  })
})
