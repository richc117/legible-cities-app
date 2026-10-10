import { useEffect, useId, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import {
  DEFAULT_LINE,
  EVERY_LINE_HIDDEN,
  isLineDash,
  settledLine,
  type LineChoice,
} from '../../shared/project'
import { useColourPanel } from './ColourChip'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Disclosure from './kit/Disclosure'
import Select from './kit/Select'
import TextInput from './kit/TextInput'
import {
  CASING_COLOUR_SENTENCE,
  CASING_LABEL,
  CASING_SENTENCE,
  casingChipName,
  casingColourOf,
  casingOptions,
  casingPanelName,
  casingWidthOf,
  DASH_LABEL,
  DASH_OPTIONS,
  DASH_SENTENCE,
  NAME_LABEL,
  nameSentence,
  OPTIONS_NAME,
  optionsName,
  optionsSummary,
  readName,
  RESET_LINE_LABEL,
  resetLineName,
  SHOWN_LABEL,
  SHOWN_SENTENCE,
  WIDTH_LABEL,
  WIDTH_SENTENCE,
  widthOf,
  widthOptions,
  withCasingColour,
  withCasingWidth,
  withDash,
  withName,
  withShown,
  withWidth,
} from './lineOptions'

// One line's options in cell 05 (issue 394, spec 036): a closed disclosure
// under the line's row in the colours list, "Line options", whose summary
// says what the line holds, and in it the line's name, whether it is drawn,
// its width, a casing with its colour, a dash, and Reset line.
//
// The app draws controls and nothing else. A hidden line, a name on a chip,
// a bold, cased or dashed stroke are the engine's: this sends `map.build`
// what a person chose, in the engine's own names, and the map and every
// export of it follow (constitution I). What is shown, what is drawn and
// when is the section's (`LineColours.tsx`); this hands it each choice as
// the line's whole options and nothing else.
//
// The disclosure is the kit's with no heading, the kit's "disclosure inside a
// row": its button carries the line's label in a visually hidden part, so
// it names its line as every control in the list does, and its group is
// named for the line too. Every control inside it is cell 04's: a select's
// name drawn in the terms' column and hidden from the tree, a field
// committed on Enter or on leaving it, a refusal beside it in the engine's
// own sentence.

/**
 * Point the native select inside a kit select at the sentence under it, as
 * cell 04's selects do (`StyleLooks.tsx` says why): the kit names its select
 * and does not describe it, and keeps it in the light DOM, so an id in the
 * document resolves. Written after every render, since the element is the
 * kit's and could be made again.
 */
function useDescribed(host: RefObject<HTMLElement | null>, described: string): void {
  useEffect(() => {
    const select = host.current?.querySelector('select')
    if (select && select.getAttribute('aria-describedby') !== described)
      select.setAttribute('aria-describedby', described)
  })
}

/** A select's row: its name in the terms' column, the control, what stands beside it, and its sentence. */
function SelectRow({
  name,
  value,
  options,
  sentence,
  onChange,
  beside = null,
  after = null,
}: {
  name: string
  value: string
  options: readonly { value: string; label: string }[]
  sentence: string
  onChange: (value: string) => void
  /** What stands beside the select on its line: the casing's colour chip. */
  beside?: ReactNode
  /** What is said under the sentence: the casing colour's note. */
  after?: ReactNode
}): JSX.Element {
  const id = useId()
  const host = useRef<HTMLElement>(null)
  useDescribed(host, `${id}-said`)
  return (
    <div className="style-field">
      <span className="style-name" aria-hidden="true">
        {name}
      </span>
      <div className="style-control">
        <div className="line-options-select">
          <Select ref={host} label={name} value={value} onChange={onChange}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {beside}
        </div>
        <p id={`${id}-said`} className="message">
          {sentence}
        </p>
        {after}
      </div>
    </div>
  )
}

/**
 * The casing's colour (FR-005): the cell's own colour chip beside the casing
 * select and the panel it opens. Mounted only while the line has a casing,
 * so a panel open when the casing goes to None goes with it and takes
 * nothing of its state into the next casing chosen.
 */
function CasingColour({
  label,
  choice,
  onChoose,
  onFollow,
  onPanelClosed,
}: Pick<
  LineOptionsProps,
  'label' | 'choice' | 'onChoose' | 'onFollow' | 'onPanelClosed'
>): JSX.Element {
  const { chip, panel } = useColourPanel({
    label: casingChipName(label),
    colour: casingColourOf(choice),
    panelName: casingPanelName(label),
    onPick: (hex) => onFollow(withCasingColour(choice, hex)),
    onPickEnd: (hex) => onChoose(withCasingColour(choice, hex)),
    onClosed: onPanelClosed,
  })
  return (
    <>
      {chip}
      {panel}
    </>
  )
}

export interface LineOptionsProps {
  /** The line's label, its key everywhere. */
  label: string
  /** The line's options as the section shows them: what it holds, or `{}`. */
  choice: LineChoice
  /** A choice made: the line's whole options after it, shown at once and drawn after the delay. */
  onChoose: (next: LineChoice) => void
  /** A casing colour a gesture has reached and not released: shown, and not drawn. */
  onFollow: (next: LineChoice) => void
  /** The casing's panel closed, whatever closed it. */
  onPanelClosed: () => void
  /** Reset line: the line's options cleared, and nothing else. */
  onReset: () => void
  /**
   * This line is the only one the cell lists that is drawn, so hiding it
   * would hide every line, which the engine refuses (FR-003).
   */
  lastShown: boolean
  /**
   * Where focus goes when Reset line disables itself under a person's hands:
   * the cell's own heading, as the colours' resets hand it (A6-07).
   */
  handback: RefObject<HTMLElement | null>
}

export default function LineOptions({
  label,
  choice,
  onChoose,
  onFollow,
  onPanelClosed,
  onReset,
  lastShown,
  handback,
}: LineOptionsProps): JSX.Element {
  const ids = useId()
  const [open, setOpen] = useState(false)
  // The name as typed, read only when committed; and why the last commit,
  // or the last press of the switch, was refused.
  const [text, setText] = useState(choice.name ?? '')
  const [refusedName, setRefusedName] = useState<string | null>(null)
  const [refusedShown, setRefusedShown] = useState<string | null>(null)

  // The field follows the line's name when it moves under it: a reset, a
  // stopped redraw put back, a record read again. A refusal goes with what
  // it refused.
  useEffect(() => {
    setText(choice.name ?? '')
    setRefusedName(null)
  }, [choice.name])

  const commitName = (): void => {
    const read = readName(label, text)
    if ('refused' in read) {
      setRefusedName(read.refused)
      return
    }
    setRefusedName(null)
    setText(read.name ?? '')
    if (read.name !== choice.name) onChoose(withName(choice, read.name))
  }

  const shown = choice.hidden !== true
  const toggleShown = (on: boolean): void => {
    // The last line drawn stays drawn: the engine refuses a map with none.
    if (!on && lastShown) {
      setRefusedShown(EVERY_LINE_HIDDEN)
      return
    }
    setRefusedShown(null)
    onChoose(withShown(choice, on))
  }

  const cased = casingWidthOf(choice) !== DEFAULT_LINE.casingWidth
  const nameId = `${ids}-name`
  const shownId = `${ids}-shown`
  // Reset line can be pressed while the line holds anything, or a refused
  // name waits in its field, since clearing that is part of what it does.
  const resettable = Object.keys(settledLine(label, choice)).length > 0 || refusedName !== null

  return (
    <div className="line-options">
      <Disclosure
        className="line-options-toggle"
        open={open}
        onToggle={setOpen}
        label={optionsName(label)}
        summary={
          <>
            <Icon name="chevron" size={16} className="cell-chevron" />
            {OPTIONS_NAME}
            <span className="visually-hidden"> for line {label},</span>{' '}
            <span className="line-options-word">{optionsSummary(label, choice)}</span>
          </>
        }
      >
        <div className="style-field">
          <label htmlFor={nameId}>{NAME_LABEL}</label>
          <div
            className="style-control"
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              commitName()
            }}
          >
            <TextInput
              id={nameId}
              value={text}
              onChange={setText}
              placeholder={label}
              spellCheck={false}
              aria-describedby={
                refusedName === null ? `${nameId}-said` : `${nameId}-said ${nameId}-refused`
              }
              aria-invalid={refusedName !== null ? true : undefined}
            />
            <p id={`${nameId}-said`} className="message">
              {nameSentence(label)}
            </p>
            {refusedName !== null && (
              <p id={`${nameId}-refused`} className="message error" role="alert">
                {refusedName}
              </p>
            )}
          </div>
        </div>
        <div className="style-field">
          <label htmlFor={shownId}>{SHOWN_LABEL}</label>
          <div className="style-control">
            <span className="line-options-switch">
              <input
                id={shownId}
                type="checkbox"
                role="switch"
                checked={shown}
                onChange={(event) => toggleShown(event.currentTarget.checked)}
                aria-describedby={
                  refusedShown === null ? `${shownId}-said` : `${shownId}-said ${shownId}-refused`
                }
              />
            </span>
            <p id={`${shownId}-said`} className="message">
              {SHOWN_SENTENCE}
            </p>
            {refusedShown !== null && (
              <p id={`${shownId}-refused`} className="message error" role="alert">
                {refusedShown}
              </p>
            )}
          </div>
        </div>
        <SelectRow
          name={WIDTH_LABEL}
          value={String(widthOf(choice))}
          options={widthOptions(choice)}
          sentence={WIDTH_SENTENCE}
          onChange={(value) => onChoose(withWidth(choice, Number(value)))}
        />
        <SelectRow
          name={CASING_LABEL}
          value={String(casingWidthOf(choice))}
          options={casingOptions(choice)}
          sentence={CASING_SENTENCE}
          onChange={(value) => onChoose(withCasingWidth(choice, Number(value)))}
          // The casing's colour, only while there is a casing to colour: a
          // chip beside the select, the app's own picker in its panel.
          beside={
            cased ? (
              <CasingColour
                label={label}
                choice={choice}
                onChoose={onChoose}
                onFollow={onFollow}
                onPanelClosed={onPanelClosed}
              />
            ) : null
          }
          after={cased ? <p className="message">{CASING_COLOUR_SENTENCE}</p> : null}
        />
        <SelectRow
          name={DASH_LABEL}
          value={choice.dash ?? DEFAULT_LINE.dash}
          options={DASH_OPTIONS}
          sentence={DASH_SENTENCE}
          onChange={(value) => {
            if (isLineDash(value)) onChoose(withDash(choice, value))
          }}
        />
        <div className="toolbar">
          <Button
            disabled={!resettable}
            aria-label={resetLineName(label)}
            onClick={() => {
              // The button goes unavailable with nothing left to reset, and
              // Chromium blurs a disabled element: focus goes to the cell's
              // heading first (A6-07).
              handback.current?.focus()
              setText('')
              setRefusedName(null)
              setRefusedShown(null)
              onReset()
            }}
          >
            {RESET_LINE_LABEL}
          </Button>
        </div>
      </Disclosure>
    </div>
  )
}
