import { describe, expect, it } from 'vitest'
import { badCall, redactShape, toShape } from '../../src/main/ipc-shape'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import { inUseSentence } from '../../src/main/feeds-ipc'

// The one door an error goes through on its way to the page (issue 207).
// Until v0.10.1 the engine named a failed download's whole URL in its
// error: `FeedError("{url} could not be fetched: {exc}")`, which the serve
// loop makes the message, the hint and the head of the detail. These are
// the engine's sentences as they were then, with a key in the query. The
// engine redacts a person's feed at source now (engine issue 32); this
// door stays, for an older engine's sentence and for anyone else's.

const URL_WITH_KEY = 'https://feeds.example.org/gtfs.zip?api_key=s3cret'
const SECRET = 's3cret'

const feedFailure = (): EngineError =>
  new EngineError(-32000, `${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden`, {
    kind: 'feed',
    hint: `${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden`,
    detail: `FeedError: ${URL_WITH_KEY} could not be fetched: HTTP Error 403: Forbidden (feeds.py:583)`,
  })

describe('an error on its way to the page', () => {
  it('carries no key in its message, its hint or its detail', () => {
    const shape = toShape(feedFailure())
    expect(shape.message).not.toContain(SECRET)
    expect(shape.data?.hint).not.toContain(SECRET)
    expect(shape.data?.detail).not.toContain(SECRET)
    // Redacted, not removed: the host and the path are what a person needs
    // to recognise which feed failed.
    expect(shape.data?.hint).toBe(
      'https://feeds.example.org/gtfs.zip?api_key=<redacted> could not be fetched: HTTP Error 403: Forbidden',
    )
  })

  it('keeps the code and the kind', () => {
    const shape = toShape(feedFailure())
    expect(shape.code).toBe(-32000)
    expect(shape.data?.kind).toBe('feed')
  })

  it('redacts an error that is not the engine’s, too', () => {
    const shape = toShape(new Error(`fetch failed for ${URL_WITH_KEY}`))
    expect(shape).toEqual({
      code: -32603,
      message: 'fetch failed for https://feeds.example.org/gtfs.zip?api_key=<redacted>',
    })
  })

  it('redacts user information and a fragment as the logs do', () => {
    const shape = toShape(
      new EngineError(-32000, 'x', {
        kind: 'feed',
        hint: 'https://me:pw@feeds.example.org/g.zip#tok did not return a zip (12 bytes)',
        detail: 'd',
      }),
    )
    expect(shape.data?.hint).toBe(
      'https://<redacted>@feeds.example.org/g.zip#<redacted> did not return a zip (12 bytes)',
    )
  })

  it('redacts the app’s own refusals on the same way out', () => {
    const answer = badCall(`nothing may be fetched from ${URL_WITH_KEY}`)
    expect(answer.accepted).toBe(false)
    const error = (answer as { error: ReturnType<typeof toShape> }).error
    for (const text of [error.message, error.data?.hint, error.data?.detail])
      expect(text).not.toContain(SECRET)
  })

  it('changes nothing at all in text with no ? # @ or %', () => {
    const plain = new EngineError(ERROR_CODES.badCall, 'a feed needs a source', {
      kind: 'params',
      hint: 'a feed needs a source',
      detail: 'the layout stage failed (topo.py:12)',
    })
    expect(toShape(plain)).toEqual(plain.toJSON())
  })

  it('leaves the error it was given as it was, for the log', () => {
    const error = feedFailure()
    redactShape(error.toJSON())
    toShape(error)
    expect(error.message).toContain(SECRET)
    expect(error.data?.hint).toContain(SECRET)
  })
})

describe('a person’s own text in a refusal', () => {
  it('comes through the page’s redaction whole, a project named like a path with a query included', () => {
    // Review of A5.6-06: a name quoted with curly quotes read as a path
    // whose query was the closing quote.
    const sentence = inUseSentence(['24/7?'])
    const answer = badCall(sentence)
    const error = (answer as { error: ReturnType<typeof toShape> }).error
    expect(error.data?.hint).toBe(sentence)
    expect(error.message).toBe(sentence)
  })
})
