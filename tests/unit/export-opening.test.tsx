// Cell 06's Opening (issue 392, spec 035 FR-001 to FR-005): the select and
// its words, the two durations and what a commit does with what is typed,
// every opening offered whatever view the storyboard opens on, and what a
// change does to the choice the record keeps. The rules are pure
// (`renderer/src/opening.ts`); the markup is rendered to static markup, as
// the other cells' tests are.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ExportOpening from '../../src/renderer/src/ExportOpening'
import { playedBy, usable, type ExportTables } from '../../src/renderer/src/exportChoice'
import {
  OPENING_OPTIONS,
  OPENING_SENTENCE,
  openingOf,
  PREVIEW_NOTE,
  readSeconds,
  SECONDS_FIELDS,
  secondsText,
  withOpening,
  withSeconds,
} from '../../src/renderer/src/opening'
import type { ExportChoice } from '../../src/shared/export'
import type { Preset, Storyboard, StoryboardBeat } from '../../src/shared/protocol'

const beat = (over: Partial<StoryboardBeat> & { secs: number }): StoryboardBeat => ({
  view: null,
  labels: null,
  at: null,
  speed: null,
  sweep: false,
  hours: null,
  span: null,
  tween: null,
  ...over,
})

const board = (name: string, first: Partial<StoryboardBeat>): Storyboard => ({
  name,
  views: '',
  seconds: 8,
  geographic: false,
  beats: [beat({ secs: 4, at: '06:00', speed: 120, ...first }), beat({ secs: 4, view: 'map' })],
})

const MAP = board('tour', { view: 'map' })
const ROWS = board('run', { view: 'linear' })

const GIF: ExportChoice = { preset: 'linkedin-gif', options: {} }

const render = (choice: ExportChoice): string =>
  renderToStaticMarkup(<ExportOpening choice={choice} locked={false} onChange={() => {}} />)

const options = (html: string): string[] =>
  [...html.matchAll(/<option value="([^"]+)"( disabled="")?>([^<]*)<\/option>/g)].map(
    ([, value, disabled, words]) => `${value}${disabled ? ' (disabled)' : ''}: ${words}`,
  )

describe('the Opening select', () => {
  it('offers the four in the issue’s words, in order, none of them disabled', () => {
    // Mutation: the draw-ins disabled again, as they were before the engine
    // was found to take them before a storyboard that opens on the rows.
    for (const opening of [undefined, 'card', 'draw-in', 'card-then-draw-in'] as const) {
      const html = render(opening === undefined ? GIF : { ...GIF, opening })
      expect(html).toContain('label="Opening"')
      expect(options(html), String(opening)).toEqual([
        'none: None',
        'card: Title card',
        'draw-in: The network drawing in',
        'card-then-draw-in: Title card, then the network drawing in',
      ])
      expect(html).toContain(`<p class="message">${OPENING_SENTENCE}</p>`)
    }
    // No opening, no durations.
    const none = render(GIF)
    expect(none).not.toContain('for="export-card"')
    expect(none).not.toContain('for="export-draw-in"')
  })

  it('shows the stored opening as it is', () => {
    expect(openingOf({ ...GIF, opening: 'card-then-draw-in' })).toBe('card-then-draw-in')
    expect(openingOf(GIF)).toBe('none')
    const html = render({ ...GIF, opening: 'card-then-draw-in' })
    expect(html).toContain('for="export-card"')
    expect(html).toContain('for="export-draw-in"')
  })
})

describe('the two durations', () => {
  it('appear for the opening that needs each, with the rule under each', () => {
    // The kit's field takes its id and its value from the page, after a
    // render, so the static markup shows the label, the rule and the
    // description's reference; what the field shows is `secondsText`.
    const card = render({ ...GIF, opening: 'card' })
    expect(card).toContain('<label for="export-card">Card</label>')
    expect(card).toContain(
      'How long the title card stays up: 1 to 10 seconds, 2 unless you change it.',
    )
    expect(card).toContain('aria-describedby="export-card-message"')
    expect(card).not.toContain('for="export-draw-in"')

    const both = render({ ...GIF, opening: 'card-then-draw-in', cardSecs: 4 })
    expect(both).toContain('<label for="export-card">Card</label>')
    expect(both).toContain('<label for="export-draw-in">Draw-in</label>')
    expect(both).toContain(
      'How long the network takes to draw itself in: 2 to 20 seconds, 6 unless you change it.',
    )

    const drawIn = render({ ...GIF, opening: 'draw-in', drawInSecs: 12.5 })
    expect(drawIn).not.toContain('for="export-card"')
    expect(drawIn).toContain('for="export-draw-in"')
  })

  it('show the choice’s seconds, or the default where it holds none', () => {
    expect(secondsText(4, SECONDS_FIELDS.cardSecs.range)).toBe('4')
    expect(secondsText(undefined, SECONDS_FIELDS.cardSecs.range)).toBe('2')
    expect(secondsText(undefined, SECONDS_FIELDS.drawInSecs.range)).toBe('6')
    expect(secondsText(12.5, SECONDS_FIELDS.drawInSecs.range)).toBe('12.5')
  })

  it('read a number in the range, a decimal included, and an emptied field as the default', () => {
    expect(readSeconds('3', 'cardSecs')).toEqual({ ok: true, seconds: 3 })
    expect(readSeconds(' 2.5 ', 'cardSecs')).toEqual({ ok: true, seconds: 2.5 })
    expect(readSeconds('10', 'cardSecs')).toEqual({ ok: true, seconds: 10 })
    expect(readSeconds('', 'cardSecs')).toEqual({ ok: true, seconds: null })
    expect(readSeconds('20', 'drawInSecs')).toEqual({ ok: true, seconds: 20 })
  })

  it('refuse a number outside the range, or text that is not one, in the field’s own sentence', () => {
    // Mutation: the card's range read as the draw-in's - 12 seconds of card taken.
    for (const typed of ['0.5', '10.5', '12', 'two', '1e1', '-3'])
      expect(readSeconds(typed, 'cardSecs'), typed).toEqual({
        ok: false,
        problem: 'A title card lasts from 1 to 10 seconds.',
      })
    for (const typed of ['1.5', '21', 'six'])
      expect(readSeconds(typed, 'drawInSecs'), typed).toEqual({
        ok: false,
        problem: 'A draw-in lasts from 2 to 20 seconds.',
      })
    expect(SECONDS_FIELDS.cardSecs.refused).toBe('A title card lasts from 1 to 10 seconds.')
  })
})

describe('what a change writes', () => {
  it('removes the opening for None, and keeps the durations across a change of opening', () => {
    const chosen = withOpening({ ...GIF, cardSecs: 4 }, 'card')
    expect(chosen).toEqual({ ...GIF, opening: 'card', cardSecs: 4 })
    const none = withOpening(chosen, 'none')
    expect(none).toEqual({ ...GIF, cardSecs: 4 })
    expect(none).not.toHaveProperty('opening')
  })

  it('never stores a duration at its default, nor one emptied', () => {
    // Mutation: the default kept - a card of 2 seconds written as one.
    expect(withSeconds({ ...GIF, cardSecs: 5 }, 'cardSecs', 2)).toEqual(GIF)
    expect(withSeconds({ ...GIF, drawInSecs: 9 }, 'drawInSecs', 6)).toEqual(GIF)
    expect(withSeconds({ ...GIF, cardSecs: 5 }, 'cardSecs', null)).toEqual(GIF)
    expect(withSeconds(GIF, 'drawInSecs', 7.5)).toEqual({ ...GIF, drawInSecs: 7.5 })
  })
})

describe('the tab’s reading of a stored choice', () => {
  const gif = {
    name: 'linkedin-gif',
    platform: 'LinkedIn',
    width: 640,
    height: 640,
    kind: 'video',
    format: 'gif',
    view: 'map',
    labels: true,
    storyboard: 'tour',
    fps: 12,
    max_bytes: null,
    frame_top: 0.46,
    safe_zones: false,
    note: '',
  } as Preset & { name: 'linkedin-gif' }
  const tables: ExportTables = { presets: [gif], storyboards: [MAP, ROWS] }

  it('plays the storyboard the choice names, else the preset’s own, and none for a still', () => {
    expect(playedBy(GIF, gif, tables)).toBe(MAP)
    expect(playedBy({ storyboard: 'run' }, gif, tables)).toBe(ROWS)
    expect(playedBy(GIF, { ...gif, kind: 'still' }, tables)).toBeUndefined()
  })

  it('keeps a stored draw-in whatever view the storyboard opens on', () => {
    // Mutation: a draw-in taken out on a storyboard that opens on the rows.
    const stored: ExportChoice = { ...GIF, storyboard: 'run', opening: 'draw-in' }
    expect(usable(stored, tables).choice).toBe(stored)
    const onMap: ExportChoice = { ...GIF, opening: 'card-then-draw-in' }
    expect(usable(onMap, tables).choice).toBe(onMap)
  })

  it('says the opening plays in the export, not the preview', () => {
    expect(PREVIEW_NOTE).toBe(
      'The opening plays in the export and not in the preview, which shows the map it plays over.',
    )
    expect(OPENING_OPTIONS.map((o) => o.value)).toEqual([
      'none',
      'card',
      'draw-in',
      'card-then-draw-in',
    ])
  })
})
