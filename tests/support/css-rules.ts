// A reader for the app's own stylesheets, enough of CSS for a test to ask
// "which rules use this token". Not a general parser: the app's region
// files are flat rules, with @media, @container and @supports around some
// of them and no CSS nesting, and a file that breaks that (a rule inside a
// rule) is refused rather than half-read, because a rule the reader cannot
// see is a use of a colour nobody has stated the ground of.

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stylesFolder } from './colour'

export interface Declaration {
  property: string
  value: string
}

export interface Rule {
  file: string
  /** The at-rules around it, outermost first, each as written. */
  context: string[]
  /** The selector list as written, whitespace folded to single spaces. */
  selector: string
  declarations: Declaration[]
}

/** Every `.css` file directly under the styles folder, by name. */
export function stylesheets(): string[] {
  return readdirSync(stylesFolder)
    .filter((name) => name.endsWith('.css'))
    .sort()
}

const GROUPING = /^@(media|container|supports|layer)\b/

const fold = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Split a declaration block at the semicolons that are not inside brackets or quotes. */
function declarationsOf(body: string, where: string): Declaration[] {
  const out: Declaration[] = []
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number): void => {
    const text = body.slice(start, end)
    start = end + 1
    const colon = text.indexOf(':')
    if (fold(text) === '') return
    if (colon === -1) throw new Error(`${where}: a declaration with no colon: ${fold(text)}`)
    out.push({ property: text.slice(0, colon).trim(), value: fold(text.slice(colon + 1)) })
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote !== '') {
      if (c === quote && body[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ';' && depth === 0) flush(i)
  }
  flush(body.length)
  return out
}

/** The index of the brace that closes the one at `open`. */
function closing(css: string, open: number, where: string): number {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return i
  }
  throw new Error(`${where}: a brace that never closes`)
}

function read(css: string, file: string, context: string[], out: Rule[]): void {
  let at = 0
  while (at < css.length) {
    const open = css.indexOf('{', at)
    const semicolon = css.indexOf(';', at)
    // A statement at-rule (@import, @charset): no block.
    if (
      semicolon !== -1 &&
      (open === -1 || semicolon < open) &&
      css.slice(at, semicolon).includes('@')
    ) {
      at = semicolon + 1
      continue
    }
    if (open === -1) {
      if (fold(css.slice(at)) !== '') throw new Error(`${file}: text after the last rule`)
      return
    }
    const prelude = fold(css.slice(at, open))
    const close = closing(css, open, file)
    const inner = css.slice(open + 1, close)
    at = close + 1
    if (GROUPING.test(prelude)) {
      read(inner, file, [...context, prelude], out)
    } else if (prelude.startsWith('@')) {
      // @font-face, @keyframes, @property: not a selector's rule.
      if (inner.includes('{') && !/^@(keyframes|-webkit-keyframes)\b/.test(prelude))
        throw new Error(`${file}: a block inside ${prelude} the reader does not know`)
    } else {
      if (inner.includes('{'))
        throw new Error(`${file}: a rule inside ${prelude} (CSS nesting is not read here)`)
      out.push({ file, context, selector: prelude, declarations: declarationsOf(inner, file) })
    }
  }
}

/** Every rule of one stylesheet, comments stripped. */
export function rulesOf(file: string): Rule[] {
  const css = readFileSync(resolve(stylesFolder, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  read(css, file, [], out)
  return out
}
