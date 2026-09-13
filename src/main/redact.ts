// Web addresses with their secrets taken out, before a line is written to a
// log and again before a copy is made (A6-03, specs/023-logs-and-diagnostics).
//
// A feed can be added from a URL, and a URL can carry a key: in its query
// (`?api_key=…`), in its user information (`https://user:pass@host`) or in
// its fragment. The engine prints the whole URL when a download fails, with
// a traceback, on the stderr the supervisor logs (engine issue 32 redacts
// it at source); this is the app's own guard. It keeps what a bug report
// needs - the scheme, the host, the path and the names of the query's
// parameters - and replaces the rest with a marker.
//
// What is covered, run by run of text between whitespace:
//
// - an `http` or `https` address, its slashes plain or escaped (`https:\/\/`)
//   and its host a name or an IPv6 literal (`[2001:db8::1]`): the user
//   information, every query value (after `?`, `&` or `;`), a query part
//   with no name, and the fragment;
// - the same address percent-encoded (`https%3A%2F%2F…`), up to a raw `&`,
//   decoded leniently so a stray `%` does not hide it;
// - a path with a query and no scheme, or an `http(s)` one, which is how
//   urllib3 words a failed connection (`Max retries exceeded with url:
//   /gtfs.zip?api_key=…`) and `requests` repeats it: each `name=` is kept
//   and its value replaced, and a part with no name replaced whole.
//
// An address runs to the next whitespace, whatever it holds: the engine
// prints a URL as it was given, and urllib3 leaves quotes and parentheses
// unencoded, so a query like `?$where=route='A'&$$app_token=…` or
// `?filter=(rail)&key=…` is one address, not several words. Only closing
// punctuation at its very end - `'")]>},.` - is set aside, which is what
// lets a URL sit inside `{'url': '…'}` or a sentence.
//
// Not covered: a token carried as a path segment (`/feeds/<token>/gtfs.zip`),
// because nothing in the text says which segment is a secret; a secret in
// a parameter's name position, where a value before it holds an unencoded
// `&` or `;` and an `=` follows it (`?key=a&SECRET=1`), which a server reads
// as a name too; a query on a run with no `/` before its `?`; a URL with
// whitespace inside it; and a secret split across two runs.
//
// Every run is looked at once, and the percent-encoded addresses in a run
// are walked with a cursor, so the work is linear in the text however a
// line is shaped. The result is stable under a second pass: whatever is
// replaced becomes the same marker, so redacting twice changes nothing.

/** What a secret is replaced with. */
export const REDACTED = '<redacted>'

/** A run of text between whitespace. */
const RUN = /\S+/g

/** The start of an address, its slashes plain or escaped as JSON escapes them. */
const PLAIN_SCHEME = /https?:(?:\/\/|\\\/\\\/)/i

/** The start of a percent-encoded address; global, so a cursor can search from a position. */
const ENCODED_SCHEME = /https?%3A%2F%2F/gi

/**
 * The scheme of the first address in the text, if any, read back from its
 * `://` - to tell `app://local/…?theme=dark` from a web address. A walk, not
 * a pattern: a pattern for a scheme backtracks on a long run of letters.
 */
function firstScheme(text: string): string | null {
  const plain = text.indexOf('://')
  const escaped = text.indexOf(':\\/\\/')
  const at = plain < 0 ? escaped : escaped < 0 ? plain : Math.min(plain, escaped)
  if (at < 0) return null
  let start = at
  while (start > 0 && /[A-Za-z0-9+.-]/.test(text[start - 1])) start -= 1
  return text.slice(start, at)
}

/** Nothing to redact can be in a line without one of these, and most lines have none. */
const MIGHT_HAVE_SECRET = /[?#@%]/

/** What may close a sentence, a quotation or a bracket after an address, and is not part of it. */
const TRAILING = new Set(["'", '"', ')', ']', '>', '}', '.', ','])

/**
 * Every run of percent-escapes decoded where it decodes, escape by escape
 * where the run as a whole does not (a truncated `%E2`), and a stray `%`
 * left as it is. Never throws.
 */
export function lenientDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run.replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
        try {
          return decodeURIComponent(escape)
        } catch {
          return escape
        }
      })
    }
  })
}

/**
 * A query, without its `?` and without a fragment: every value replaced, and
 * every part with no name or only `=` padding after its first `=` replaced
 * whole.
 */
function redactQuery(query: string): string {
  return query
    .split(/([&;])/)
    .map((part, i) => {
      if (i % 2 === 1 || part === '') return part
      const equals = part.indexOf('=')
      // No name, or a name that is only a padded token (`QUJDRA==`): all of it goes.
      if (equals < 0 || /^=+$/.test(part.slice(equals + 1))) return REDACTED
      return equals === part.length - 1 ? part : `${part.slice(0, equals + 1)}${REDACTED}`
    })
    .join('')
}

/** One address from its scheme to the end of its run, with its secrets replaced. */
function redactAddress(url: string): string {
  const scheme = PLAIN_SCHEME.exec(url)?.[0] ?? ''
  let rest = url.slice(scheme.length)

  let fragment = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = hash === rest.length - 1 ? '#' : `#${REDACTED}`
    rest = rest.slice(0, hash)
  }

  let query = ''
  const mark = rest.indexOf('?')
  if (mark >= 0) {
    query = `?${redactQuery(rest.slice(mark + 1))}`
    rest = rest.slice(0, mark)
  }

  // The authority ends at the first slash, plain or escaped.
  const slash = rest.search(/[\\/]/)
  let authority = slash >= 0 ? rest.slice(0, slash) : rest
  const path = slash >= 0 ? rest.slice(slash) : ''
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = `${REDACTED}@${authority.slice(at + 1)}`

  return scheme + authority + path + query + fragment
}

/** A percent-encoded address, re-encoded after redaction with the marker left readable. */
function redactEncoded(encoded: string): string {
  const decoded = lenientDecode(encoded)
  const redacted = redactAddress(decoded)
  if (redacted === decoded) return encoded
  return encodeURIComponent(redacted).split(encodeURIComponent(REDACTED)).join(REDACTED)
}

/** The percent-encoded addresses in a run, each up to a raw `&`, walked with a cursor. */
function redactEncodedRun(run: string, from: number): string {
  let out = run.slice(0, from)
  let cursor = from
  while (cursor < run.length) {
    ENCODED_SCHEME.lastIndex = cursor
    const found = ENCODED_SCHEME.exec(run)
    if (found === null) break
    const start = found.index
    const amp = run.indexOf('&', start)
    const end = amp >= 0 ? amp : run.length
    out += run.slice(cursor, start) + redactEncoded(run.slice(start, end))
    cursor = end
  }
  return out + run.slice(cursor)
}

/** One run of text, its closing punctuation already set aside. */
function redactRun(run: string): string {
  const plain = run.search(PLAIN_SCHEME)
  ENCODED_SCHEME.lastIndex = 0
  const encoded = ENCODED_SCHEME.exec(run)?.index ?? -1
  const mark = run.indexOf('?')
  const slash = run.indexOf('/')

  // A path with a query that comes before any address in the run: every
  // value of that query goes, an address inside one included. Not for a
  // scheme other than the web's own: `app://local/ui/?theme=dark` is the
  // app's, and its values are not secrets.
  if (mark >= 0 && slash >= 0 && slash < mark) {
    const scheme = firstScheme(run.slice(0, mark))
    // Every scheme but the app's own: requests names an ftp:// or s3://
    // redirect in full when it refuses one.
    const web = scheme?.toLowerCase() !== 'app'
    const addressFirst = (plain >= 0 && plain < mark) || (encoded >= 0 && encoded < mark)
    if (web && !addressFirst) {
      const hash = run.indexOf('#', mark)
      const end = hash >= 0 ? hash : run.length
      return run.slice(0, mark + 1) + redactQuery(run.slice(mark + 1, end)) + run.slice(end)
    }
  }

  if (plain >= 0 && (encoded < 0 || plain < encoded)) {
    return run.slice(0, plain) + redactAddress(run.slice(plain))
  }
  if (encoded >= 0) return redactEncodedRun(run, encoded)
  return run
}

/**
 * Every web address in the text with its user information, its query
 * values and its fragment replaced by `<redacted>`, and every value of a
 * query on a path with no scheme; see the top of this file for exactly
 * what is and is not covered. Text with nothing to redact comes back as it
 * was.
 */
export function redactUrls(text: string): string {
  if (!MIGHT_HAVE_SECRET.test(text)) return text
  return text.replace(RUN, (match) => {
    // Closing punctuation is set aside by walking back from the end, never
    // by a pattern anchored at the end, which backtracks on a long run. A
    // marker already at the end keeps its `>`, or a second pass would
    // take it for punctuation and redact the rest of the marker again.
    let end = match.length
    while (end > 0 && TRAILING.has(match[end - 1])) {
      if (match[end - 1] === '>' && match.endsWith(REDACTED, end)) break
      end -= 1
    }
    if (end === 0) return match
    return redactRun(match.slice(0, end)) + match.slice(end)
  })
}
