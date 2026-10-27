// @vitest-environment jsdom
// Cell 06's form (issue 433, part b): every field from Preset to Alt text,
// drawn by `renderPanel` with the kit real, and pressed and typed into as a
// person does. What a field changes is read from what the form hands
// `change`; what it shows, from the document. The ids, classes and names
// asserted here are the ones the end-to-end suite and the gate documents
// find cell 06 by.

import { act, createRef, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportForm, { useExportDrafts } from '../../src/renderer/src/export/ExportForm'
import {
  defaultsFor,
  offeredOf,
  playedBy,
  toggledLines,
  withOption,
  withPreset,
  type ExportTables,
} from '../../src/renderer/src/exportChoice'
import { CAPTION_MAX, type ExportChoice } from '../../src/shared/export'
import type { Preset, Storyboard } from '../../src/shared/protocol'
import { answered, byName, cleanup, INSPECTION, renderPanel } from '../support/render'

afterEach(cleanup)

const preset = (over: Partial<Preset> & Pick<Preset, 'name'>): Preset => ({
  platform: 'Instagram',
  width: 1080,
  height: 1920,
  kind: 'video',
  format: 'mp4',
  view: 'map',
  labels: true,
  storyboard: 'tour',
  fps: 30,
  max_bytes: null,
  frame_top: 0.46,
  safe_zones: false,
  note: '',
  ...over,
})

const board = (name: string): Storyboard => ({
  name,
  views: 'map -> linear',
  seconds: 9,
  geographic: false,
  beats: [],
})

/** A still, a JPEG still, a reel, and two storyboards. */
const TABLES: ExportTables = {
  presets: offeredOf([
    preset({ name: 'instagram-post', kind: 'still', format: 'png', storyboard: null }),
    preset({
      name: 'linkedin',
      platform: 'LinkedIn',
      kind: 'still',
      format: 'jpg',
      storyboard: null,
    }),
    preset({ name: 'instagram-reel', safe_zones: true }),
  ]),
  storyboards: [board('tour'), board('morph')],
}

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }
const POST: ExportChoice = { preset: 'instagram-post', options: {} }
const LINES = ['A', 'B', 'C']

const rowOf = (choice: ExportChoice) => {
  const row = TABLES.presets.find((p) => p.name === choice.preset)
  if (row === undefined) throw new Error(`no ${choice.preset} in the fixture`)
  return row
}

/** The form for `choice`, its changes handed to a spy. */
async function draw(choice: ExportChoice, { locked = false } = {}) {
  const change = vi.fn<(next: ExportChoice) => void>()
  const row = rowOf(choice)
  function Form(): JSX.Element {
    // The drafts held above the form, as the composition holds them.
    const drafts = useExportDrafts(choice, null)
    return (
      <ExportForm
        projectId="kq7x2mzp4dna"
        tables={TABLES}
        preset={row}
        defaults={defaultsFor(row)}
        choice={choice}
        drafts={drafts}
        locked={locked}
        lines={LINES}
        inspection={INSPECTION}
        played={playedBy(choice, row, TABLES)}
        change={change}
        choicesRef={createRef()}
        refusal={null}
        notes={[]}
      >
        <p>Where it goes</p>
      </ExportForm>
    )
  }
  const view = renderPanel(<Form />)
  // The kit copies a select's options into its own as its slot changes.
  await answered()
  return { view, change }
}

/** A choice made on the select named `name`, as a person makes it. */
function choose(name: string, value: string): void {
  const select = byName('combobox', name) as HTMLSelectElement
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Text typed into the field named `name`, one character at a time, as a person types it. */
function type(name: string, text: string): HTMLInputElement | HTMLTextAreaElement {
  const field = byName('textbox', name) as HTMLInputElement | HTMLTextAreaElement
  act(() => field.focus())
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set
  for (let at = 1; at <= text.length; at++)
    act(() => {
      setter?.call(field, text.slice(0, at))
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  return field
}

/** The field left, as a person tabs out of it. */
function leave(field: HTMLElement): void {
  act(() => field.blur())
}

describe('cell 06’s form', () => {
  it('changes the preset through withPreset, once', async () => {
    const { change } = await draw(REEL)
    choose('Preset', 'instagram-post')
    expect(change.mock.calls).toEqual([[withPreset(REEL, 'instagram-post', rowOf(POST))]])
  })

  it('commits a filename tag once, as the field is left, and not per keystroke', async () => {
    // Mutation: the commit moved from the field's `onBlur` to its
    // `onChange` - it is then sent once a character, five times.
    const { change } = await draw(REEL)
    const field = type('Filename tag', 'draft')
    expect(change, 'nothing is written while it is typed').not.toHaveBeenCalled()
    leave(field)
    expect(change.mock.calls).toEqual([
      [withOption(REEL, rowOf(REEL), { key: 'tag', value: 'draft' })],
    ])
  })

  it('writes a caption of 80 characters as the field is left', async () => {
    // Mutation: the caption's commit without `withOption` - nothing is
    // written, and this fails.
    const { change } = await draw(REEL)
    const text = 'x'.repeat(CAPTION_MAX)
    leave(type('Caption', text))
    expect(change.mock.calls).toEqual([
      [withOption(REEL, rowOf(REEL), { key: 'caption', value: text })],
    ])
  })

  it('refuses a caption of 81 characters beside the field, and writes nothing', async () => {
    const { change } = await draw(REEL)
    const field = type('Caption', 'x'.repeat(CAPTION_MAX + 1))
    const host = document.getElementById('export-caption')?.closest('fig-input-text')
    expect(host?.getAttribute('aria-invalid')).toBe('true')
    const message = document.getElementById('export-caption-message')
    expect(message?.className).toBe('message error')
    expect(message?.textContent).toMatch(/^A caption is 1 to 80 characters on one line/)
    leave(field)
    expect(change).not.toHaveBeenCalled()
  })

  it('sends the lines to keep as toggledLines makes them', async () => {
    const { change } = await draw(REEL)
    act(() => byName('checkbox', 'B').click())
    expect(change.mock.calls).toEqual([
      [
        withOption(REEL, rowOf(REEL), {
          key: 'lines',
          value: toggledLines(LINES, undefined, 'B', true),
        }),
      ],
    ])
  })

  it('shows a JPEG still the standard-only quality, and nothing else to choose', async () => {
    await draw({ preset: 'linkedin', options: {} })
    const quality = byName('combobox', 'Quality') as HTMLSelectElement
    expect([...quality.options].map((o) => o.value)).toEqual(['standard'])
    expect(document.body.textContent).toContain(
      'This preset is a JPEG still, which the engine makes at standard quality only.',
    )
  })

  it('draws every control by its name and every field by its id', async () => {
    // A still, which has the view and the start time a reel does not.
    await draw(POST)
    for (const name of ['Preset', 'View', 'Clock corner', 'Quality'])
      expect(byName('combobox', name), name).toBeTruthy()
    for (const name of ['Caption', 'Start time', 'Filename tag', 'Alt text for the file’s sidecar'])
      expect(byName('textbox', name), name).toBeTruthy()
    for (const name of [
      'Station names',
      'The title: city, network and service day',
      'The clock',
      'A',
      'B',
      'C',
    ])
      expect(byName('checkbox', name), name).toBeTruthy()
    for (const id of [
      'export-caption',
      'export-caption-message',
      'export-at',
      'export-at-message',
      'export-tag',
      'export-tag-message',
      'export-alt',
      'export-alt-message',
    ])
      expect(document.getElementById(id), id).not.toBeNull()
    const form = document.querySelector('form')
    expect(form?.className).toBe('export-choices')
    expect(form?.querySelector('fieldset.export-flags legend')?.textContent).toBe(
      'What the frame shows',
    )
    expect(form?.querySelector('fieldset.export-lines legend')?.textContent).toBe('Lines to keep')
    expect(form?.querySelectorAll('.field').length).toBeGreaterThan(0)
    expect(form?.querySelectorAll('label.check').length).toBe(6)
    // What the composition hands it is drawn inside it, last.
    expect(form?.lastElementChild?.previousElementSibling?.textContent).toBe('Where it goes')
  })

  it('draws a reel’s storyboard, its opening and no view or start time', async () => {
    await draw(REEL)
    expect(byName('combobox', 'Storyboard')).toBeTruthy()
    expect(byName('combobox', 'Opening')).toBeTruthy()
    expect(() => byName('combobox', 'View')).toThrow('no combobox named "View"')
    expect(document.getElementById('export-at')).toBeNull()
  })

  it('disables every control while locked', async () => {
    await draw(REEL, { locked: true })
    const form = document.querySelector('form')
    for (const fieldset of form?.querySelectorAll('fieldset') ?? [])
      expect(fieldset.disabled, fieldset.className).toBe(true)
    expect(byName('combobox', 'Preset').closest('fig-dropdown')?.hasAttribute('disabled')).toBe(
      true,
    )
    expect(
      (byName('textbox', 'Alt text for the file’s sidecar') as HTMLTextAreaElement).disabled,
    ).toBe(true)
  })
})
