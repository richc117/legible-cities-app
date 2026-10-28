import { describe, expect, it } from 'vitest'
import { escapeRegExp, SEP } from '../../src/shared/patterns'

describe('SEP', () => {
  const one = new RegExp(`^${SEP}$`)
  it('is either slash, or either one percent-encoded in either case', () => {
    for (const sep of ['/', '\\', '%2F', '%2f', '%5C', '%5c']) expect(one.test(sep), sep).toBe(true)
  })
  it('is no other character, and no other encoding', () => {
    for (const other of [':', '%3A', '%20', '%2', '//', '.', ''])
      expect(one.test(other), other).toBe(false)
  })
})

describe('escapeRegExp', () => {
  it('matches the text exactly, every special character taken as itself', () => {
    const text = String.raw`Maps\Program Files\a.b (x86)+[1]$^{2}|?*`
    const pattern = new RegExp(`^${escapeRegExp(text)}$`)
    expect(pattern.test(text)).toBe(true)
    expect(pattern.test(String.raw`Maps\Program Files\aXb (x86)+[1]$^{2}|?*`)).toBe(false)
    expect(pattern.test(String.raw`Maps\Program Files\a.b x86+[1]$^{2}|?*`)).toBe(false)
  })
  it('leaves a text with nothing special as it is', () => {
    expect(escapeRegExp('Jane Doe')).toBe('Jane Doe')
    expect(escapeRegExp('a.b')).toBe(String.raw`a\.b`)
  })
})
