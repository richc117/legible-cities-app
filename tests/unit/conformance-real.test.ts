// The conformance table asked of the real engine (spec 038, FR-007).
//
// The rows of `tests/support/conformance.ts`, which `stand-in-params.test.ts`
// asks of the stand-in on every pull request, asked here of the engine the
// environment names, so a sentence the stand-in copied and the engine has
// since changed fails a row: the sentences are checked, not only copied. The
// determinism workflow runs it against the engine it vendored, beside the
// other `*-real` suites; a row the stand-in alone is asked says why there.
//
// The engine runs on a home of its own with no feed in it, cannot reach the
// network (`OFFLINE`) and has no LOOM (`noLoom`), so nothing a row asks can
// download a feed or lay one out: every row is refused before that. The
// interpreter comes from the environment alone, never `.env.local`:
//
//   LEGIBLE_ENGINE_PYTHON=/path/to/engine/.venv/bin/python npx vitest run tests/unit/conformance-real.test.ts

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { expected, prepareFiles, removeFiles, rows, said } from '../support/conformance'
import { OFFLINE } from '../support/determinism'
import { Server } from '../support/raw-server'
import { failIfRequired, HANDSHAKE_MS, noLoom } from '../support/real-engine'

const RESOLUTION = resolveInterpreter({
  config: {
    enginePython: process.env.LEGIBLE_ENGINE_PYTHON ?? null,
    engineCheckout: process.env.LEGIBLE_ENGINE_CHECKOUT ?? null,
  },
  packaged: false,
  resourcesPath: '',
  platform: process.platform,
  exists: existsSync,
})
const ENGINE = RESOLUTION.interpreter
// A skipped block prints only its title, so the title says why, in the words
// the resolution gave.
const WHY = ENGINE === null ? ` (skipped: ${RESOLUTION.reason})` : ''

failIfRequired('the conformance table against the real engine', ENGINE === null, 'no engine')

const asked = rows.filter((row) => row.standInOnly === undefined)

beforeAll(() => prepareFiles())
afterAll(() => removeFiles())

describe.skipIf(ENGINE === null)(`the conformance table, asked of the real engine${WHY}`, () => {
  let home = ''
  let server: Server

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lc-conformance-engine-'))
    const base = { ...process.env }
    delete base.PYTHONPATH
    server = new Server(
      ENGINE as string,
      {
        ...engineEnvironment({
          config: { home, loomBin: noLoom(home), loomCommit: null, ffmpeg: null },
          base,
          development: true,
        }),
        ...OFFLINE,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      home,
    )
    // A cold start imports pandas, which on a fresh Windows runner is slow.
    await server.request('engine.info', undefined, HANDSHAKE_MS)
  }, HANDSHAKE_MS + 5_000)

  afterAll(async () => {
    await server?.stop()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })

  it('is asked every row but the ones the stand-in alone can be, each with its reason', () => {
    const alone = rows.filter((row) => row.standInOnly !== undefined)
    expect(asked.length + alone.length).toBe(rows.length)
    for (const row of alone) expect(row.standInOnly?.trim()).not.toBe('')
    expect(asked.length).toBeGreaterThan(300)
  })

  it.each(asked)('refuses $method with $what, in its own words', async (row) => {
    const reply = await server.request(row.method, row.params)
    expect(said(reply)).toEqual(expected(row.expect.error))
  })
})
