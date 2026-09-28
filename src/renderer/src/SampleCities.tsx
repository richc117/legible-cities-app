import type { JSX } from 'react'
import type { FeedRecord } from '../../shared/protocol'
import { placeOf } from './FeedList'

// The sample cities (A5.6-02): every preset the engine's registry holds,
// drawn as a card on the front door before anything is downloaded.
//
// Every fact on a card comes from `feeds.list` alone - the name, where it
// runs, what the mode keeps and whether the feed is on this machine yet.
// Nothing richer: a route count, a station count or a thumbnail of the map
// would mean downloading twenty-two feeds at start, which is the opposite
// of what the milestone decided (ADR-045). If the cards read thin, that is
// an engine issue to put counts in the registry, not a reason to prefetch.
//
// One fact the issue names is not here: whether a feed publishes headways
// rather than a timetable. The registry has no field for it; the engine at
// the pin says so only in prose, in one preset's notes. A card that
// searched those sentences for "headways" would be the app asserting what
// the engine does not (constitution II).
//
// A card is one button, whose accessible name is what it shows, in the
// order it shows it (WCAG 2.5.3). Until A5.6-03 makes a press open the
// sample, a press starts a project on it, as "Start a project" did.

/** The section's heading, focusable: where focus goes when the last added feed's row took it. */
export const SAMPLES_HEADING_ID = 'samples-heading'

/**
 * What a mode keeps, in words: the engine's own mode names, which are
 * words already, joined as a sentence would join them. "all" is every
 * mode; an empty mode is the registry saying nothing, and a card says
 * nothing about it either.
 */
export function modeWords(mode: string): string | null {
  const parts = mode
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return null
  if (parts.includes('all')) return 'keeps every mode'
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `keeps ${list}`
}

/** A card's facts after its name, in the order it draws them. */
export function sampleFacts(feed: FeedRecord): string[] {
  const facts: string[] = []
  const place = placeOf(feed)
  if (place !== null) facts.push(place)
  const keeps = modeWords(feed.mode)
  if (keeps !== null) facts.push(keeps)
  facts.push(feed.cached ? 'downloaded' : 'not downloaded yet')
  return facts
}

/** The card's accessible name: its name and every fact, as it reads. */
export function sampleName(feed: FeedRecord): string {
  return [feed.name, ...sampleFacts(feed)].join(', ')
}

interface Props {
  presets: FeedRecord[]
  /**
   * What the region says when there are no presets to draw, or null to say
   * nothing - the front door knows which of its reasons it is.
   */
  sentence: string | null
  onOpen: (feed: FeedRecord) => void
}

export default function SampleCities({ presets, sentence, onOpen }: Props): JSX.Element {
  return (
    <section className="front-door-region" aria-labelledby={SAMPLES_HEADING_ID}>
      <h2 id={SAMPLES_HEADING_ID} tabIndex={-1}>
        Sample cities
      </h2>
      {presets.length === 0 ? (
        sentence !== null && <p className="prose">{sentence}</p>
      ) : (
        <ul className="sample-cards" aria-label="Presets">
          {presets.map((feed) => (
            <li key={feed.key} aria-label={feed.name}>
              <button
                type="button"
                className="sample-card"
                aria-label={sampleName(feed)}
                onClick={() => onOpen(feed)}
              >
                <span className="sample-card-name">{feed.name}</span>
                {sampleFacts(feed).map((fact) => (
                  <span key={fact} className="sample-card-fact">
                    {fact}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
