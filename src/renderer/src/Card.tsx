import type { JSX, Ref } from 'react'
import Icon from './icons/Icon'

// One card of the front door (ADR-047, issue 287). "Your projects" and
// "Sample cities" are one kind of card in one grid, and the New project card
// is the same card with a plus where a picture would be.
//
// A card is one native button, and it says less than a row did: one primary
// line, the name, which may wrap to two and no further, and at most two
// secondary - where it runs, then for a sample whether it is downloaded, in
// a small chip and not a line, and for a project how far it has got. A line
// that is clamped is clamped by the stylesheet alone, so its whole text stays
// in the document, and the caller's `label` carries it into the name a
// screen reader says.
//
// The picture area is drawn empty in this half of the issue: the sunken
// surface with a muted `train` glyph, decorative and hidden from assistive
// technology, never a shimmer (this state is permanent or waits on the
// person, and a shimmer says loading) and never a flat blank (which reads as
// broken). It is not the mark, which is never given a meaning (DESIGN.md,
// section 6). The pictures themselves are files the engine wrote, shown in
// an image with an empty alternative text, since the card's name already
// says whose picture it is; nothing here draws a map (constitution
// principle I).

export interface CardProps {
  /** The primary line. */
  name: string
  /** The secondary lines, one to a line, in the order they are read. */
  facts?: readonly string[]
  /** A status in a small chip after the facts, rather than a line of its own. */
  chip?: string | null
  /**
   * The engine's picture of the map, by address. None in this half of the
   * issue: every caller leaves it out and the area is drawn empty.
   */
  picture?: string | null
  /** The New project card: the plus where a picture would be, since a press makes something. */
  create?: boolean
  /** The accessible name, where the card's visible words are not it. */
  label?: string
  /** The facts' id, which the card is described by. */
  factsId?: string
  ref?: Ref<HTMLButtonElement>
  onClick: () => void
}

export default function Card({
  name,
  facts = [],
  chip = null,
  picture = null,
  create = false,
  label,
  factsId,
  ref,
  onClick,
}: CardProps): JSX.Element {
  const hasFacts = facts.length > 0 || chip !== null
  return (
    <button
      ref={ref}
      type="button"
      className={create ? 'card card-new' : 'card'}
      aria-label={label}
      aria-describedby={hasFacts ? factsId : undefined}
      onClick={onClick}
    >
      <span className="card-picture">
        {picture === null ? (
          <Icon name={create ? 'add' : 'train'} size={24} />
        ) : (
          <img src={picture} alt="" />
        )}
      </span>
      <span className="card-name">{name}</span>
      {hasFacts && (
        <span className="card-facts" id={factsId}>
          {facts.map((fact, at) => (
            <span key={`${at}:${fact}`} className="card-fact">
              {fact}
            </span>
          ))}
          {chip !== null && <span className="card-chip">{chip}</span>}
        </span>
      )}
    </button>
  )
}
