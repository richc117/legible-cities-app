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

  it('redacts an IPv6 literal host, escaped slashes, and a value after &', () => {
    expect(redactUrls('http://[2001:db8::1]/g.zip?key=S3')).toBe(
      `http://[2001:db8::1]/g.zip?key=${REDACTED}`,
    )
    expect(redactUrls('{"url": "https:\\/\\/example.org\\/g.zip?key=S3"}')).toBe(
      `{"url": "https:\\/\\/example.org\\/g.zip?key=${REDACTED}"}`,
    )
    expect(redactUrls('https://example.org/g.zip?a=1&key=S3;v=2')).toBe(
      `https://example.org/g.zip?a=${REDACTED}&key=${REDACTED};v=${REDACTED}`,
    )
  })
})

// urllib3 words a failed connection with the path and query and no scheme,
// and requests repeats that sentence; this is the most common way a
// download fails (no network, a name that does not resolve, a proxy).
describe('a path with a query and no scheme', () => {
  it("redacts urllib3's sentence as it is printed", () => {
    const sentence =
      "HTTPSConnectionPool(host='feeds.example.org', port=443): Max retries exceeded with url: /gtfs.zip?api_key=SECRET (Caused by NameResolutionError(\"<urllib3.connection.HTTPSConnection object at 0x10a2b3c40>: Failed to resolve 'feeds.example.org' ([Errno 8] nodename nor servname provided, or not known)\"))"
    const out = redactUrls(sentence)
    expect(out).not.toContain('SECRET')
    expect(out).toBe(sentence.replace('api_key=SECRET', `api_key=${REDACTED}`))
  })

  it('redacts every line of a traceback that chains MaxRetryError into ConnectionError', () => {
    const pool =
      "HTTPSConnectionPool(host='feeds.example.org', port=443): Max retries exceeded with url: /gtfs.zip?api_key=SECRET&format=gtfs (Caused by NameResolutionError(\"<urllib3.connection.HTTPSConnection object at 0x10a2b3c40>: Failed to resolve 'feeds.example.org'\"))"
    const traceback = [
      '[engine] stderr: 2026-09-12 10:00:00,000 ERROR schematic.serve: request 7 failed',
      '[engine] stderr: Traceback (most recent call last):',
      '[engine] stderr:   File "/srv/engine/.venv/lib/python3.12/site-packages/requests/adapters.py", line 667, in send',
      '[engine] stderr:     resp = conn.urlopen(',
      `[engine] stderr: urllib3.exceptions.MaxRetryError: ${pool}`,
      '[engine] stderr: During handling of the above exception, another exception occurred:',
      `[engine] stderr: requests.exceptions.ConnectionError: ${pool}`,
      '[engine] stderr: The above exception was the direct cause of the following exception:',
      `[engine] stderr: schematic.feeds.FeedError: https://feeds.example.org/gtfs.zip?api_key=SECRET&format=gtfs could not be fetched: ${pool}`,
    ]
    const out = traceback.map(redactUrls)
    expect(out.join('\n')).not.toContain('SECRET')
    expect(out.filter((l) => l.includes(`api_key=${REDACTED}&format=${REDACTED}`))).toHaveLength(3)
    expect(out[8]).toContain(`https://feeds.example.org/gtfs.zip?api_key=${REDACTED}&format=`)
    // Lines with nothing to hide are untouched.
    expect(out.slice(0, 4)).toEqual(traceback.slice(0, 4))
  })

  it('also redacts an HTTP request line, and keeps a question in prose', () => {
    expect(redactUrls('"GET /gtfs.zip?api_key=SECRET HTTP/1.1" 403')).toBe(
      `"GET /gtfs.zip?api_key=${REDACTED} HTTP/1.1" 403`,
    )
    expect(redactUrls('and/or? either way')).toBe('and/or? either way')
  })
})

describe('percent-encoding that does not decode', () => {
  it('still redacts what can be seen past a stray % or a truncated escape', () => {
    for (const tail of ['%', '%zz', '%E2']) {
      const line = `see ${encodeURIComponent('https://example.org/g.zip?key=SECRET')}${tail}`
      const out = redactUrls(line)
      expect(out, tail).not.toContain('SECRET')
      expect(out, tail).toContain(REDACTED)
    }
  })

  it('stops an encoded address at a raw &, leaving what follows as it was', () => {
    const inner = encodeURIComponent('https://example.org/g.zip?key=SECRET')
    const out = redactUrls(`${inner}&next=1`)
    expect(out).not.toContain('SECRET')
    expect(out.endsWith('&next=1')).toBe(true)
    expect(out).not.toContain('%26next')
  })
})

describe('a long line', () => {
  it('sets aside a long run of trailing punctuation in linear time', () => {
    for (const run of ['.'.repeat(30_000), ','.repeat(30_000), '.,'.repeat(15_000)]) {
      const line = `https://example.org/g.zip?key=SECRET${run}x ${run}`
      const started = performance.now()
      const out = redactUrls(line)
      expect(performance.now() - started).toBeLessThan(200)
      expect(out).not.toContain('SECRET')
    }
  })
})

// An address runs to the next whitespace: the engine prints a URL as it was
// given and urllib3 leaves quotes and parentheses unencoded, so a query that
// holds them is still one address.
describe('an address with quotes, parentheses or braces inside it', () => {
  const cases: [string, string][] = [
    ['Socrata', "https://data.example.org/resource/x.zip?$where=route='A'&$$app_token=SECRET"],
    ['a parenthesised filter', 'https://feeds.example.org/g.zip?filter=(rail)&key=SECRET'],
    ['a password with a parenthesis', 'https://user:pa(SECRET@feeds.example.org/g.zip'],
    ['a templated path', 'https://tiles.example.org/{z}/{x}.png?key=SECRET'],
  ]

  for (const [what, url] of cases) {
    it(`redacts ${what} inside the FeedError sentence`, () => {
      const line = `[engine] stderr: schematic.feeds.FeedError: ${url} could not be fetched: 403 Client Error: Forbidden for url: ${url}`
      const out = redactUrls(line)
      expect(out).not.toContain('SECRET')
      expect(redactUrls(out)).toBe(out)
    })

    it(`redacts ${what} in urllib3's with-url form`, () => {
      const pathQuery = url.replace(/^https:\/\/[^/]+/, '')
      const line = `HTTPSConnectionPool(host='feeds.example.org', port=443): Max retries exceeded with url: ${pathQuery} (Caused by NameResolutionError("<urllib3.connection.HTTPSConnection object at 0x10>: Failed to resolve 'feeds.example.org'"))`
      const out = redactUrls(line)
      expect(out).not.toContain('SECRET')
      expect(redactUrls(out)).toBe(out)
    })
  }

  it("keeps a leading quote and a closing brace outside the address, in Python's repr", () => {
    expect(redactUrls("{'url': 'https://example.org/g.zip?key=SECRET'}")).toBe(
      `{'url': 'https://example.org/g.zip?key=${REDACTED}'}`,
    )
  })

  it('redacts a query on a scheme requests refuses to fetch, as it names it', () => {
    for (const scheme of ['ftp', 's3']) {
      const line = `requests.exceptions.InvalidSchema: No connection adapters were found for '${scheme}://feeds.example.org/x.zip?token=SECRET'`
      const out = redactUrls(line)
      expect(out, scheme).not.toContain('SECRET')
      expect(out, scheme).toContain(`${scheme}://feeds.example.org/x.zip?token=${REDACTED}'`)
    }
  })

  it('replaces a bare padded token whole, first or later in the query', () => {
    expect(redactUrls('https://example.org/g.zip?QUJDRA==')).toBe(
      `https://example.org/g.zip?${REDACTED}`,
    )
    expect(redactUrls('https://example.org/g.zip?format=gtfs&dGVzdA==')).toBe(
      `https://example.org/g.zip?format=${REDACTED}&${REDACTED}`,
    )
    expect(redactUrls('with url: /g.zip?QUJDRA==&v=1')).toBe(
      `with url: /g.zip?${REDACTED}&v=${REDACTED}`,
    )
  })

  it("leaves the values of the app's own scheme alone", () => {
    const line = '[protocol] warning: refused app://local/projects/x/index.html?theme=dark&speed=2'
    expect(redactUrls(line)).toBe(line)
  })
})

describe('a long run of letters before a path query', () => {
  it('is read in linear time', () => {
    const line = `${'a'.repeat(60_000)}/x?key=SECRET ${'b'.repeat(60_000)}://`
    const started = performance.now()
    const out = redactUrls(line)
    expect(performance.now() - started).toBeLessThan(200)
    expect(out).not.toContain('SECRET')
  })
})

describe('a long run of percent-encoded addresses', () => {
  it('is walked in one pass, without running out of stack', () => {
    const line = 'https%3A%2F%2Fa&'.repeat(Math.ceil((256 * 1024) / 16))
    const started = performance.now()
    let out = ''
    expect(() => {
      out = redactUrls(line)
    }).not.toThrow()
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(out).toBe(line)
    const secret = `${'https%3A%2F%2Fa&'.repeat(10_000)}${encodeURIComponent('https://h/g?key=SECRET')}`
    expect(redactUrls(secret)).not.toContain('SECRET')
  })
})
