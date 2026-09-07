import { describe, expect, it } from 'vitest'
import {
  contentTypeFor,
  decodeAssetPath,
  isValidProjectId,
  resolveInside,
} from '../../src/main/paths'

describe('isValidProjectId', () => {
  it('accepts opaque tokens', () => {
    for (const id of ['p1', 'la-metro-rail', 'A.b_c-1', '0', 'x'.repeat(64)]) {
      expect(isValidProjectId(id), id).toBe(true)
    }
  })
  it('refuses anything a filesystem would interpret', () => {
    for (const id of [
      '',
      '.',
      '..',
      '.hidden',
      'a/b',
      'a\\b',
      'C:',
      'c:\\x',
      '/abs',
      'x'.repeat(65),
      'ünïcode',
      'a b',
      '%2e%2e',
      '~',
    ]) {
      expect(isValidProjectId(id), JSON.stringify(id)).toBe(false)
    }
  })
})

describe('decodeAssetPath', () => {
  it('splits an ordinary path', () => {
    expect(decodeAssetPath('index.html')).toEqual(['index.html'])
    expect(decodeAssetPath('a/b.html')).toEqual(['a', 'b.html'])
    expect(decodeAssetPath('a/b%20c.png')).toEqual(['a', 'b c.png'])
  })
  it('refuses traversal in every spelling', () => {
    for (const raw of [
      '..',
      '../x',
      'a/../../x',
      '%2e%2e',
      '%2e%2e/x',
      'a/%2e%2e/x',
      './x',
      'a/./x',
    ]) {
      expect(decodeAssetPath(raw), raw).toBeNull()
    }
  })
  it('refuses encoded separators, backslashes, control characters and empties', () => {
    for (const raw of ['a%2fb', 'a%5cb', 'a\\b', 'a%00', 'a%0a', '', 'a/', '/a', 'a//b', '%']) {
      expect(decodeAssetPath(raw), JSON.stringify(raw)).toBeNull()
    }
  })
  it('decodes exactly once, so a double-encoded dot-dot is a literal filename', () => {
    expect(decodeAssetPath('%252e%252e')).toEqual(['%2e%2e'])
  })
})

describe('resolveInside', () => {
  const fake =
    (map: Record<string, string>) =>
    async (p: string): Promise<string> => {
      const key = p.replace(/\\/g, '/')
      if (key in map) return map[key]
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
  const posix = { sep: '/', join: (...p: string[]) => p.join('/') }

  it('returns the real path of a file inside the root', async () => {
    const realpath = fake({
      '/srv/out/p1': '/srv/out/p1',
      '/srv/out/p1/a/b.html': '/srv/out/p1/a/b.html',
    })
    await expect(
      resolveInside('/srv/out/p1', ['a', 'b.html'], { realpath, ...posix }),
    ).resolves.toEqual({ ok: true, path: '/srv/out/p1/a/b.html' })
  })
  it('reports a missing file and a missing root as missing', async () => {
    const realpath = fake({ '/srv/out/p1': '/srv/out/p1' })
    await expect(resolveInside('/srv/out/p1', ['nope'], { realpath, ...posix })).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
    await expect(resolveInside('/srv/out/zz', ['a'], { realpath, ...posix })).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
  })
  it('refuses a symbolic link that points outward', async () => {
    const realpath = fake({ '/srv/out/p1': '/srv/out/p1', '/srv/out/p1/link': '/etc/passwd' })
    await expect(resolveInside('/srv/out/p1', ['link'], { realpath, ...posix })).resolves.toEqual({
      ok: false,
      reason: 'outside',
    })
  })
  it('refuses a sibling whose name merely starts with the root', async () => {
    const realpath = fake({ '/srv/out/p1': '/srv/out/p1', '/srv/out/p1/x': '/srv/out/p10/x' })
    await expect(resolveInside('/srv/out/p1', ['x'], { realpath, ...posix })).resolves.toEqual({
      ok: false,
      reason: 'outside',
    })
  })
  it('never serves the root itself', async () => {
    const realpath = fake({ '/srv/out/p1': '/srv/out/p1', '/srv/out/p1/self': '/srv/out/p1' })
    await expect(resolveInside('/srv/out/p1', ['self'], { realpath, ...posix })).resolves.toEqual({
      ok: false,
      reason: 'outside',
    })
  })
  it('compares case-insensitively with the Windows separator when asked', async () => {
    const realpath = fake({
      'D:/data/out/p1': 'D:\\data\\out\\P1',
      'D:/data/out/p1/a.html': 'D:\\data\\out\\p1\\a.html',
    })
    await expect(
      resolveInside('D:/data/out/p1', ['a.html'], {
        realpath,
        sep: '\\',
        caseInsensitive: true,
        join: (...p: string[]) => p.join('/'),
      }),
    ).resolves.toEqual({ ok: true, path: 'D:\\data\\out\\p1\\a.html' })
  })
})

describe('contentTypeFor', () => {
  it('knows the types the browser must honour', () => {
    expect(contentTypeFor('a.html')).toMatch(/^text\/html/)
    expect(contentTypeFor('a.js')).toMatch(/^text\/javascript/)
    expect(contentTypeFor('a.css')).toMatch(/^text\/css/)
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('a.woff2')).toBe('font/woff2')
    expect(contentTypeFor('A.PNG')).toBe('image/png')
  })
  it('falls back to octet-stream', () => {
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream')
    expect(contentTypeFor('noext')).toBe('application/octet-stream')
  })
})
