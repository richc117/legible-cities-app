// Project identifiers and asset paths are untrusted input from another
// process (spec A-004). Everything here is pure - no Electron, no
// filesystem beyond an injected realpath - so the traversal matrix runs
// as unit tests on every platform. Rules: specs/001-electron-skeleton/data-model.md.

import * as nodePath from 'node:path'

export const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

// Windows device names are files everywhere on that platform: opening
// `<root>\CON` reaches the console and `COM1` can block on hardware. Never
// a project or a segment, in any case, with or without an extension.
export const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function isValidProjectId(id: string): boolean {
  return PROJECT_ID.test(id) && id !== '.' && id !== '..' && !RESERVED_NAME.test(id)
}

/** Control characters, DEL and the backslash: never part of a served path. */
function hasForbiddenCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 32 || code === 127 || code === 92) return true
  }
  return false
}

/**
 * The part of a /projects/<id>/... URL after the identifier, as path
 * segments, or null when it must be refused. The raw path is split on the
 * literal separator first and each segment decoded once on its own, so an
 * encoded separator (%2f, %5c) can never become one; a failed decode, a
 * control character, a backslash, an empty segment, `.` and `..` are all
 * refused. Decoding happens exactly once: a double-encoded dot-dot stays a
 * literal file name.
 */
export function decodeAssetPath(raw: string): string[] | null {
  const segments: string[] = []
  for (const encoded of raw.split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(encoded)
    } catch {
      return null
    }
    if (segment === '' || segment === '.' || segment === '..') return null
    if (segment.includes('/') || hasForbiddenCharacter(segment)) return null
    if (RESERVED_NAME.test(segment)) return null
    segments.push(segment)
  }
  return segments.length === 0 ? null : segments
}

export interface ResolveOptions {
  /** fs.promises.realpath, or a stand-in for tests. Must reject for a missing path. */
  realpath: (p: string) => Promise<string>
  sep?: string
  caseInsensitive?: boolean
  join?: (...parts: string[]) => string
}

export type Resolution = { ok: true; path: string } | { ok: false; reason: 'missing' | 'outside' }

/**
 * Resolve segments beneath root through real paths, so a symbolic link that
 * points outward is refused like a traversal. The root itself is never a
 * file to serve.
 */
export async function resolveInside(
  root: string,
  segments: string[],
  options: ResolveOptions,
): Promise<Resolution> {
  const sep = options.sep ?? nodePath.sep
  const join = options.join ?? nodePath.join
  const norm = (p: string): string => (options.caseInsensitive ? p.toLowerCase() : p)

  let rootReal: string
  let targetReal: string
  try {
    rootReal = await options.realpath(root)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    targetReal = await options.realpath(join(root, ...segments))
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (norm(targetReal) === norm(rootReal)) return { ok: false, reason: 'outside' }
  if (!norm(targetReal).startsWith(norm(rootReal) + sep)) return { ok: false, reason: 'outside' }
  return { ok: true, path: targetReal }
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export function contentTypeFor(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}
