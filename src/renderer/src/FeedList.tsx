import type { JSX } from 'react'
import type { FeedRecord } from '../../shared/protocol'
import Icon from './icons/Icon'
import Button from './kit/Button'

// A group of the feeds the engine knows, on the front door (A5.6-01): the
// presets as the sample cities, and the feeds a person added as their own.
// Two sections of one shape, each a named region with its own heading,
// because the front door puts them in different places - the samples
// always, the added feeds only once there are any. A row is not a button
// here, since a feed has two things a person does with it; the row is
// named for a screen reader and its actions are text buttons (DESIGN.md
// 8.2, lists). A5.6-02 and A5.6-06 redraw each group in its own terms.

interface Props {
  feeds: FeedRecord[]
  /** The section's heading, and the id it is found by. */
  heading: string
  headingId: string
  /** The list's own name, which the rows are found by. */
  listName: string
  onNewProject: (feed: FeedRecord) => void
  onRemove: (feed: FeedRecord) => void
}

/** The added feeds' heading, focusable so the front door can hand focus to it when a removed row took it (A6-07). */
export const FEEDS_HEADING_ID = 'feeds-heading'

/** The sample cities' heading: where focus goes when the last added feed's row took it. */
export const SAMPLES_HEADING_ID = 'samples-heading'

/** What the row says about where a feed runs, when the registry knows. */
export function placeOf(feed: FeedRecord): string | null {
  const parts = [feed.city, feed.network].filter((p) => p !== '')
  return parts.length === 0 ? null : parts.join(' · ')
}

export default function FeedList({
  feeds,
  heading,
  headingId,
  listName,
  onNewProject,
  onRemove,
}: Props): JSX.Element {
  return (
    <section className="feeds" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        {heading}
      </h2>
      <ul className="entries" aria-label={listName}>
        {feeds.map((feed) => {
          const place = placeOf(feed)
          return (
            <li key={feed.key} className="entry feed" aria-label={feed.name}>
              <span className="entry-name">{feed.name}</span>
              <span className="entry-meta">
                {place !== null && <span>{place}</span>}
                <span>{feed.cached ? 'downloaded' : 'not downloaded yet'}</span>
              </span>
              <span className="feed-actions">
                <Button
                  onClick={() => onNewProject(feed)}
                  aria-label={`Start a project on ${feed.name}`}
                >
                  <Icon name="add" />
                  Start a project
                </Button>
                {feed.source === 'user' && (
                  <Button
                    variant="ghost"
                    onClick={() => onRemove(feed)}
                    aria-label={`Remove ${feed.name}`}
                  >
                    <Icon name="trash" />
                    Remove
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
