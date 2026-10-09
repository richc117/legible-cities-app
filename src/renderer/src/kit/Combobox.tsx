import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react'
import {
  AT_REST,
  activeWithin,
  expanded,
  keyed,
  left,
  listed,
  pressed,
  shownText,
  typedIn,
  type ComboboxOption,
  type ComboboxState,
} from './comboboxModel'

// An editable combobox, the kit's first control with a popup (issue 272,
// spec 030 FR-003, DESIGN.md 8.2 "Combobox"): the APG's list autocomplete
// with manual selection. Its behaviour is `comboboxModel.ts`, which has no
// React in it; this file is the screen and the wiring.
//
// **It is the platform's own `<input>`, not the kit's text field.** FigUI3's
// field rebuilds its inner input and mirrors a fixed list of five aria
// attributes onto it; `role`, `aria-expanded`, `aria-controls`,
// `aria-autocomplete` and `aria-activedescendant` are none of them, and an
// id reference set inside a kit element resolves in its own tree (the
// button's F6 again). A native field in the document's own tree carries all
// five as attributes, which is what the pattern is written for, and it is
// drawn in the tokens the way the date control is (ADR-026's rule for the
// select and the date control: the platform's element, in the tokens).
//
// **DOM focus never leaves the field.** The popup's options are never
// focusable; the highlighted one is named by `aria-activedescendant` and
// `aria-selected`, and a press on one is taken on `mousedown` with its
// default prevented, so the field keeps focus through it.
//
// **The popup is a manual popover, in the top layer, anchored to the field**
// - the floating panel's rule (DESIGN.md 8.2, issue 284) with the one
// difference a combobox needs: this component opens and shuts it, because
// typing opens it and nothing is invoked. It is anchored by name, a
// per-instance `anchor-name` set on the field and taken by the popup, so two
// comboboxes in one section never share an anchor.

export interface ComboboxProps {
  /** The visible label, which is the field's name and the popup's. */
  label: string
  /** What the popup offers, in the order it lists them. */
  options: readonly ComboboxOption[]
  /** The chosen option's id, or null for none. */
  value: string | null
  /** An option was chosen. The caller may refuse it, and the field then shows its value again. */
  onChoose: (id: string) => void
  /** The field was emptied: the choice is cleared. */
  onClear: () => void
  /** The polite line's words for how many options match what was typed. */
  countWords: (count: number) => string
  /** A refusal, said beside the field in an alert and named as its description. */
  message?: string | null
}

/** A name CSS takes as a dashed ident, made from React's id for this instance. */
const anchorFor = (id: string): string => `--combobox-${id.replace(/[^A-Za-z0-9_-]/g, '')}`

const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  { label, options, value, onChoose, onClear, countWords, message = null },
  ref,
): JSX.Element {
  const base = useId()
  const inputId = `${base}-field`
  const labelId = `${base}-label`
  const listId = `${base}-list`
  const messageId = `${base}-message`
  const optionId = (index: number): string => `${listId}-${index}`

  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  useImperativeHandle(ref, () => input.current as HTMLInputElement, [])

  const [state, setState] = useState<ComboboxState>(AT_REST)
  const chosen = options.find((option) => option.id === value) ?? null
  const matches = listed(state, options)
  const showing = expanded(state, matches.length)
  const active = showing ? activeWithin(state, matches.length) : null

  // The anchor, once: the field names itself and the popup takes the name.
  // Set as properties rather than written in a style prop, so nothing here
  // depends on whether React's typings know the two properties yet.
  useEffect(() => {
    const name = anchorFor(base)
    input.current?.style.setProperty('anchor-name', name)
    list.current?.style.setProperty('position-anchor', name)
  }, [base])

  // The popup follows the state and nothing else drives it. A manual
  // popover: no light dismiss, which would shut it on the press that chooses
  // an option, and no Escape of its own, which the field handles.
  useEffect(() => {
    const popup = list.current
    if (popup === null || typeof popup.showPopover !== 'function') return
    const open = popup.matches(':popover-open')
    if (showing && !open) popup.showPopover()
    else if (!showing && open) popup.hidePopover()
  }, [showing])

  // The highlighted option in view, for a list longer than the popup.
  useEffect(() => {
    if (active === null) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // `optionId` is made from `listId`, which does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // The option already chosen, chosen again, is still a choice: the caller
  // decides whether it changes anything, and may use it to ask again.
  const take = (id: string | null): void => {
    if (id !== null) onChoose(id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // A key that is composing text in an input method is the method's: an
    // Enter that ends a composition must not choose an option too.
    if (event.nativeEvent.isComposing) return
    const outcome = keyed(state, { key: event.key, altKey: event.altKey }, matches)
    if (outcome.handled) event.preventDefault()
    // Escape is the popup's while it is open, and nothing above it hears it.
    if (outcome.handled && event.key === 'Escape') event.stopPropagation()
    setState(outcome.state)
    take(outcome.accept)
  }

  // What the polite line says: how many match, while the popup is wanted
  // and only then, so a closed field says nothing and the count is read as
  // a person types.
  const said = state.open ? countWords(matches.length) : ''

  return (
    <div className="field combobox">
      <label id={labelId} htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={input}
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={active === null ? undefined : optionId(active)}
        aria-describedby={message ? messageId : undefined}
        aria-invalid={message ? true : undefined}
        value={shownText(state, chosen?.label ?? '')}
        onChange={(event) => {
          const { state: next, clear } = typedIn(event.target.value)
          setState(next)
          if (clear && value !== null) onClear()
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setState(left())}
      />
      <ul
        ref={list}
        id={listId}
        className="combobox-popup"
        role="listbox"
        aria-labelledby={labelId}
        popover="manual"
        // Never a Tab stop, even when it overflows and Chromium would make a
        // scroller focusable; and a press anywhere on it - its padding, its
        // scrollbar - keeps focus in the field, so the field's blur does not
        // shut the popup under the pointer.
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
      >
        {showing &&
          matches.map((option, index) => (
            <li
              key={option.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // Taken on mousedown with the default kept back, so focus stays
              // in the field and its blur does not shut the popup first.
              onMouseDown={(event) => {
                event.preventDefault()
                const outcome = pressed(matches, index)
                setState(outcome.state)
                take(outcome.accept)
              }}
            >
              {option.label}
            </li>
          ))}
      </ul>
      <p className="visually-hidden" role="status" aria-live="polite">
        {said}
      </p>
      <p id={messageId} className="message error" role="alert">
        {message}
      </p>
    </div>
  )
})

export default Combobox
