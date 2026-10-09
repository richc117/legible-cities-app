// The kit's combobox (issue 272, spec 030 FR-003): the APG's list
// autocomplete with manual selection, as a model with no document in it and
// a screen drawn over the model.
//
// What a person would meet is all in the model: which options a few letters
// find, what each key does to the highlight and the popup, and when a choice
// is made. The screen is checked for the attributes the pattern is made of,
// rendered to static markup as the other kit tests are; what a running
// browser does with them is the end-to-end suite's (`tests/e2e/trip.spec.ts`
// and the notebook's sweep).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Combobox from '../../src/renderer/src/kit/Combobox'
import {
  AT_REST,
  expanded,
  keyed,
  listed,
  matching,
  pressed,
  shownText,
  typedIn,
  type ComboboxOption,
  type ComboboxState,
} from '../../src/renderer/src/kit/comboboxModel'

/** The stand-in engine's three stations, as `map.build` lists them: by name, then id. */
const STATIONS: ComboboxOption[] = [
  { id: '0x6000036f4a40', label: 'Alpha' },
  { id: '0x6000036f4c80', label: 'Bravo' },
  { id: '0x6000036f4010', label: 'Charlie' },
]

const labels = (options: readonly ComboboxOption[]): string[] => options.map((o) => o.label)

const press = (key: string, altKey = false): { key: string; altKey: boolean } => ({ key, altKey })

/** Typing `text` into a field at rest. */
const typing = (text: string): ComboboxState => typedIn(text).state

describe('which options a few letters find', () => {
  it('finds every option whose name contains them, case-folded, anywhere in the name', () => {
    expect(labels(matching(STATIONS, 'alp'))).toEqual(['Alpha'])
    expect(labels(matching(STATIONS, 'LPH'))).toEqual(['Alpha'])
    // Inside the name and not only at its start: a prefix match finds
    // nothing for these.
    expect(labels(matching(STATIONS, 'rav'))).toEqual(['Bravo'])
    expect(labels(matching(STATIONS, 'ha'))).toEqual(['Alpha', 'Charlie'])
    expect(labels(matching(STATIONS, 'a'))).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(labels(matching(STATIONS, 'zulu'))).toEqual([])
  })

  it('lists every match of a long list, never a capped one', () => {
    // Four hundred stations, every one of which holds the letters typed
    // (spec 030's edge case): all four hundred are offered, in order.
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `n${i}`,
      label: `Station ${String(i).padStart(3, '0')}`,
    }))
    const found = matching(many, 'tat')
    expect(found).toHaveLength(400)
    expect(found[399].id).toBe('n399')
  })

  it('offers everything before anything is typed', () => {
    expect(labels(matching(STATIONS, ''))).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(labels(listed(AT_REST, STATIONS))).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('lists two stations with one name as two options, each by its id, in the list’s order', () => {
    const twins = [
      { id: 'b', label: 'Times Sq' },
      { id: 'a', label: 'Times Sq' },
    ]
    expect(matching(twins, 'times').map((o) => o.id)).toEqual(['b', 'a'])
  })
})

describe('typing', () => {
  it('opens the popup on what was typed, highlighting nothing until an arrow asks', () => {
    expect(typedIn('alp')).toEqual({
      state: { typed: 'alp', open: true, active: null },
      clear: false,
    })
  })

  it('clears the choice when the field is emptied, and shuts the popup', () => {
    expect(typedIn('')).toEqual({ state: { typed: '', open: false, active: null }, clear: true })
  })

  it('shows what was typed while typing, and the choice once at rest', () => {
    expect(shownText(typing('Cha'), 'Alpha')).toBe('Cha')
    expect(shownText(AT_REST, 'Alpha')).toBe('Alpha')
    expect(shownText(AT_REST, '')).toBe('')
  })
})

describe('the keys', () => {
  const all = STATIONS

  it('Down opens on the first match and moves on, staying on the last', () => {
    let state = AT_REST
    state = keyed(state, press('ArrowDown'), all).state
    expect(state).toMatchObject({ open: true, active: 0 })
    state = keyed(state, press('ArrowDown'), all).state
    expect(state.active).toBe(1)
    state = keyed(state, press('ArrowDown'), all).state
    state = keyed(state, press('ArrowDown'), all).state
    expect(state.active, 'the last stays the last').toBe(2)
  })

  it('Up opens on the last match and moves back, staying on the first', () => {
    let state = keyed(AT_REST, press('ArrowUp'), all).state
    expect(state).toMatchObject({ open: true, active: 2 })
    state = keyed(state, press('ArrowUp'), all).state
    state = keyed(state, press('ArrowUp'), all).state
    state = keyed(state, press('ArrowUp'), all).state
    expect(state.active, 'the first stays the first').toBe(0)
  })

  it('Alt+Down opens with nothing highlighted, and Alt+Up shuts', () => {
    const open = keyed(AT_REST, press('ArrowDown', true), all)
    expect(open.state).toMatchObject({ open: true, active: null })
    expect(open.handled).toBe(true)
    expect(keyed(open.state, press('ArrowUp', true), all).state).toMatchObject({
      open: false,
      active: null,
    })
  })

  it('Enter chooses the highlighted match and puts the field at rest', () => {
    const typed = typing('a')
    const matches = listed(typed, all)
    const down = keyed(typed, press('ArrowDown'), matches).state
    const second = keyed(down, press('ArrowDown'), matches).state
    const enter = keyed(second, press('Enter'), matches)
    expect(enter.accept).toBe('0x6000036f4c80')
    expect(enter.state).toEqual(AT_REST)
    expect(enter.handled).toBe(true)
  })

  it('Enter with nothing highlighted chooses nothing: the choice is a person’s', () => {
    const typed = typing('alp')
    const enter = keyed(typed, press('Enter'), listed(typed, all))
    expect(enter.accept).toBeNull()
    expect(enter.handled).toBe(false)
    expect(enter.state).toBe(typed)
  })

  it('Escape shuts the popup and leaves what was typed; shut, it does nothing', () => {
    const typed = keyed(typing('br'), press('ArrowDown'), listed(typing('br'), all)).state
    const escape = keyed(typed, press('Escape'), listed(typed, all))
    expect(escape.state).toEqual({ typed: 'br', open: false, active: null })
    expect(escape.handled).toBe(true)
    expect(escape.accept).toBeNull()
    const again = keyed(escape.state, press('Escape'), [])
    expect(again.handled).toBe(false)
    expect(again.state).toBe(escape.state)
  })

  it('Tab shuts the popup, chooses nothing, and is left to the platform', () => {
    const typed = keyed(typing('a'), press('ArrowDown'), all).state
    const tab = keyed(typed, press('Tab'), all)
    expect(tab.handled).toBe(false)
    expect(tab.accept).toBeNull()
    expect(tab.state).toMatchObject({ open: false, active: null })
  })

  it('leaves every other key to the field', () => {
    for (const key of ['Home', 'End', 'a', 'Backspace', 'ArrowLeft']) {
      const outcome = keyed(typing('a'), press(key), all)
      expect(outcome.handled, key).toBe(false)
      expect(outcome.accept, key).toBeNull()
    }
  })

  it('a press on an option chooses it', () => {
    expect(pressed(STATIONS, 2)).toEqual({
      state: AT_REST,
      accept: '0x6000036f4010',
      handled: true,
    })
    expect(pressed(STATIONS, 9).accept).toBeNull()
  })

  it('shows the popup only while something matches', () => {
    expect(expanded(typing('zz'), 0)).toBe(false)
    expect(expanded(typing('a'), 3)).toBe(true)
    expect(expanded(AT_REST, 3)).toBe(false)
  })
})

describe('the field, drawn', () => {
  const draw = (props: Partial<Parameters<typeof Combobox>[0]> = {}): string =>
    renderToStaticMarkup(
      <Combobox
        label="Start"
        options={STATIONS}
        value={null}
        onChoose={() => undefined}
        onClear={() => undefined}
        countWords={(n) => `${n} stations match`}
        {...props}
      />,
    )

  it('is the pattern’s field: a combobox with a list popup it controls', () => {
    const html = draw()
    const input = /<input[^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toContain('role="combobox"')
    expect(input).toContain('aria-autocomplete="list"')
    expect(input).toContain('aria-expanded="false"')
    // The platform's own suggestions would cover the popup.
    expect(input).toMatch(/autocomplete="off"/i)
    // Nothing is highlighted at rest, so nothing is named as the active option.
    expect(input).not.toContain('aria-activedescendant')
    // It never disables (FR-011).
    expect(input).not.toContain('disabled')
    const controls = /aria-controls="([^"]+)"/.exec(input)?.[1]
    const inputId = /\bid="([^"]+)"/.exec(input)?.[1]
    expect(controls).toBeTruthy()
    // The popup is the element it names: a listbox, a manual popover, named
    // by the same label as the field.
    const list = new RegExp(`<ul[^>]*id="${controls}"[^>]*>`).exec(html)?.[0] ?? ''
    expect(list).toContain('role="listbox"')
    expect(list).toContain('popover="manual"')
    const labelId = /aria-labelledby="([^"]+)"/.exec(list)?.[1]
    expect(html).toContain(`<label id="${labelId}" for="${inputId}">Start</label>`)
    // The polite line, empty at rest.
    expect(html).toContain('<p class="visually-hidden" role="status" aria-live="polite"></p>')
  })

  it('shows the chosen option’s name, and describes the field with a refusal beside it', () => {
    const html = draw({ value: '0x6000036f4c80', message: 'Start and end are the same station.' })
    const input = /<input[^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toContain('value="Bravo"')
    expect(input).toContain('aria-invalid="true"')
    const describedBy = /aria-describedby="([^"]+)"/.exec(input)?.[1]
    expect(html).toContain(
      `<p id="${describedBy}" class="message error" role="alert">Start and end are the same station.</p>`,
    )
  })
})
