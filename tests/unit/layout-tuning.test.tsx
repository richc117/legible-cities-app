// Cell 02's Layout tuning (issue 385, spec 033): what a layout run sends
// `graph.build` for a tuning, and what the section draws and does with what
// is typed. The wire form and the commit rules are pure (`tuningRules.ts`);
// the markup is rendered to static markup, as the other cells' tests are.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LayoutTuning from '../../src/renderer/src/LayoutTuning'
import {
  askedWith,
  chooseGrid,
  commitTuningField,
  describeTuningField,
  gridOptions,
  layoutTuning,
  notSaved,
  OWN_KEYS,
  PENALTY_LEGEND,
  PENALTY_SENTENCE,
  RESET_LABEL,
  resettable,
  TUNING_LABELS,
  TUNING_SENTENCE,
  tunedProject,
  tuningNotice,
  tuningParams,
  tuningViewOf,
  tuningWord,
  type TuningView,
} from '../../src/renderer/src/tuningRules'
import {
  DEFAULT_TUNING,
  TUNING_KEYS,
  type ProjectRecord,
  type ProjectTuning,
  type TuningKey,
} from '../../src/shared/project'

describe('what graph.build is sent for a tuning', () => {
  it('is nothing at all for a project that never tuned, or tuned to LOOM’s own', () => {
    // Mutation: `layoutTuning` answers `{}` for none - an untuned request
    // then carries an empty `tuning`, which no untuned project ever sent.
    expect(tuningParams(undefined)).toEqual({})
    expect(tuningParams({})).toEqual({})
    expect(tuningParams({ ...DEFAULT_TUNING })).toEqual({})
    expect(layoutTuning({})).toBeNull()
  })

  it('is the fields the record holds, in the engine’s names, the penalties in their own object', () => {
    expect(
      layoutTuning({
        mergeDistance: 80,
        grid: 'hexalinear',
        gridSize: 50,
        deg45: 3,
        deg90: 1.5,
        deg180: 1,
        diagonal: 0,
      }),
    ).toEqual({
      merge_distance: 80,
      grid: 'hexalinear',
      grid_size: 50,
      // 90° at LOOM's own 1.5 is no choice and is not sent.
      penalties: { deg45: 3, deg180: 1, diagonal: 0 },
    })
  })

  it('sends no penalties object where no penalty is held', () => {
    expect(layoutTuning({ grid: 'orthoradial' })).toEqual({ grid: 'orthoradial' })
    expect(tuningParams({ gridSize: 200 })).toEqual({ tuning: { grid_size: 200 } })
  })

  it('tells the store what was sent, in the record’s names, and nothing for none', () => {
    expect(askedWith({ grid: 'ortholinear', deg45: 2 })).toEqual({
      tuning: { grid: 'ortholinear' },
    })
    expect(askedWith(undefined)).toEqual({})
    expect(askedWith({ ...DEFAULT_TUNING })).toEqual({})
  })
})

// ---- the section's rules, without rendering

const view = (tuning: ProjectTuning = {}): TuningView => tuningViewOf(tuning)
const typed = (from: TuningView, key: TuningKey, text: string): TuningView => ({
  ...from,
  drafts: { ...from.drafts, [key]: text },
})

describe('what a field says', () => {
  it('names each number, in the order the section draws them', () => {
    expect(TUNING_KEYS.map((key) => TUNING_LABELS[key])).toEqual([
      'Merge distance',
      'Grid size',
      '45°',
      '90°',
      '135°',
      '180°',
      'Diagonal',
    ])
    expect(OWN_KEYS).toEqual(['mergeDistance', 'gridSize'])
  })

  it('is described by its range, with its unit, and LOOM’s own number', () => {
    // Mutation: the default read from TUNING_RANGES' high in place of
    // DEFAULT_TUNING - every sentence then names the top of the range.
    expect(describeTuningField('mergeDistance')).toBe('5 to 500 metres. LOOM’s own is 50.')
    expect(describeTuningField('gridSize')).toBe(
      '25 to 400 percent of the distance between adjacent stations. LOOM’s own is 100.',
    )
    expect(describeTuningField('deg45')).toBe('0 to 10. LOOM’s own is 2.')
    expect(describeTuningField('deg90')).toBe('0 to 10. LOOM’s own is 1.5.')
    expect(describeTuningField('deg135')).toBe('0 to 10. LOOM’s own is 1.')
    expect(describeTuningField('deg180')).toBe('0 to 10. LOOM’s own is 0.')
    expect(describeTuningField('diagonal')).toBe('0 to 10. LOOM’s own is 0.5.')
  })

  it('shows the record’s number, else LOOM’s own', () => {
    expect(view().drafts).toEqual({
      mergeDistance: '50',
      gridSize: '100',
      deg45: '2',
      deg90: '1.5',
      deg135: '1',
      deg180: '0',
      diagonal: '0.5',
    })
    expect(view({ gridSize: 50 }).drafts.gridSize).toBe('50')
  })
})

describe('committing a field', () => {
  it('takes a number inside the range, and keeps only what is away from LOOM’s own', () => {
    expect(commitTuningField(typed(view(), 'deg45', '3'), 'deg45').tuning).toEqual({ deg45: 3 })
    const back = commitTuningField(typed(view({ deg45: 3 }), 'deg45', '2'), 'deg45')
    expect(back.tuning, 'LOOM’s own is no choice').toEqual({})
    expect(back.drafts.deg45).toBe('2')
  })

  it('refuses a number outside the range in the engine’s sentence, keeps it as typed, and moves nothing', () => {
    // Mutation: `commitTuningField` judges only that the text is a number -
    // 600 is then taken, and the tuning moves.
    const refused = commitTuningField(
      typed(view({ deg90: 3 }), 'mergeDistance', '600'),
      'mergeDistance',
    )
    expect(refused.tuning).toEqual({ deg90: 3 })
    expect(refused.problems).toEqual({
      mergeDistance: 'tuning.merge_distance must be from 5 to 500, in metres',
    })
    expect(refused.drafts.mergeDistance).toBe('600')
    expect(refused.drafts.deg90).toBe('3')
  })

  it('refuses what is not a number in the same sentence', () => {
    for (const text of ['big', '1e2', '0x10', '1,5'])
      expect(commitTuningField(typed(view(), 'gridSize', text), 'gridSize').problems, text).toEqual(
        {
          gridSize:
            'tuning.grid_size must be from 25 to 400, as a percentage of the distance between adjacent stations',
        },
      )
  })

  it('puts an emptied field back to LOOM’s own, and the record holds nothing for it', () => {
    const emptied = commitTuningField(
      typed(view({ mergeDistance: 80 }), 'mergeDistance', ' '),
      'mergeDistance',
    )
    expect(emptied.tuning).toEqual({})
    expect(emptied.drafts.mergeDistance).toBe('50')
  })

  it('clears a refusal once the field is mended, or typed back to what it holds', () => {
    const refused = commitTuningField(typed(view(), 'deg180', '11'), 'deg180')
    expect(refused.problems.deg180).toBeDefined()
    expect(commitTuningField(typed(refused, 'deg180', '1'), 'deg180').problems).toEqual({})
    expect(commitTuningField(typed(refused, 'deg180', '0'), 'deg180').problems).toEqual({})
  })

  it('reads only the field committed', () => {
    const elsewhere = typed(view(), 'deg45', 'nonsense')
    expect(commitTuningField(typed(elsewhere, 'deg90', '4'), 'deg90')).toMatchObject({
      tuning: { deg90: 4 },
      problems: {},
    })
  })

  it('keeps a refused number through a record arriving for another reason', () => {
    const refused = commitTuningField(typed(view(), 'diagonal', '20'), 'diagonal')
    const after = tuningViewOf({ grid: 'ortholinear' }, refused)
    expect(after.drafts.diagonal).toBe('20')
    expect(after.problems.diagonal).toBe(refused.problems.diagonal)
    expect(after.tuning).toEqual({ grid: 'ortholinear' })
  })

  it('keeps a number being typed through another field’s write landing, or a run ending', () => {
    // Mutation: `tuningViewOf` keeps only refused drafts - the number half
    // typed in 90° is then replaced by the record's as 45°'s write lands.
    const typing = typed(commitTuningField(typed(view(), 'deg45', '3'), 'deg45'), 'deg90', '2.')
    const landed = tuningViewOf({ deg45: 3 }, typing)
    expect(landed.drafts.deg90).toBe('2.')
    expect(landed.drafts.deg45, 'the committed number is the record’s').toBe('3')
    expect(landed.problems).toEqual({})
    // A draft that says what the record now holds is the record's.
    expect(tuningViewOf({ deg90: 2 }, typed(view(), 'deg90', '2')).drafts.deg90).toBe('2')
  })

  it('chooses a grid, LOOM’s own being no choice', () => {
    expect(chooseGrid(view({ deg45: 3 }), 'orthoradial').tuning).toEqual({
      grid: 'orthoradial',
      deg45: 3,
    })
    expect(chooseGrid(view({ grid: 'hexalinear' }), 'octilinear').tuning).toEqual({})
  })
})

describe('Reset, and what the row says', () => {
  it('can be pressed while anything is chosen or a refused number waits, and not otherwise', () => {
    // Mutation: `resettable` reads only the tuning - Reset is then not
    // pressable to clear a refused number.
    expect(resettable(view())).toBe(false)
    expect(resettable(view({ grid: 'hexalinear' }))).toBe(true)
    expect(resettable(commitTuningField(typed(view(), 'deg45', '99'), 'deg45'))).toBe(true)
  })

  it('says LOOM’s defaults until something is chosen, and tuned after', () => {
    // Mutation: `tuningWord` answers from `tuning !== undefined` - a record
    // holding `{}` then reads tuned.
    expect(tuningWord(undefined)).toBe('LOOM’s defaults')
    expect(tuningWord({})).toBe('LOOM’s defaults')
    expect(tuningWord({ ...DEFAULT_TUNING })).toBe('LOOM’s defaults')
    expect(tuningWord({ gridSize: 50 })).toBe('tuned')
  })

  it('offers the engine’s four grids, each with its gloss, LOOM’s own marked', () => {
    expect(gridOptions()).toEqual([
      { grid: 'octilinear', label: 'octilinear (eight directions; LOOM’s own)' },
      { grid: 'ortholinear', label: 'ortholinear (four directions)' },
      { grid: 'orthoradial', label: 'orthoradial (rings and spokes)' },
      { grid: 'hexalinear', label: 'hexalinear (six directions)' },
    ])
  })

  it('says a refused write in one sentence, with the store’s reason', () => {
    expect(notSaved(new Error('read-only'))).toBe('The tuning was not saved: read-only.')
    expect(notSaved(new Error('The engine data is being reset; wait for it to finish.'))).toBe(
      'The tuning was not saved: The engine data is being reset; wait for it to finish.',
    )
  })
})

describe('what cell 02 says of a layout of another tuning', () => {
  const LAYOUT = 'a'.repeat(64)

  it('says what to do and why while the tuning would send other than the layout was asked with', () => {
    // Mutation: `tuningNotice` compares the two by reference - a record whose
    // `tuning` and `laidOutWith` agree as values then reads stale.
    expect(tuningNotice({ layout: LAYOUT, tuning: { grid: 'orthoradial' } })).toBe(
      'Lay out again to use this tuning: the map on screen was laid out with LOOM’s defaults.',
    )
    expect(
      tuningNotice({ layout: LAYOUT, tuning: { gridSize: 50 }, laidOutWith: { gridSize: 200 } }),
    ).toBe('Lay out again to use this tuning: the map on screen was laid out with another tuning.')
    expect(tuningNotice({ layout: LAYOUT, laidOutWith: { deg45: 3 } })).toBe(
      'Lay out again to use LOOM’s defaults: the map on screen was laid out with another tuning.',
    )
  })

  it('says nothing while they agree, or before there is a layout', () => {
    expect(tuningNotice({ layout: LAYOUT })).toBeNull()
    expect(
      tuningNotice({ layout: LAYOUT, tuning: { deg45: 3 }, laidOutWith: { deg45: 3 } }),
    ).toBeNull()
    expect(tuningNotice({ layout: LAYOUT, tuning: { grid: 'octilinear' } })).toBeNull()
    expect(tuningNotice({ layout: null, tuning: { grid: 'hexalinear' } })).toBeNull()
  })
})

// ---- the section's markup

/** The section as it is drawn for a record, closed, as a project opens on it. */
const drawn = (tuning?: ProjectTuning): string =>
  renderToStaticMarkup(
    <LayoutTuning
      project={{ id: 'kq7x2mzp4dna', tuning } as unknown as ProjectRecord}
      onChange={async () => {}}
    />,
  )

describe('the section as it is drawn', () => {
  it('is a closed disclosure whose toggle sits in an h3, disclosing a group named Layout tuning', () => {
    // Mutation: `heading="h3"` removed - there is then no heading for Reset
    // to hand focus to, and this fails.
    const html = drawn()
    expect(html).toMatch(
      /^<div class="layout-tuning"><h3 class="disclosure-heading" tabindex="-1"><button type="button" class="layout-tuning-toggle" aria-expanded="false"/,
    )
    expect(html).toMatch(/<div id="[^"]+" role="group" aria-label="Layout tuning" hidden=""/)
  })

  it('says LOOM’s defaults on its row for a record that holds no tuning, and tuned for one that does', () => {
    // The span, not the word: the grid's option says "LOOM’s own" too.
    expect(drawn()).toContain(
      'Layout tuning <span class="layout-tuning-word">LOOM’s defaults</span></button></h3>',
    )
    expect(drawn({ grid: 'hexalinear' })).toContain(
      'Layout tuning <span class="layout-tuning-word">tuned</span></button></h3>',
    )
  })

  it('offers the grid as the kit’s native select named Grid, with the four options in order', () => {
    const html = drawn()
    expect(html).toContain('<fig-dropdown label="Grid">')
    const options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(
      (found) => [found[1], found[2]],
    )
    expect(options).toEqual(gridOptions().map(({ grid, label }) => [grid, label]))
  })

  it('names every number by its label and describes it by its range and LOOM’s own', () => {
    // Mutation: a field's `aria-describedby` dropped - its range is then
    // drawn but not said with the field.
    const html = drawn()
    const labels = [...html.matchAll(/<label for="([^"]*)">([^<]*)<\/label>/g)]
    expect(labels.map((found) => found[2])).toEqual(TUNING_KEYS.map((key) => TUNING_LABELS[key]))
    for (const [, id] of labels) {
      expect(html).toContain(`<fig-input-text aria-describedby="${id}-range">`)
      expect(html).toMatch(new RegExp(`<p id="${id}-range" class="message">[^<]+LOOM’s own is`))
    }
  })

  it('puts the five penalties in a group of their own, said what they are', () => {
    const html = drawn()
    const group = html.slice(html.indexOf('<fieldset'), html.indexOf('</fieldset>'))
    expect(group).toContain(`<legend>${PENALTY_LEGEND}</legend>`)
    expect(group).toContain(PENALTY_SENTENCE)
    expect([...group.matchAll(/<label for="[^"]*">([^<]*)<\/label>/g)].map((m) => m[1])).toEqual([
      '45°',
      '90°',
      '135°',
      '180°',
      'Diagonal',
    ])
  })

  it('says what the tuning is first, and draws one button, Reset, and no slider', () => {
    const html = drawn({ deg45: 3 })
    expect(html).toContain(`<p class="prose">${TUNING_SENTENCE}</p>`)
    expect([...html.matchAll(/<fig-button[^>]*>([^<]*)<\/fig-button>/g)].map((m) => m[1])).toEqual([
      RESET_LABEL,
    ])
    expect(RESET_LABEL).toBe('Reset to LOOM’s defaults')
    expect(html).not.toMatch(/type="range"|fig-slider/)
  })
})

describe('the screen’s project once a tuning is written', () => {
  const LAYOUT = 'a'.repeat(64)
  const screen = {
    id: 'kq7x2mzp4dna',
    layout: LAYOUT,
    tuning: { grid: 'hexalinear' },
    laidOutWith: { grid: 'hexalinear' },
    readOnly: false,
  } as unknown as ProjectRecord & { readOnly: boolean }

  it('loses a tuning the record no longer holds, which is what Reset leaves', () => {
    // Mutation: `tunedProject` merges as the other writers do
    // (`{ ...project, ...record }`) - the reset tuning then stays on the
    // screen, the cell says the layout is behind, and the next run sends it.
    const answered = { id: 'kq7x2mzp4dna', layout: LAYOUT } as unknown as ProjectRecord
    const after = tunedProject(screen, answered)
    expect(after).not.toHaveProperty('tuning')
    expect(after).not.toHaveProperty('laidOutWith')
    expect(after.readOnly, 'what the screen adds is kept').toBe(false)
    expect(tuningNotice(after)).toBeNull()
  })

  it('takes a tuning the record holds, and keeps the screen’s own field', () => {
    const answered = {
      id: 'kq7x2mzp4dna',
      layout: LAYOUT,
      tuning: { deg45: 3 },
      laidOutWith: { grid: 'hexalinear' },
    } as unknown as ProjectRecord
    const after = tunedProject({ ...screen, readOnly: true }, answered)
    expect(after.tuning).toEqual({ deg45: 3 })
    expect(after.laidOutWith).toEqual({ grid: 'hexalinear' })
    expect(after.readOnly).toBe(true)
  })
})
