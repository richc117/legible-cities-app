// The design tokens are a copy of the engine page's two theme blocks. This
// test fails when the copy drifts. It reads the page from the engine
// checkout named by LEGIBLE_ENGINE_CHECKOUT (environment or .env.local);
// where none is reachable it skips and says so. The pinned-engine form
// activates when the engine is vendored at a tag (research.md section 5).

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEnvFile } from '../../src/main/config'

const repoRoot = resolve(__dirname, '../..')
const PAGE = 'src/schematic/page/page.html'

function engineCheckout(): string | null {
  let value = process.env.LEGIBLE_ENGINE_CHECKOUT
  if (!value) {
    const envFile = join(repoRoot, '.env.local')
    if (existsSync(envFile)) {
      value = parseEnvFile(readFileSync(envFile, 'utf8')).LEGIBLE_ENGINE_CHECKOUT
    }
  }
  if (!value) return null
  return isAbsolute(value) ? value : resolve(repoRoot, value)
}

function block(css: string, selector: string): string | null {
  const start = css.indexOf(selector)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) return null
  return css.slice(open + 1, close)
}

function normalise(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(';')
}

const checkout = engineCheckout()
const page = checkout ? join(checkout, PAGE) : null
const available = page !== null && existsSync(page)

describe('design tokens', () => {
  const run = available ? it : it.skip
  const why = available
    ? ''
    : ' (skipped: set LEGIBLE_ENGINE_CHECKOUT in .env.local or the environment to the engine checkout)'

  run(`match the engine page's warm-dark and sepia blocks${why}`, () => {
    const tokens = readFileSync(join(repoRoot, 'src/renderer/src/styles/tokens.css'), 'utf8')
    const html = readFileSync(page!, 'utf8')
    for (const selector of [':root {', ':root[data-theme="sepia"] {']) {
      const ours = block(tokens, selector)
      const theirs = block(html, selector)
      expect(ours, `tokens.css has ${selector}`).not.toBeNull()
      expect(theirs, `page.html has ${selector}`).not.toBeNull()
      expect(normalise(ours!), selector).toBe(normalise(theirs!))
    }
  })
})
