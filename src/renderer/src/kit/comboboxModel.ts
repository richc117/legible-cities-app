// The combobox's behaviour, with no React and no document in it (issue 272,
// spec 030 FR-003): what typing, a key and a press do to what the field shows,
// whether its popup is open and which option is highlighted. `Combobox.tsx`
// is then only a screen over this, and the behaviour is a unit test.
//
// The pattern is the APG's "list autocomplete with manual selection": the
// popup lists every option whose label contains what has been typed, and
// nothing is chosen until a person chooses it - Enter on the highlighted
// option, or a press on one. DOM focus never leaves the field; the highlight
// is `aria-activedescendant`, which the component sets from `active`.
//
// One rule decides what the field holds, and it is why `typed` is nullable.
// While a person is typing, the field shows what they typed and the choice
// is whatever it was before; when they stop - a choice made, Tab, a press
// elsewhere - it shows the chosen option's label again, which is the
// previous one when the caller refused the choice. So a refusal never leaves
// a field saying one station while the section holds another, and the only
// edit that changes the choice without choosing is emptying the field.

/** One thing the popup offers: what it is, and the words it is listed and shown in. */
export interface ComboboxOption {
  id: string
  label: string
}

/** Where a combobox stands between two renders. */
export interface ComboboxState {
  /**
   * What a person has typed since they last chose, or null while the field
   * shows the chosen option's label (or nothing, when none is chosen).
   */
  typed: string | null
  /** Whether the popup is wanted open. It shows only while something matches. */
  open: boolean
  /** The highlighted option, by its place among the matches; null for none. */
  active: number | null
}

/** A field at rest: the chosen label, the popup shut, nothing highlighted. */
export const AT_REST: ComboboxState = { typed: null, open: false, active: null }

/**
 * Text as it is compared: case-folded, so "alp" finds "Alpha". `toLowerCase`
 * rather than the locale's, so the same letters match on every machine.
 */
export const fold = (text: string): string => text.toLowerCase()

/**
 * Every option whose label contains the text, in the order given, and never
 * a capped list (spec 030's edge case: four hundred stations are all
 * offered, and the popup scrolls). Empty text matches everything.
 */
export function matching(
  options: readonly ComboboxOption[],
  text: string,
): readonly ComboboxOption[] {
  if (text === '') return options
  const needle = fold(text)
  return options.filter((option) => fold(option.label).includes(needle))
}

/** What the field shows: what was typed, or the chosen option's label. */
export function shownText(state: ComboboxState, chosenLabel: string): string {
  return state.typed ?? chosenLabel
}

/** The highlight, held inside the matches as they are now; null when it is not. */
export function activeWithin(state: ComboboxState, count: number): number | null {
  return state.active !== null && state.active >= 0 && state.active < count ? state.active : null
}

/** What the popup is listing: the matches of what was typed, or every option before any typing. */
export function listed(
  state: ComboboxState,
  options: readonly ComboboxOption[],
): readonly ComboboxOption[] {
  return matching(options, state.typed ?? '')
}

/** Whether the popup is showing: wanted open, with something in it. */
export function expanded(state: ComboboxState, count: number): boolean {
  return state.open && count > 0
}

/**
 * A keystroke that changed the text. The popup opens on any text and shuts
 * on none, nothing is highlighted until an arrow asks for it (manual
 * selection), and an emptied field is the one edit that clears the choice.
 */
export function typedIn(text: string): { state: ComboboxState; clear: boolean } {
  return { state: { typed: text, open: text !== '', active: null }, clear: text === '' }
}

/** The part of a key event the model reads. */
export interface KeyPress {
  key: string
  altKey: boolean
}

/**
 * What one key did: the state after it, the option it chose if it chose
 * one, and whether the component should keep the key from the platform.
 */
export interface Keyed {
  state: ComboboxState
  accept: string | null
  handled: boolean
}

/**
 * A key pressed in the field, over the matches as they are now.
 *
 * - Down opens the popup on the first match, or moves the highlight to the
 *   next; Alt+Down opens it with nothing highlighted. On the last match it
 *   stays.
 * - Up opens it on the last match, or moves to the previous; on the first
 *   it stays. Alt+Up shuts it.
 * - Enter chooses the highlighted match, and shuts the popup. With nothing
 *   highlighted it does nothing: the choice is a person's to make.
 * - Escape shuts the popup and leaves what was typed. With the popup shut
 *   it does nothing at all.
 * - Tab shuts the popup and is left to the platform, so focus moves on.
 *
 * Home, End and the rest move the caret in the field, as the APG has them.
 */
export function keyed(
  state: ComboboxState,
  press: KeyPress,
  matches: readonly ComboboxOption[],
): Keyed {
  const count = matches.length
  const last = count === 0 ? null : count - 1
  const active = activeWithin(state, count)
  const unchanged: Keyed = { state, accept: null, handled: false }
  switch (press.key) {
    case 'ArrowDown': {
      if (press.altKey) return { state: { ...state, open: true }, accept: null, handled: true }
      const next =
        !state.open || active === null ? (count === 0 ? null : 0) : Math.min(active + 1, count - 1)
      return { state: { ...state, open: true, active: next }, accept: null, handled: true }
    }
    case 'ArrowUp': {
      if (press.altKey)
        return { state: { ...state, open: false, active: null }, accept: null, handled: true }
      const next = !state.open || active === null ? last : Math.max(active - 1, 0)
      return { state: { ...state, open: true, active: next }, accept: null, handled: true }
    }
    case 'Enter': {
      if (!state.open || active === null) return unchanged
      return { state: AT_REST, accept: matches[active].id, handled: true }
    }
    case 'Escape': {
      if (!state.open) return unchanged
      return { state: { ...state, open: false, active: null }, accept: null, handled: true }
    }
    case 'Tab':
      return { state: { ...state, open: false, active: null }, accept: null, handled: false }
    default:
      return unchanged
  }
}

/** A press on one of the popup's options: that one is chosen, and the field is at rest. */
export function pressed(matches: readonly ComboboxOption[], index: number): Keyed {
  const option = matches[index]
  if (option === undefined) return { state: AT_REST, accept: null, handled: false }
  return { state: AT_REST, accept: option.id, handled: true }
}

/**
 * Focus left the field: the popup shuts and the field shows the choice
 * again, so a half-typed name a person walked away from is not taken for
 * one they chose.
 */
export const left = (): ComboboxState => AT_REST
