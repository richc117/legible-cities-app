// The policy generated pages are served with, and the one they must never be
// served with.
//
// ADR-028 warns about this twice, in both directions: reusing the
// interface's policy on a project page would set `frame-ancestors 'none'`
// and stop the viewer loading at all, and serving a project page with no
// policy is what the app did before. Neither mistake announces itself, so
// this is what would catch them.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAppRequest } from '../../src/main/protocol'

let home: string
let uiRoot: string
const ID = 'abcdefghijk1'

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'lc-csp-home-'))
  uiRoot = mkdtempSync(join(tmpdir(), 'lc-csp-ui-'))
  mkdirSync(join(home, 'out', ID), { recursive: true })
  writeFileSync(join(home, 'out', ID, 'la.html'), '<!doctype html><title>map</title>')
  writeFileSync(join(home, 'out', ID, 'la.svg'), '<svg/>')
  writeFileSync(join(uiRoot, 'index.html'), '<!doctype html><title>interface</title>')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(uiRoot, { recursive: true, force: true })
})

const get = (path: string): Promise<Response> =>
  handleAppRequest(new Request(`app://local${path}`), { engineHome: home, uiRoot })

const policy = async (path: string): Promise<string | null> =>
  (await get(path)).headers.get('content-security-policy')

describe('a generated project page', () => {
  it('is served with a policy of its own', async () => {
    const csp = await policy(`/projects/${ID}/la.html`)
    expect(csp, 'a project page with no policy is what this feature closed').not.toBeNull()
  })

  it('may be framed by the interface, and by nothing else', async () => {
    const csp = (await policy(`/projects/${ID}/la.html`)) as string
    expect(csp).toContain("frame-ancestors 'self'")
    // The interface's policy would stop the viewer loading at all. This is
    // the mistake ADR-028 names, and it is silent when made.
    expect(csp, 'the interface policy would block the viewer').not.toContain(
      "frame-ancestors 'none'",
    )
  })

  it('allows the page its own inline script and style, and nothing outside it', async () => {
    const csp = (await policy(`/projects/${ID}/la.html`)) as string
    // The page is deliberately one self-contained file.
    expect(csp).toContain("script-src 'unsafe-inline'")
    expect(csp).toContain("style-src 'unsafe-inline'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('img-src data:')
    // And no route out: no connections, no forms, no base rewriting.
    expect(csp).not.toContain('connect-src')
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    // Never eval, whatever else is allowed.
    expect(csp).not.toContain('unsafe-eval')
  })

  it('carries the same policy for every file it serves, not just the page', async () => {
    expect(await policy(`/projects/${ID}/la.svg`)).toBe(await policy(`/projects/${ID}/la.html`))
  })
})

describe('the interface', () => {
  it('keeps its own policy, which forbids being framed', async () => {
    const csp = (await policy('/ui/')) as string
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("script-src 'self'")
  })

  it('is not served the project policy', async () => {
    const ui = (await policy('/ui/')) as string
    const project = (await policy(`/projects/${ID}/la.html`)) as string
    expect(ui).not.toBe(project)
    expect(ui, 'the interface must never allow an inline script').not.toContain(
      "script-src 'unsafe-inline'",
    )
  })
})
