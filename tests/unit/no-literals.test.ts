// Every colour, size and duration the interface uses is a token. A literal
// in a component file is a value the contrast test cannot see and a theme
// cannot change, so this test names it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../src/renderer/src')
const TOKEN_FILES = new Set([
  'styles/tokens.css',
  'styles/theme.css',
  'styles/scale.css',
  'styles/figui-adapter.css',
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...walk(path))
    } else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

const RULES: [RegExp, string][] = [
  [/#[0-9a-fA-F]{3,8}\b(?![\w-])/, 'a hex colour'],
  [/(?<![\w.-])(?!0px)\d+(\.\d+)?px\b/, 'a pixel size'],
  [/(?<![\w.-])\d+(\.\d+)?m?s\b(?!\w)/, 'a duration'],
]

describe('component files carry no colour, size or duration literal', () => {
  const files = walk(root).filter((f) => !TOKEN_FILES.has(relative(root, f).replace(/\\/g, '/')))
  expect(files.length).toBeGreaterThan(5)
  for (const file of files) {
    it(relative(root, file), () => {
      const lines = readFileSync(file, 'utf8').split('\n')
      const found: string[] = []
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
        if (/^\s*\*|^\s*\/\*|^\s*\/\//.test(line)) return
        for (const [rule, what] of RULES) {
          if (rule.test(code)) found.push(`line ${i + 1}: ${what}: ${line.trim()}`)
        }
      })
      expect(found, found.join('\n')).toEqual([])
    })
  }
})
