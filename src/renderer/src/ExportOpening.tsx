import { useEffect, useState, type JSX } from 'react'
import type { ExportChoice } from '../../shared/export'
import { hasCard, hasDrawIn, isOpening } from '../../shared/opening'
import Select from './kit/Select'
import TextInput from './kit/TextInput'
import {
  OPENING_LABEL,
  OPENING_OPTIONS,
  OPENING_SENTENCE,
  openingOf,
  readSeconds,
  SECONDS_FIELDS,
  secondsText,
  withOpening,
  withSeconds,
  type SecondsKey,
} from './opening'

// Cell 06's Opening (issue 392, spec 035): what plays before the storyboard
// of a video or GIF - a title card, the network drawing in, or both - and
// how long each lasts. Drawn by `ExportTab.tsx` after the storyboard, for a
// preset that plays one, and only once the storyboard is known.
//
// The choice is written the moment it is made, as every choice in the cell
// is, and the main process makes it into the list of beats the plan is sent
// (`shared/opening.ts`). Nothing here draws the card or the network: the
// engine's page does both, in the export, driven by the capture.
//
// The two durations are cell 06's typed fields (the start time's and the
// tag's): read when committed - Enter, or leaving the field - and never per
// keystroke; refused beside the field in `--error`, with `aria-invalid` and
// what was typed kept, and nothing written. An emptied field goes back to
// its default, which the record never holds.
//
// Every opening is offered for every storyboard, whatever view it opens on:
// the engine takes each of them (spec 035, FR-004).

interface Props {
  choice: ExportChoice
  /** An export is running, or the project cannot be written. */
  locked: boolean
  onChange: (next: ExportChoice) => void
}

type Drafts = Record<SecondsKey, string>
type Problems = Partial<Record<SecondsKey, string>>

/** The two fields as typed, and the refusal beside each that has one. */
interface Fields {
  drafts: Drafts
  problems: Problems
}

const KEYS: readonly SecondsKey[] = ['cardSecs', 'drawInSecs']

const textOf = (key: SecondsKey, seconds: number | undefined): string =>
  secondsText(seconds, SECONDS_FIELDS[key].range)

export default function ExportOpening({ choice, locked, onChange }: Props): JSX.Element {
  const opening = openingOf(choice)
  const [fields, setFields] = useState<Fields>(() => ({
    drafts: {
      cardSecs: textOf('cardSecs', choice.cardSecs),
      drawInSecs: textOf('drawInSecs', choice.drawInSecs),
    },
    problems: {},
  }))

  // A choice that arrives with other seconds - the record read again, the
  // project opened afresh - shows them, except in a field still holding a
  // number it refused, which a person is in the middle of putting right.
  const { cardSecs, drawInSecs } = choice
  useEffect(() => {
    const held = { cardSecs, drawInSecs }
    setFields((current) => {
      const drafts = { ...current.drafts }
      for (const key of KEYS)
        if (current.problems[key] === undefined) drafts[key] = textOf(key, held[key])
      return { drafts, problems: current.problems }
    })
  }, [cardSecs, drawInSecs])

  const commit = (key: SecondsKey): void => {
    const read = readSeconds(fields.drafts[key], key)
    if (!read.ok) {
      const problem = read.problem
      setFields((current) => ({ ...current, problems: { ...current.problems, [key]: problem } }))
      return
    }
    // What the field shows from now on is the number taken, or the default.
    setFields((current) => {
      const problems = { ...current.problems }
      delete problems[key]
      return {
        drafts: { ...current.drafts, [key]: textOf(key, read.seconds ?? undefined) },
        problems,
      }
    })
    const next = withSeconds(choice, key, read.seconds)
    if (next[key] !== choice[key]) onChange(next)
  }

  const field = (key: SecondsKey): JSX.Element => {
    const { id, label, rule } = SECONDS_FIELDS[key]
    const problem = fields.problems[key]
    return (
      <div className="field" key={key}>
        <label htmlFor={id}>{label}</label>
        <div
          onBlur={() => commit(key)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            // Not the form's submit: this field commits itself.
            event.preventDefault()
            commit(key)
          }}
        >
          <TextInput
            id={id}
            value={fields.drafts[key]}
            onChange={(text) =>
              setFields((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))
            }
            disabled={locked}
            spellCheck={false}
            aria-describedby={`${id}-message`}
            aria-invalid={problem !== undefined ? true : undefined}
          />
        </div>
        <p id={`${id}-message`} className={problem === undefined ? 'message' : 'message error'}>
          {problem ?? rule}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          {OPENING_LABEL}
        </span>
        <Select
          label={OPENING_LABEL}
          value={opening}
          disabled={locked}
          onChange={(value) => {
            if (value === 'none' || isOpening(value)) onChange(withOpening(choice, value))
          }}
        >
          {OPENING_OPTIONS.map(({ value, words }) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </Select>
        <p className="message">{OPENING_SENTENCE}</p>
      </div>
      {hasCard(opening) && field('cardSecs')}
      {hasDrawIn(opening) && field('drawInSecs')}
    </>
  )
}
