import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import Library, {
  INTRODUCTION,
  SAMPLES_AWAY,
  SAMPLES_NONE,
  SAMPLES_UNREAD,
  samplesSentence,
} from '../../src/renderer/src/Library'
import SampleCities, {
  modeWords,
  sampleFacts,
  sampleName,
} from '../../src/renderer/src/SampleCities'
import type { FeedRecord } from '../../src/shared/protocol'

// The screen's run helpers reach for the bridge when they are made. A
// static render runs no effect, so nothing is asked of it; every property is
// a function that answers nothing, which is all a constructor can touch.
beforeAll(() => {
  const nothing: unknown = new Proxy(() => undefined, {
    get: () => nothing,
    apply: () => undefined,
  })
  vi.stubGlobal('window', { api: nothing })
})

describe('the front door', () => {
  it('draws the sentence a delete could not fully carry out, whatever else it holds', () => {
    const notice = 'The project was deleted, but its folder could not be removed: in use.'
    const html = renderToStaticMarkup(<Library notice={notice} onOpen={() => undefined} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain(notice)
  })

  it('has one first-level heading', () => {
    const html = renderToStaticMarkup(<Library notice={null} onOpen={() => undefined} />)
    expect(html.match(/<h1\b/g)).toHaveLength(1)
  })

  it('introduces the app in one sentence', () => {
    expect(INTRODUCTION.match(/[.!?](\s|$)/g)).toHaveLength(1)
  })
})

describe('what the samples region says when it has no presets to draw', () => {
  it('says the engine is not ready only when it is not', () => {
    expect(samplesSentence(false, 'unread')).toBe(SAMPLES_AWAY)
    expect(samplesSentence(false, 'listed')).toBe(SAMPLES_AWAY)
  })

  it('says nothing while the first read is on its way', () => {
    expect(samplesSentence(true, 'unread')).toBeNull()
  })

  it('says the read failed when it did, and that there are none when there are none', () => {
    expect(samplesSentence(true, 'failed')).toBe(SAMPLES_UNREAD)
    expect(samplesSentence(true, 'listed')).toBe(SAMPLES_NONE)
  })
})

describe('a sample city’s card', () => {
  const feed = (patch: Partial<FeedRecord> = {}): FeedRecord => ({
    key: 'la-metro-rail',
    name: 'LA Metro Rail',
    city: 'Los Angeles',
    network: 'Metro Rail',
    url: 'https://example.org/gtfs.zip',
    mode: 'all',
    label_pattern: null,
    label_strip: null,
    agency: null,
    geographic: true,
    notes: [],
    headways: false,
    source: 'preset',
    cached: false,
    ...patch,
  })

  it('says what the mode keeps in the engine’s own words', () => {
    expect(modeWords('all')).toBe('keeps every mode')
    expect(modeWords('subway')).toBe('keeps subway')
    expect(modeWords('tram,rail')).toBe('keeps tram and rail')
    expect(modeWords('tram,subway,rail')).toBe('keeps tram, subway and rail')
    expect(modeWords('')).toBeNull()
  })

  it('carries its facts in the order it draws them, from the registry alone', () => {
    expect(sampleFacts(feed())).toEqual([
      'Los Angeles · Metro Rail',
      'keeps every mode',
      'not downloaded yet',
    ])
    expect(sampleFacts(feed({ cached: true, city: '', network: '', mode: '' }))).toEqual([
      'downloaded',
    ])
  })

  it('is named by what it shows', () => {
    expect(sampleName(feed({ mode: 'tram,rail', cached: true }))).toBe(
      'LA Metro Rail, Los Angeles · Metro Rail, keeps tram and rail, downloaded',
    )
  })

  it('is one button in a list, and says nothing it was not told', () => {
    const html = renderToStaticMarkup(
      <SampleCities
        presets={[feed(), feed({ key: 'b', name: 'B' })]}
        sentence="x"
        onOpen={() => undefined}
      />,
    )
    expect(html.match(/<button\b/g)).toHaveLength(2)
    expect(html).toContain('<ul class="sample-cards" aria-label="Presets">')
    expect(html).not.toContain('x</p>')
  })
})
