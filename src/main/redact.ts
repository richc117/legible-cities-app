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
// What is covered, word by word through the text:
//
// - an `http` or `https` address, its slashes plain or escaped (`https:\/\/`)
//   and its host a name or an IPv6 literal (`[2001:db8::1]`): the user
//   information, every query value (after `?`, `&` or `;`), a query part
//   with no name, and the fragment;
// - the same address percent-encoded (`https%3A%2F%2F…`), up to a raw `&`,
//   decoded leniently so a stray `%` does not hide it;
// - a path with a query and no scheme, which is how urllib3 words a failed
//   connection (`Max retries exceeded with url: /gtfs.zip?api_key=…`) and
//   `requests` repeats it: each `name=` is kept and its value replaced.
//
// Not covered: a token carried as a path segment (`/feeds/<token>/gtfs.zip`),
// because nothing in the text says which segment is a secret; a query on a
// word with no `/` before its `?`; and a secret split across two words.
//
// The text is cut into words at spaces, quotes, parentheses and braces, and
// each word is looked at once, so the work is linear in the text however a
// line is shaped. The result is stable under a second pass: the marker
// holds characters that end a word, so redacting twice changes nothing.

/** What a secret is replaced with. */
export const REDACTED = '<redacted>'

/** A word: what sits between spaces, quotes, parentheses, braces and the marker's angle brackets. */
const WORD = /[^\s'"<>(){}^`|]+/g

/** The start of an address, its slashes plain or escaped as JSON escapes them. */
const PLAIN_SCHEME = /https?:(?:\/\/|\\\/\\\/)/i

/** The start of a percent-encoded address. */
const ENCODED_SCHEME = /https?%3A%2F%2F/i

/** Nothing to redact can be in a line without one of these, and most lines have none. */
const MIGHT_HAVE_SECRET = /[?#@%;&]/

/** What may close a sentence or a bracket after an address, and is not part of it. */
const TRAILING = new Set(["'", '"', ')', ']', '.', ','])

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
 * A query, without its `?` and without a fragment: each value after `name=`
 * replaced, separators kept. A part with no `=` has no name to keep and may
 * be the secret itself, so in an address it is replaced whole; in a path
 * without a scheme, where a `?` is likelier to be prose, it is kept.
 */
function redactQuery(query: string, bare: boolean): string {
  return query
    .split(/([&;])/)
    .map((part, i) => {
      if (i % 2 === 1 || part === '') return part
      const equals = part.indexOf('=')
      if (equals < 0) return bare ? REDACTED : part
      return equals === part.length - 1 ? part : `${part.slice(0, equals + 1)}${REDACTED}`
    })
    .join('')
}

/** One address from its scheme to the end of its word, with its secrets replaced. */
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
    query = `?${redactQuery(rest.slice(mark + 1), true)}`
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

/** One word, its trailing punctuation already set aside. */
function redactWord(word: string): string {
  const plain = word.search(PLAIN_SCHEME)
  const encoded = word.search(ENCODED_SCHEME)
  const mark = word.indexOf('?')
  const slash = word.indexOf('/')

  // A path with a query that comes before any address in the word: every
  // value of that query goes, an address inside one included.
  const pathQuery =
    mark >= 0 &&
    slash >= 0 &&
    slash < mark &&
    (plain < 0 || mark < plain) &&
    (encoded < 0 || mark < encoded)
  if (pathQuery) {
    const hash = word.indexOf('#', mark)
    const end = hash >= 0 ? hash : word.length
    return word.slice(0, mark + 1) + redactQuery(word.slice(mark + 1, end), false) + word.slice(end)
  }

  if (plain >= 0 && (encoded < 0 || plain < encoded)) {
    return word.slice(0, plain) + redactAddress(word.slice(plain))
  }

  if (encoded >= 0) {
    // An encoded address ends at a raw `&`: what follows is the next part
    // of whatever carried it, and is looked at on its own.
    const amp = word.indexOf('&', encoded)
    const end = amp >= 0 ? amp : word.length
    return (
      word.slice(0, encoded) +
      redactEncoded(word.slice(encoded, end)) +
      (end < word.length ? redactWord(word.slice(end)) : '')
    )
  }

  return word
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
  return text.replace(WORD, (match) => {
    // Trailing punctuation is set aside by walking back from the end, never
    // by a pattern anchored at the end, which backtracks on a long run.
    let end = match.length
    while (end > 0 && TRAILING.has(match[end - 1])) end -= 1
    if (end === 0) return match
    return redactWord(match.slice(0, end)) + match.slice(end)
  })
}
