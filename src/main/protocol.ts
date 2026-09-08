// The application origin, app://local: the interface under /ui/ and
// generated project output under /projects/<id>/. One scheme, one host, so
// a project page is same-origin with the interface (ADR-013). Routes,
// refusals and content types: specs/001-electron-skeleton/contracts/origin.md.

import { createReadStream } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { net, protocol } from 'electron'
import { contentTypeFor, decodeAssetPath, isValidProjectId, resolveInside } from './paths'

export interface AppProtocolOptions {
  /** The Vite dev server, e.g. http://localhost:5173; undefined outside development. */
  devUrl?: string
  /** electron-vite's renderer output, served in a built app. */
  uiRoot: string
  /** SCHEMATIC_HOME; project output is read from <engineHome>/out/<id>/. */
  engineHome: string
  /** Refusals are logged with the URL only, never the resolved path. */
  log?: (message: string) => void
}

const HOST = 'local'
const DEV_HMR_SOCKET = 'ws://localhost:5173'

function csp(development: boolean): string {
  const script = development ? "'self' 'unsafe-inline'" : "'self'"
  // Styles may be inline in every build: the control kit (FigUI3) styles
  // the inside of its shadow roots with <style> elements it creates, and a
  // policy of 'self' alone leaves its controls unstyled (specs/005,
  // research.md section 7). Scripts stay 'self' outside development.
  const style = "'self' 'unsafe-inline'"
  const connect = development ? `'self' ${DEV_HMR_SOCKET}` : "'self'"
  return [
    "default-src 'self'",
    `script-src ${script}`,
    `style-src ${style}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

const notFound = (): Response => text(404, 'not found')
const forbidden = (): Response => text(403, 'forbidden')

async function streamFile(path: string, method: string): Promise<Response> {
  let info
  try {
    info = await stat(path)
  } catch {
    return notFound()
  }
  if (!info.isFile()) return notFound()
  try {
    await access(path, constants.R_OK)
  } catch {
    return notFound() // an unreadable file would otherwise fail after a 200 went out
  }
  const headers: Record<string, string> = {
    'content-type': contentTypeFor(path),
    'content-length': String(info.size),
  }
  if (method === 'HEAD') return new Response(null, { status: 200, headers })
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, { status: 200, headers })
}

async function serveUnder(
  root: string,
  raw: string,
  method: string,
  log: (m: string) => void,
  url: string,
): Promise<Response> {
  const segments = decodeAssetPath(raw)
  if (segments === null) {
    log(`refused (bad path): ${url}`)
    return forbidden()
  }
  const resolved = await resolveInside(root, segments, {
    realpath,
    caseInsensitive: process.platform === 'win32',
  })
  if (!resolved.ok) {
    if (resolved.reason === 'outside') {
      log(`refused (outside root): ${url}`)
      return forbidden()
    }
    return notFound()
  }
  return streamFile(resolved.path, method)
}

// Only these reach the dev server. Forwarding the page's Origin and
// Sec-Fetch-* headers made Chromium treat the proxied fetch as cross-origin
// and fail every module script with net::ERR_FAILED; Host would trip Vite's
// allowed-hosts check.
const FORWARDED_HEADERS = ['accept', 'accept-language', 'if-none-match', 'if-modified-since']

function proxyHeaders(incoming: Headers): Headers {
  const out = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name)
    if (value !== null) out.set(name, value)
  }
  return out
}

function withCsp(response: Response, development: boolean): Response {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/html')) return response
  const headers = new Headers(response.headers)
  headers.set('content-security-policy', csp(development))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function handleAppRequest(
  req: Request,
  options: AppProtocolOptions,
): Promise<Response> {
  const log = options.log ?? (() => {})
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return notFound()
  }
  if (url.host !== HOST) return forbidden()
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'method not allowed')

  const pathname = url.pathname

  // Generated project output: /projects/<id>/<path>
  const project = /^\/projects\/([^/]*)(?:\/(.*))?$/.exec(pathname)
  if (project) {
    const [, id, rest = ''] = project
    if (!isValidProjectId(id)) {
      log(`refused (bad project id): ${url.href}`)
      return notFound()
    }
    if (rest === '') return notFound() // no directory listings
    const root = join(options.engineHome, 'out', id)
    return serveUnder(root, rest, req.method, log, url.href)
  }

  // The interface. In development every remaining path is the dev server's
  // (Vite emits root-relative URLs), reached through this proxy so the page
  // keeps the app://local origin; only a leading /ui is stripped.
  if (options.devUrl) {
    const stripped =
      pathname === '/ui' || pathname.startsWith('/ui/') ? pathname.slice(3) || '/' : pathname
    const upstream = await net.fetch(options.devUrl + stripped + url.search, {
      method: req.method,
      headers: proxyHeaders(req.headers),
    })
    return withCsp(upstream, true)
  }

  if (pathname === '/ui' || pathname === '/ui/') {
    const response = await streamFile(join(options.uiRoot, 'index.html'), req.method)
    return withCsp(response, false)
  }
  if (pathname.startsWith('/ui/')) {
    const response = await serveUnder(options.uiRoot, pathname.slice(4), req.method, log, url.href)
    return withCsp(response, false)
  }
  return notFound()
}

export function registerAppProtocol(options: AppProtocolOptions): void {
  const log = options.log ?? (() => {})
  protocol.handle('app', async (req) => {
    try {
      return await handleAppRequest(req, options)
    } catch (error) {
      log(`error: ${(error as Error).message} for ${req.url}`)
      return text(500, 'internal error')
    }
  })
}
