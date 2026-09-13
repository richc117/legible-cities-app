// A feed's URL with its secrets taken out (A6-03): what a bug report keeps -
// the scheme, the host, the path and the query's parameter names - and what
// it loses, however the engine or Python happened to print the address.
// Every host here is a documentation name (RFC 2606), never a real feed.

import { describe, expect, it } from 'vitest'
import { REDACTED, redactUrls } from '../../src/main/redact'

describe('a URL in a log line', () => {
  it('keeps an address with no query, user or fragment exactly as it was', () => {
    const line = '[engine] pinned https://example.com/x/y/v0.8.2 (tag)'
    expect(redactUrls(line)).toBe(line)
    expect(redactUrls('no address at all')).toBe('no address at all')
  })

  it('replaces the user information', () => {
    expect(redactUrls('from https://someone:pw@feeds.example.org/gtfs.zip')).toBe(
      `from https://${REDACTED}@feeds.example.org/gtfs.zip`,
    )
  })

  it('keeps every parameter name and replaces every value', () => {
    expect(
      redactUrls('https://api.example.net/feed.zip?api_key=abc123&format=gtfs&empty=&token=x'),
    ).toBe(
      `https://api.example.net/feed.zip?api_key=${REDACTED}&format=${REDACTED}&empty=&token=${REDACTED}`,
    )
  })

  it('replaces a query part with no name, which may be the secret itself', () => {
    expect(redactUrls('http://example.com/f.zip?s3cr3t')).toBe(
      `http://example.com/f.zip?${REDACTED}`,
    )
  })

  it('replaces a fragment', () => {
    expect(redactUrls('see https://example.com/feed#access_token=zzz')).toBe(
      `see https://example.com/feed#${REDACTED}`,
    )
  })

  it("finds an address in Python's single quotes and in parentheses", () => {
    expect(redactUrls("FeedError('https://example.org/g.zip?key=k1')")).toBe(
      `FeedError('https://example.org/g.zip?key=${REDACTED}')`,
    )
    expect(redactUrls('(https://example.org/g.zip?key=k1)')).toBe(
      `(https://example.org/g.zip?key=${REDACTED})`,
    )
  })

  it('leaves a full stop that ends the sentence outside the address', () => {
    expect(redactUrls('could not be fetched: https://example.org/g.zip?key=k1.')).toBe(
      `could not be fetched: https://example.org/g.zip?key=${REDACTED}.`,
    )
    expect(redactUrls('at https://example.org/g.zip, then')).toBe(
      'at https://example.org/g.zip, then',
    )
  })

  it("redacts the requests library's own sentence, which repeats the address", () => {
    const line =
      '[engine] stderr: schematic.feeds.FeedError: https://example.org/g.zip?key=k1 could not be fetched: ' +
      '403 Client Error: Forbidden for url: https://example.org/g.zip?key=k1'
    const out = redactUrls(line)
    expect(out).not.toContain('k1')
    expect(out).toContain(`for url: https://example.org/g.zip?key=${REDACTED}`)
  })

  it('redacts an address percent-encoded inside another, or on its own', () => {
    const inner = encodeURIComponent('https://example.org/g.zip?key=k1&v=2')
    const alone = `redirected to ${inner}`
    const out = redactUrls(alone)
    expect(out).not.toContain('k1')
    expect(decodeURIComponent(out.replace(/<redacted>/g, 'R'))).toBe(
      'redirected to https://example.org/g.zip?key=R&v=R',
    )
    // Inside a plain address, the value it sits in is redacted whole.
    expect(redactUrls(`https://example.com/go?next=${inner}`)).toBe(
      `https://example.com/go?next=${REDACTED}`,
    )
    // An encoded address with nothing to hide is left as it was.
    const clean = encodeURIComponent('https://example.org/g.zip')
    expect(redactUrls(clean)).toBe(clean)
  })

  it('changes nothing on a second pass', () => {
    const lines = [
      'https://someone:pw@example.org/a?x=1&y#frag',
      `get ${encodeURIComponent('https://example.org/a?key=1#f')}.`,
      'http://example.org/?only',
    ]
    for (const line of lines) {
      const once = redactUrls(line)
      expect(redactUrls(once), line).toBe(once)
    }
  })
})
