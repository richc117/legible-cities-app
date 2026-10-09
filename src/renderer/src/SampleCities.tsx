import type { JSX } from 'react'
import type { FeedRecord } from '../../shared/protocol'
import Card from './Card'
import { placeOf } from './FeedList'

// The sample cities (A5.6-02): every preset the engine's registry holds,
// drawn as a card on the front door before anything is downloaded. Since
// ADR-047 a sample's card is the front door's one kind of card (`Card.tsx`),
// in the same grid as the projects'.
//
// Every fact on a card comes from `feeds.list` alone - the name, where it
// runs and whether the feed is on this machine yet. Nothing richer: a route
// count or a station count would mean downloading twenty-two feeds at start,
// which is the opposite of what the milestone decided (ADR-045). If the
// cards read thin, that is an engine issue to put counts in the registry,
// not a reason to prefetch. A picture of each city is the engine's, made by
// a script at the pinned LOOM and shipped with the app (ADR-047); until those
// files exist the picture area is drawn empty, and drawing a card still asks
// the engine for nothing but the list.
//
// What the mode keeps is not on the card (ADR-047): it is configuration, and
// the project's cell 01 shows it as soon as the card is pressed. Nor is
// whether a feed publishes headways rather than a timetable: the registry
// has no field for it, and a card that searched a preset's notes for
// "headways" would be the app asserting what the engine does not
// (constitution II).
//
// A card is one button, whose accessible name is what it shows, in the
// order it shows it (WCAG 2.5.3). A press opens the sample (A5.6-03): the
// front door makes the project and opens its notebook with the layout
// already starting.

/** The section's heading, focusable: where focus goes when the last added feed's row took it. */
export const SAMPLES_HEADING_ID = 'samples-heading'

/** Whether the feed is on this machine yet: the card's chip. */
export function sampleStatus(feed: FeedRecord): string {
  return feed.cached ? 'downloaded' : 'not downloaded yet'
}

/** A card's facts after its name, in the order it draws them: where it runs, then its chip. */
export function sampleFacts(feed: FeedRecord): string[] {
  const facts: string[] = []
  const place = placeOf(feed)
  if (place !== null) facts.push(place)
  facts.push(sampleStatus(feed))
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
        <ul className="cards" aria-label="Presets">
          {presets.map((feed) => {
            const place = placeOf(feed)
            return (
              <li key={feed.key} aria-label={feed.name}>
                <Card
                  name={feed.name}
                  facts={place === null ? [] : [place]}
                  chip={sampleStatus(feed)}
                  label={sampleName(feed)}
                  onClick={() => onOpen(feed)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
