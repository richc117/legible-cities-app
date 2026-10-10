import { useEffect, useId, useRef, useState, type JSX, type RefObject } from 'react'
import type { EngineState } from '../../shared/engine'
import { DEFAULT_STYLE, type ChoiceKey, type ProjectStyle } from '../../shared/project'
import { engineClient } from './engine/runs'
import Select from './kit/Select'
import {
  forgetLooks,
  LOOK_LABEL,
  lookOptions,
  looksFor,
  looksSentence,
  matchLook,
  offeredLooks,
  type Look,
  type Looks,
} from './looks'
import { CHOICE_FIELDS } from './styleRules'

// Cell 04's selects (issue 391, spec 034): the Look at the head of the
// sizes group, and the two markers and the label face after the sizes. The
// group itself - what is shown, what is drawn and when, Reset - is
// `StyleFields.tsx`'s, and these hand it what was chosen and nothing else:
// one group, one redraw, one Reset.
//
// Each is the kit's select (`kit/Select.tsx`), the platform's own, named by
// its label as the grid in cell 02 is; the name beside it is drawn as the
// sizes' labels are and hidden from the accessibility tree, where the
// select already says it. What is said under a select is in its
// description: the kit's wrapper names its native select and does not
// describe it, so the description is set on that select here, through the
// host the wrapper hands back (`useDescribed`).

/**
 * Point the native select inside a kit select at the sentence under it. The
 * kit's element keeps the platform's `<select>` in the light DOM, so an id
 * in the document resolves; it is written after every render because the
 * element is the kit's and could be made again.
 */
function useDescribed(host: RefObject<HTMLElement | null>, described: string | null): void {
  useEffect(() => {
    const select = host.current?.querySelector('select')
    if (!select || select.getAttribute('aria-describedby') === described) return
    if (described === null) select.removeAttribute('aria-describedby')
    else select.setAttribute('aria-describedby', described)
  })
}

/** A select's row: its name in the terms' column, the control and what is said under it beside. */
function SelectRow({
  name,
  value,
  options,
  sentence,
  onChange,
}: {
  name: string
  value: string
  options: readonly { value: string; label: string }[]
  /** What is said under the select, and is its description; none where nothing is. */
  sentence: string | null
  onChange: (value: string) => void
}): JSX.Element {
  const id = useId()
  const host = useRef<HTMLElement>(null)
  useDescribed(host, sentence === null ? null : `${id}-said`)
  return (
    <div className="style-field">
      <span className="style-name" aria-hidden="true">
        {name}
      </span>
      <div className="style-control">
        <Select ref={host} label={name} value={value} onChange={onChange}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {sentence !== null && (
          <p id={`${id}-said`} className="message">
            {sentence}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The Look (spec 034, FR-001): the engine's looks, asked once while the
 * engine stays up, and what the style the group shows is - the engine's own
 * sizes, a look, or Custom. While the engine is not running, or did not list
 * its looks, it offers the engine's own sizes and, where the style is not
 * them, Custom, and says why; nothing else in the group waits on it.
 */
export function LookSelect({
  style,
  engine,
  onChoose,
}: {
  style: ProjectStyle
  engine: EngineState | null
  /** A value chosen in the select, with the looks it was offered from. */
  onChoose: (value: string, looks: readonly Look[]) => void
}): JSX.Element {
  const ready = engine?.state === 'ready'
  const [looks, setLooks] = useState<Looks>({ status: 'waiting' })

  // The engine's looks, once while it stays up. A restarted engine may be
  // another version, so they are asked again, as the export's tables are.
  useEffect(() => {
    if (!ready) {
      forgetLooks()
      setLooks({ status: 'waiting' })
      return
    }
    let left = false
    looksFor(engineClient()).then(
      (answer) => {
        if (!left) setLooks({ status: 'ready', looks: answer })
      },
      () => {
        if (!left) setLooks({ status: 'failed' })
      },
    )
    return () => {
      left = true
    }
  }, [ready])

  const offered = offeredLooks(looks)
  return (
    <SelectRow
      name={LOOK_LABEL}
      value={matchLook(style, offered)}
      options={lookOptions(style, offered)}
      sentence={looksSentence(looks)}
      onChange={(value) => onChoose(value, offered)}
    />
  )
}

/**
 * A marker or the label face (spec 034, FR-002 and FR-003): the engine's
 * choices in its order, the style's own shown, the engine's own while the
 * style holds none.
 */
export function ChoiceSelect({
  choice,
  style,
  sentence = null,
  onChoose,
}: {
  choice: ChoiceKey
  style: ProjectStyle
  sentence?: string | null
  onChoose: (choice: ChoiceKey, value: string) => void
}): JSX.Element {
  const { label, options } = CHOICE_FIELDS[choice]
  return (
    <SelectRow
      name={label}
      value={style[choice] ?? DEFAULT_STYLE[choice]}
      options={options}
      sentence={sentence}
      onChange={(value) => onChoose(choice, value)}
    />
  )
}
