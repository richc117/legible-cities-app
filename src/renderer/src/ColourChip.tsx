import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { HexColorPicker } from 'react-colorful'
import { readHex } from './colours'
import Button from './kit/Button'
import TextInput from './kit/TextInput'

// Cell 05's colour chip, the floating panel it opens and the picker in it
// (A4-01, issue 284), for every colour the cell chooses: a line's own, the
// default for the lines the feed leaves uncoloured (`LineColours.tsx`), and
// since issue 394 a line's casing (`LineOptionsDisclosure.tsx`). One control, so the
// three behave alike under a pointer, a key and a screen reader, and what
// issue 87, issue 262 and issue 284 paid for is paid for once.

/** A colour chosen is data, not a token: it is drawn from the record, never from a stylesheet. */
const swatch = (colour: string): { background: string } => ({ background: colour })

/** The nearest ancestor that scrolls vertically, else the page. */
function scrollerOf(el: HTMLElement): Element {
  for (let up = el.parentElement; up !== null; up = up.parentElement) {
    const { overflowY } = getComputedStyle(up)
    if ((overflowY === 'auto' || overflowY === 'scroll') && up.scrollHeight > up.clientHeight)
      return up
  }
  return document.scrollingElement ?? document.documentElement
}

/** A box's top and bottom in the window, as `getBoundingClientRect` gives them. */
export interface Span {
  top: number
  bottom: number
}

/**
 * How far to scroll the chip's scroller so that the chip and its panel are
 * in the window together (issue 436): positive moves the page up, negative
 * down, 0 leaves it. `header` is the bottom of the sticky header and
 * `height` the window's.
 *
 * The least that fits both, and never at the chip's cost. Run past the
 * bottom, the page moves up, but never so far that the chip goes under the
 * header. Run under the header - a panel the platform placed above its
 * chip, because the window had room above it - the page moves down, but
 * never so far that the chip goes past the bottom of the window: the panel
 * is in the top layer and is drawn over the header, while a chip pushed
 * out of the window is a panel whose control cannot be seen. So the panel's
 * wish is clamped to the chip's own room, whichever way the panel overruns:
 * with a chip already a little past the foot and its panel flipped above
 * it, both overruns hold at once, and the chip's room decides.
 */
export function fitShift(chip: Span, panel: Span, header: number, height: number): number {
  const top = Math.min(chip.top, panel.top)
  const bottom = Math.max(chip.bottom, panel.bottom)
  const want = bottom > height ? bottom - height : top < header ? top - header : 0
  return Math.min(Math.max(want, chip.bottom - height), chip.top - header)
}

/**
 * Bring the chip and the panel it opened into the window together (issue
 * 436). The panel is in the top layer, placed by the platform against the
 * chip below it or, where that does not fit, above it; where neither fits it
 * stays below and runs past the window, with the controls inside it out of
 * sight while focus is on them. A fixed box is never scrolled into view, so
 * it is the chip's scroller that moves, by `fitShift`, never smoothly.
 */
function keepInWindow(chip: HTMLElement, panel: HTMLElement): void {
  const header = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0
  const by = fitShift(
    chip.getBoundingClientRect(),
    panel.getBoundingClientRect(),
    header,
    window.innerHeight,
  )
  if (by === 0 || Number.isNaN(by)) return
  scrollerOf(chip).scrollBy({ top: by, behavior: 'instant' })
}

/** What a chip names, what it shows, and what its gestures do. */
export interface ColourPanelProps {
  /** The chip's name, which names what it colours ("Choose the colour of line A"). */
  label: string
  colour: string
  /** The panel's name, as a group ("Colour for line A"). */
  panelName: string
  /** Every colour a gesture reaches. */
  onPick: (hex: string) => void
  /** The colour a gesture ended on, or a typed one chosen with the button. */
  onPickEnd: (hex: string) => void
  /** The panel closed, whatever closed it. */
  onClosed: () => void
  /** Only a colour that can be taken back offers Reset. */
  reset?: { label: string; enabled: boolean; onReset: () => void }
}

/**
 * The colour chip and the panel it opens, for a caller to place: the chip
 * where the colour is shown, the panel anywhere after it, since it is drawn
 * in the top layer and takes nothing from the flow.
 *
 * The chip is a native button in the colour it chooses: the preview and the
 * control in one (issue 284). A native button and not
 * the kit's, so the kit's inner-button trap (`.claude/rules/renderer.md`,
 * issue 121) does not arise. The panel is an auto popover anchored to it.
 *
 * What the platform does here is what a hand-written dismissal (issue 87's) used to do. An auto
 * popover is light-dismissed only when the press and the release both land
 * outside it, so a drag that begins in the square and ends on the map is a
 * colour and the panel stays (issue 87); a click outside closes it, Escape
 * closes it, and opening another row's chip closes this one. It is in the
 * top layer, so it is never clipped by the cell or hidden behind the pinned
 * band, and it takes nothing out of the flow, so the old reason to dismiss
 * on the click and not the press - a picker leaving the flow between press
 * and release moved the button being pressed - is gone with the flow.
 *
 * The panel is always in the document and its contents are mounted while it
 * is open. React follows the element, by its `beforetoggle` event, and
 * never drives it except to close it from a finished gesture.
 */
export function useColourPanel({
  label,
  colour,
  panelName,
  onPick,
  onPickEnd,
  onClosed,
  reset,
}: ColourPanelProps): { chip: JSX.Element; panel: JSX.Element } {
  const panelId = useId()
  // Whether this panel is showing, as the element last said. It lives here
  // and not in the parent so that it goes with the row: a popover removed
  // from the document sends no event, and a flag kept above would read
  // "open" for a row that came back closed (an engine restart, a change of
  // mode). Nothing above needs to know which is open: opening one closes
  // the others, which is the platform's.
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // A person saying they have finished: close the panel and go back to the
  // chip that opened it, as the rename form's does.
  const done = (): void => {
    if (panelRef.current?.matches(':popover-open') === true) panelRef.current.hidePopover()
    chipRef.current?.focus()
  }
  // While the panel is open, focus is on its chip, inside it, or out of the
  // document (the window losing it); focus landing anywhere else closes it
  // (issue 436). An auto popover is light-dismissed by a press outside and
  // not by focus, and it lies over whatever is beside its chip: flipped
  // above a chip near the window's foot, it covers the row above, so a
  // Shift+Tab from the chip, a Tab out of the panel, or the app moving focus
  // itself put focus on a control the panel hid. The document's `focusin`
  // and not the panel's blur, because the first and the last of those never
  // had focus in the panel to lose.
  useEffect(() => {
    if (!open) return
    const away = (event: FocusEvent): void => {
      const panel = panelRef.current
      const to = event.target
      if (panel === null || !(to instanceof Node)) return
      if (to === chipRef.current || panel.contains(to)) return
      if (panel.matches(':popover-open')) panel.hidePopover()
    }
    document.addEventListener('focusin', away)
    return () => document.removeEventListener('focusin', away)
  }, [open])
  const chip = (
    <button
      ref={chipRef}
      type="button"
      className="colour-chip"
      style={swatch(colour)}
      popoverTarget={panelId}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={label}
    />
  )
  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      className="colour-popover"
      popover="auto"
      role="group"
      aria-label={panelName}
      // Mounted before the panel is shown, so its contents are there for
      // its first frame and the flip is decided on the box it will have,
      // not an empty one; unmounted only after it has gone. The platform
      // gives focus back to the chip when a panel closes with focus in it,
      // and it can only do that if the focused field is still there
      // when it looks.
      onBeforeToggle={(event) => {
        if (event.newState === 'open') setOpen(true)
      }}
      onToggle={(event) => {
        if (event.newState === 'closed') {
          onClosed()
          setOpen(false)
        } else if (chipRef.current !== null && panelRef.current !== null)
          keepInWindow(chipRef.current, panelRef.current)
      }}
      // Focus entering the panel by a key (Tab from the chip) finds it where
      // it is: brought into the window if the page has moved since it opened.
      onFocus={() => {
        if (chipRef.current !== null && panelRef.current !== null)
          keepInWindow(chipRef.current, panelRef.current)
      }}
    >
      {open && (
        <ColourPicker
          colour={colour}
          onPick={onPick}
          onPickEnd={onPickEnd}
          onDone={done}
          reset={
            reset === undefined
              ? undefined
              : {
                  ...reset,
                  onReset: () => {
                    reset.onReset()
                    done()
                  },
                }
          }
        />
      )}
    </div>
  )
  return { chip, panel }
}

/**
 * One colour, two ways: the picker for a pointing device, and a typed hex
 * value for everything else. The picker is keyboard-operable in its own
 * right (its two areas are sliders that take the arrow keys), and the field
 * beside it is the path that needs no pointing device at all.
 *
 * `onPick` is every colour the picker is given, including each step of a
 * drag, and it sends nothing: the swatch and the hex field follow it.
 * `onPickEnd` is the colour a gesture ended on - the picker's own
 * `onChangeEnd`, on the release of the pointer or of an arrow key - or the
 * one typed into the field and chosen with its button, and it is the only
 * thing here that builds the map (issue 262). `onDone` is a person saying
 * they have finished, which only the typed field's own button means. `onPick`
 * and `onDone` were one callback until issue 87, and the row closed on the
 * first colour - so a drag ended on the pointer event that began it.
 *
 * It stays live while something else is reading the project's page. Turning
 * it off would take the focus with it, and refusing its changes would lose
 * a colour moved by an arrow key without a word; `commit` holds the change
 * instead and builds once the way is clear.
 *
 * Exported for its test only; the cell reaches it through `useColourPanel`.
 */
export function ColourPicker({
  colour,
  onPick,
  onPickEnd,
  onDone,
  reset,
}: {
  colour: string
  onPick: (hex: string) => void
  onPickEnd: (hex: string) => void
  onDone: () => void
  reset?: { label: string; enabled: boolean; onReset: () => void }
}): JSX.Element {
  const [text, setText] = useState(colour)
  const [message, setMessage] = useState<string | null>(null)
  const fieldId = useId()
  const messageId = useId()

  // The picker and the field show one colour: a drag moves the value, and
  // the field follows it. Adjusted in the render that sees the colour move,
  // against the colour last followed, so what a person types with nothing
  // moving is kept. Not a `key` on the picker: remounting it at every step
  // of a drag would take focus off its slider after one arrow key.
  const [shownFor, setShownFor] = useState(colour)
  if (colour !== shownFor) {
    setShownFor(colour)
    setText(colour)
    setMessage(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const hex = readHex(text)
    if (hex === null) {
      setMessage('A colour is six hexadecimal digits, such as 0072bc.')
      return
    }
    setMessage(null)
    onPickEnd(hex)
    onDone()
  }

  return (
    <div className="colour-picker">
      <HexColorPicker color={colour} onChange={onPick} onChangeEnd={onPickEnd} />
      <form className="inline-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={fieldId}>Hex value</label>
          <TextInput
            id={fieldId}
            value={text}
            onChange={(value) => {
              setText(value)
              setMessage(null)
            }}
            spellCheck={false}
            aria-describedby={messageId}
            aria-invalid={message ? true : undefined}
          />
          <p id={messageId} className="message error">
            {message}
          </p>
        </div>
        <div className="actions">
          <Button variant="primary" type="submit">
            Use this colour
          </Button>
          {reset !== undefined && (
            <Button aria-label={reset.label} disabled={!reset.enabled} onClick={reset.onReset}>
              Reset
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
