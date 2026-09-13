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
// Not handled: a token that is a path segment (`/feeds/<token>/gtfs.zip`).
// Nothing in the text says which segment is a secret, and guessing from how
// random a segment looks would redact ordinary names and miss short keys.
//
// A regular expression rather than `new URL()`, because the addresses sit
// inside quotes, parentheses and Python `repr` output, and a parser wants
// them clean. The result is stable under a second pass: the marker holds
// characters no match can contain, so redacting twice changes nothing.

/** What a secret is replaced with. */
export const REDACTED = '<redacted>'

/** An address as it appears in running text: no space, quote, bracket, backslash or marker character. */
const PLAIN_URL = /https?:\/\/[^\s'"<>()[\]{}\\^`|]+/gi

/** The same, percent-encoded as a query value would carry it: `https%3A%2F%2F…`. */
const ENCODED_URL = /https?%3A%2F%2F[^\s'"<>()[\]{}\\^`|]+/gi

/** What may close a sentence or a quotation after an address, and is not part of it. */
const TRAILING = /['")\].,]+$/

/** A cheap look before the expressions run, since every line of a LOOM burst comes through here. */
const MIGHT_HAVE_URL = /https?(?::|%3A)/i

/** One address, already trimmed, with its user information, query values and fragment replaced. */
function redactOne(url: string): string {
  const schemeEnd = url.indexOf('://') + 3
  const scheme = url.slice(0, schemeEnd)
  let rest = url.slice(schemeEnd)

  let fragment = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = rest.slice(hash + 1) === '' ? '#' : `#${REDACTED}`
    rest = rest.slice(0, hash)
  }

  let query = ''
  const mark = rest.indexOf('?')
  if (mark >= 0) {
    query =
      '?' +
      rest
        .slice(mark + 1)
        .split('&')
        .map((part) => {
          const equals = part.indexOf('=')
          // A part with no `=` has no name to keep; all of it may be the secret.
          if (equals < 0) return part === '' ? '' : REDACTED
          const value = part.slice(equals + 1)
          return value === '' ? part : `${part.slice(0, equals)}=${REDACTED}`
        })
        .join('&')
    rest = rest.slice(0, mark)
  }

  const slash = rest.indexOf('/')
  let authority = slash >= 0 ? rest.slice(0, slash) : rest
  const path = slash >= 0 ? rest.slice(slash) : ''
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = `${REDACTED}@${authority.slice(at + 1)}`

  return scheme + authority + path + query + fragment
}

/** Redact a match, leaving what trails it - a full stop, a closing quote - where it was. */
function redactMatch(match: string): string {
  const trailing = TRAILING.exec(match)?.[0] ?? ''
  const url = match.slice(0, match.length - trailing.length)
  return redactOne(url) + trailing
}

/**
 * Every `http` and `https` address in the text with its user information,
 * its query values and its fragment replaced by `<redacted>`, plain or
 * percent-encoded. An address with none of those is left exactly as it was.
 */
export function redactUrls(text: string): string {
  if (!MIGHT_HAVE_URL.test(text)) return text
  const plain = text.replace(PLAIN_URL, redactMatch)
  return plain.replace(ENCODED_URL, (match) => {
    const trailing = TRAILING.exec(match)?.[0] ?? ''
    const encoded = match.slice(0, match.length - trailing.length)
    let decoded: string
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      return match
    }
    const redacted = redactOne(decoded)
    if (redacted === decoded) return match
    // Encoded again as it was found, with the marker left readable.
    return (
      encodeURIComponent(redacted).split(encodeURIComponent(REDACTED)).join(REDACTED) + trailing
    )
  })
}
