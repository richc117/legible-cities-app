// The name the New project sheet writes when the engine's feed list arrives
// after the sheet has opened (issue 263).
//
// The sheet's own opening is not in question here; this is the one write it
// makes that nobody asked for. A name typed "as the sheet opens" landed
// beside the one the arrival wrote ("LA Metro RailLos Angeles"): the arrival
// asked only whether a keystroke had been seen, and a hand on the field is
// there before the first keystroke - a click into it, or a test's fill, which
// focuses and selects the empty field and inserts its text a moment later.
//
// The unit environment has no DOM, so the field below is a model of what
// Chromium does with a value written from outside and with text inserted,
// the two facts the defect depends on. Both were read off the real component
// and the real kit in headless Chromium (a value set from outside puts the
// caret at the end of it and drops the selection; inserted text replaces the
// selection or lands at the caret), and the sheet's own wiring, which reads
// focus through the field's handle and writes the page through it in the turn
// it decides, is what tests/e2e/feeds.spec.ts drives in the built app.

import { describe, expect, it } from 'vitest'
import { arrivalName } from '../../src/renderer/src/NewProjectSheet'

/** A text field, as far as this defect goes: its text, its selection, whether it is in a hand. */
class Field {
  value = ''
  private start = 0
  private end = 0
  focused = false
  /** What the sheet calls `edited`: an input event has been seen. */
  typed = false

  /** What a fill does first: focus the field, then select what is there. */
  startFill(): void {
    this.focused = true
    this.start = 0
    this.end = this.value.length
  }

  /** What a click does: focus the field and place the caret, here at the end of what is there. */
  click(): void {
    this.focused = true
    this.start = this.end = this.value.length
  }

  release(): void {
    this.focused = false
  }

  /** A value written from outside: the caret goes to its end and the selection is gone. */
  write(value: string): void {
    this.value = value
    this.start = this.end = value.length
  }

  /** Text inserted where the caret or the selection is; the input event follows it. */
  insert(text: string): void {
    this.value = this.value.slice(0, this.start) + text + this.value.slice(this.end)
    this.start = this.end = this.start + text.length
    this.typed = true
  }

  /** The feed list arrives and the sheet asks what it may write. */
  arrives(feedName: string | null): void {
    const filled = arrivalName(this.typed, this.focused, feedName)
    if (filled !== null) this.write(filled)
  }
}

describe('the name written when the feed list arrives after the sheet opened', () => {
  it('leaves a name typed before it arrived alone: the typed name, and nothing beside it', () => {
    const field = new Field()
    field.startFill()
    field.arrives('LA Metro Rail')
    field.insert('Los Angeles')
    expect(field.value).toBe('Los Angeles')
  })

  it('leaves a field a person clicked into alone, so their first words are the whole name', () => {
    const field = new Field()
    field.click()
    field.arrives('LA Metro Rail')
    field.insert('Los Angeles')
    expect(field.value).toBe('Los Angeles')
  })

  it('leaves a name typed key by key alone, whichever key the list arrives after', () => {
    const field = new Field()
    field.click()
    field.insert('Los')
    field.arrives('LA Metro Rail')
    field.insert(' Angeles')
    expect(field.value).toBe('Los Angeles')
  })

  it('leaves a name typed and then left alone, even when the hand has gone from the field', () => {
    const field = new Field()
    field.click()
    field.insert('Los Angeles')
    field.release()
    field.arrives('LA Metro Rail')
    expect(field.value).toBe('Los Angeles')
  })

  it('fills a field no one has touched, as it always did', () => {
    const field = new Field()
    field.arrives('LA Metro Rail')
    expect(field.value).toBe('LA Metro Rail')
    expect(field.typed).toBe(false)
  })

  it('is replaced by a fill after it arrived, as it always was', () => {
    const field = new Field()
    field.arrives('LA Metro Rail')
    field.startFill()
    field.insert('Los Angeles')
    expect(field.value).toBe('Los Angeles')
  })

  it('fills a field a hand came to and left without typing, since nothing of theirs is in it', () => {
    const field = new Field()
    field.click()
    field.release()
    field.arrives('LA Metro Rail')
    expect(field.value).toBe('LA Metro Rail')
  })

  it('has nothing to write when the list holds no name for the feed', () => {
    const field = new Field()
    field.arrives(null)
    expect(field.value).toBe('')
  })
})

describe('arrivalName', () => {
  it('is the feed’s name for a field no one has touched, and nothing otherwise', () => {
    expect(arrivalName(false, false, 'Caltrain')).toBe('Caltrain')
    expect(arrivalName(true, false, 'Caltrain')).toBeNull()
    expect(arrivalName(false, true, 'Caltrain')).toBeNull()
    expect(arrivalName(true, true, 'Caltrain')).toBeNull()
    expect(arrivalName(false, false, null)).toBeNull()
  })
})
