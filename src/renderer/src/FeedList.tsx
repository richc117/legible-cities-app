import type { JSX } from 'react'
import type { FeedRecord } from '../../shared/protocol'
import Icon from './icons/Icon'
import Button from './kit/Button'

// The feeds the engine knows, on the Library: the presets curated in the
// engine, then the ones a person added. A row is not a button here, since
// a feed has two things a person does with it; the row is named for a
// screen reader and its actions are text buttons (DESIGN.md 8.2, lists).

interface Props {
  feeds: FeedRecord[]
  onNewProject: (feed: FeedRecord) => void
  onRemove: (feed: FeedRecord) => void
  /** True while an add or a remove is in flight, or an export holds the engine. */
  disabled?: boolean
}

/** What the row says about where a feed runs, when the registry knows. */
export function placeOf(feed: FeedRecord): string | null {
  const parts = [feed.city, feed.network].filter((p) => p !== '')
  return parts.length === 0 ? null : parts.join(' · ')
}

export default function FeedList({
  feeds,
  onNewProject,
  onRemove,
  disabled = false,
}: Props): JSX.Element {
  const presets = feeds.filter((f) => f.source === 'preset')
  const added = feeds.filter((f) => f.source === 'user')
  const group = (title: string, rows: FeedRecord[]): JSX.Element | null =>
    rows.length === 0 ? null : (
      <li className="feed-group">
        <h3>{title}</h3>
        <ul className="entries" aria-label={title}>
          {rows.map((feed) => {
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
                    disabled={disabled}
                    aria-label={`Start a project on ${feed.name}`}
                  >
                    <Icon name="add" />
                    Start a project
                  </Button>
                  {feed.source === 'user' && (
                    <Button
                      variant="ghost"
                      onClick={() => onRemove(feed)}
                      disabled={disabled}
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
      </li>
    )
  return (
    <section className="feeds" aria-labelledby="feeds-heading">
      <h2 id="feeds-heading">Feeds</h2>
      <ul className="feed-groups">
        {group('Presets', presets)}
        {group('Added', added)}
      </ul>
    </section>
  )
}
