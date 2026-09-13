// Generated addresses in the engine's real message shapes (A6-03), so the
// redaction is not found wanting one hand-written shape at a time. A fixed
// seed and a small PRNG of the test's own: the same 600 cases on every run
// and every machine, and no dependency. Every host is a documentation name
// or address (RFC 2606, RFC 5737, RFC 3849), never a real feed.
//
// For each case: the secret never survives `redactUrls`, nor the composed
// copy, and a second pass changes nothing. A case that cannot be made to
// pass is kept, marked with why, and listed in the spec's not-covered
// section, rather than taken out of the generator.

import { describe, expect, it } from 'vitest'
import { diagnosticsText, type DiagnosticsInput } from '../../src/main/diagnostics-text'
import { redactUrls } from '../../src/main/redact'

/** mulberry32: a 32-bit seeded generator, good enough to vary test input. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = prng(0x5eed_a603)
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1))

const USERS = ['u', 'user', 'feed.reader']
const PASSWORDS = ['p(ss', "o'k", 'br{ace', 'pi|pe', 'pc%t', 'pc%20t', 'plain', 'a)b']
const HOSTS = ['feeds.example.org', 'data.example.net', '192.0.2.10', '[2001:db8::1]']
const PORTS = ['', ':443', ':8443']
const SEGMENTS = ['feeds', '{z}', '{x}.png', "it's", 'a(b)', 'gtfs.zip', 'resource', 'x.zip']
const NAMES = ['key', 'api_key', '$where', '$$app_token', 'filter', 'format', 'v', 'token']
const PIECES = ["'", '(', ')', '$', '=', '%27', '&', 'A', 'rail', '1']
const FRAGMENTS = ['', '#section', '#top']

interface Case {
  n: number
  url: string
  host: string
  pathQuery: string
  /**
   * The secret lands where a parameter's name goes, because a value before
   * it holds an unencoded `&` and one after it an `=` (`?key=&SECRET…=1`).
   * A server would read it as a name too, and names are kept on purpose:
   * NOT COVERED, and listed so in the spec. The case stays in the
   * generator; only the secret assertion is waived for it, and a test below
   * says how many there are and that each is exactly this.
   */
  secretIsAName: boolean
}

/** Whether the secret sits before the `=` of the query part that holds it. */
function inNamePosition(url: string, n: number): boolean {
  const hash = url.indexOf('#')
  const query = url.slice(url.indexOf('?') + 1, hash >= 0 ? hash : url.length)
  const token = `SECRETTOKEN${n}`
  const part = query.split(/[&;]/).find((p) => p.includes(token)) ?? ''
  const equals = part.indexOf('=')
  return equals >= 0 && part.indexOf(token) < equals
}

function value(): string {
  return Array.from({ length: between(0, 3) }, () => pick(PIECES)).join('')
}

function generate(n: number): Case {
  const scheme = pick(['http', 'https'])
  const userinfo = random() < 0.3 ? `${pick(USERS)}:${pick(PASSWORDS)}@` : ''
  const host = pick(HOSTS)
  const path = '/' + Array.from({ length: between(0, 3) }, () => pick(SEGMENTS)).join('/')
  const count = between(1, 4)
  const secretAt = between(0, count - 1)
  const params: string[] = []
  for (let i = 0; i < count; i += 1) {
    const name = pick(NAMES)
    const v = i === secretAt ? `${value()}SECRETTOKEN${n}${value()}` : value()
    params.push(`${name}=${v}`)
  }
  let query = params[0]
  for (let i = 1; i < params.length; i += 1) query += pick(['&', ';']) + params[i]
  const pathQuery = `${path}?${query}${pick(FRAGMENTS)}`
  const url = `${scheme}://${userinfo}${host}${pick(PORTS)}${pathQuery}`
  return { n, url, host, pathQuery, secretIsAName: inNamePosition(url, n) }
}

/** The shapes the engine at v0.8.2 prints a URL in, on the stderr the supervisor logs. */
function shapes(c: Case): Record<string, string> {
  const pool = `HTTPSConnectionPool(host='${c.host}', port=443): Max retries exceeded with url: ${c.pathQuery} (Caused by NameResolutionError("<urllib3.connection.HTTPSConnection object at 0x10a2b3c40>: Failed to resolve '${c.host}' ([Errno 8] nodename nor servname provided, or not known)"))`
  return {
    feedError: `[engine] stderr: schematic.feeds.FeedError: ${c.url} could not be fetched: ${pool}`,
    urllib3: `[engine] stderr: urllib3.exceptions.MaxRetryError: ${pool}`,
    forbidden: `[engine] stderr: requests.exceptions.HTTPError: 403 Client Error: Forbidden for url: ${c.url}`,
    repr: `[engine] stderr: {'url': '${c.url}'}`,
    encoded: `[engine] stderr: redirected to ${encodeURIComponent(c.url)}`,
  }
}

const input = (engineLog: string): DiagnosticsInput => ({
  app: { name: 'Legible Cities', version: '0.0.0' },
  versions: {},
  os: { type: 'Linux', release: '6.0.0', arch: 'x64' },
  engine: { absent: 'not running' },
  mainLog: '',
  engineLog,
  reports: [],
})

const CASES = Array.from({ length: 600 }, (_, n) => generate(n))

describe('generated addresses in the engine’s message shapes', () => {
  it('generates what it says it does', () => {
    expect(CASES).toHaveLength(600)
    expect(CASES.some((c) => c.url.includes('@'))).toBe(true)
    expect(CASES.some((c) => c.url.includes('[2001:db8::1]'))).toBe(true)
    expect(CASES.some((c) => c.url.includes('{z}'))).toBe(true)
    expect(CASES.some((c) => /[;&].*SECRETTOKEN/.test(c.url))).toBe(true)
    expect(CASES.some((c) => c.url.includes("'") && c.url.includes('('))).toBe(true)
  })

  it('never lets the secret through, in a line or in the copy, and is stable on a second pass', () => {
    const failures: string[] = []
    for (const c of CASES) {
      for (const [shape, line] of Object.entries(shapes(c))) {
        const once = redactUrls(line)
        if (once.includes('SECRETTOKEN') && !c.secretIsAName) {
          failures.push(`${shape} #${c.n}: ${once}`)
        } else if (redactUrls(once) !== once) {
          failures.push(`${shape} #${c.n} unstable: ${once}`)
        }
      }
    }
    expect(failures.slice(0, 5), `${failures.length} failing`).toEqual([])
  })

  it('never lets the secret into the composed copy', () => {
    const log = CASES.filter((c) => !c.secretIsAName)
      .flatMap((c) => Object.values(shapes(c)))
      .join('\n')
    // The copy carries the last lines of a log; each case is tried in a
    // copy of its own lines so none is left out of the tail.
    for (let i = 0; i < CASES.length; i += 50) {
      // Past the end of the log, a chunk is empty and passes trivially.
      const chunk = log
        .split('\n')
        .slice(i * 5, (i + 50) * 5)
        .join('\n')
      expect(diagnosticsText(input(chunk), [], 'linux')).not.toContain('SECRETTOKEN')
    }
  })

  it('waives only the cases whose secret is a parameter name, and no more of them than that', () => {
    const named = CASES.filter((c) => c.secretIsAName)
    // Few, and each is the shape the spec names: an unencoded `&` or `;`
    // before the secret in its value, and an `=` after it.
    expect(named.length).toBeLessThan(CASES.length / 10)
    for (const c of named) {
      expect(c.url, `#${c.n}`).toMatch(new RegExp(`[&;][^&;=]*SECRETTOKEN${c.n}[^&;=]*=`))
      // Its value, if any, still goes.
      const line = shapes(c).forbidden
      expect(redactUrls(line)).toMatch(
        new RegExp(`SECRETTOKEN${c.n}[^&;=#]*=(?:<redacted>)?(?:[&;#]|$)`),
      )
    }
  })
})
