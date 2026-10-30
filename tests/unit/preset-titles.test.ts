import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OFFERED_PRESETS, PRESET_TITLES, presetTitle } from '../../src/shared/export'
import { outputName, UNNAMED_PRESET } from '../../src/renderer/src/notebook/outputWords'
import type { Preset } from '../../src/shared/protocol'

// A preset is named by its title on screen, never by the engine's id
// (issue 559). The `Record` type makes a missing title a build error; this
// holds the same at run time, where the mutation job (which does not
// typecheck) can see it.

describe('the presets’ titles', () => {
  it('gives every offered preset a title of its own, and nothing else one', () => {
    // Mutation: one entry deleted - that preset is then named by its id.
    expect(Object.keys(PRESET_TITLES).sort()).toEqual([...OFFERED_PRESETS].sort())
    for (const preset of OFFERED_PRESETS) {
      expect(presetTitle(preset), preset).not.toBe(preset)
      expect(presetTitle(preset).trim(), preset).not.toBe('')
    }
    const titles = Object.values(PRESET_TITLES)
    expect(new Set(titles).size, 'no two presets share a title').toBe(titles.length)
  })

  it('says GIF in the title of every GIF, since the chooser says nothing after its size', () => {
    // `presetWords` drops a GIF's format on the strength of this, so a GIF
    // titled without it would read as a still. Which presets are GIFs is
    // the v0.8.2 table's to say, held to the stand-in by `export.test.ts`.
    const table = JSON.parse(
      readFileSync(resolve(__dirname, '../fixtures/export-tables-v0.8.2.json'), 'utf8'),
    ) as { presets: Preset[] }
    const offered = table.presets.filter((preset) =>
      (OFFERED_PRESETS as readonly string[]).includes(preset.name),
    )
    expect(offered.map((preset) => preset.name).sort()).toEqual([...OFFERED_PRESETS].sort())
    const gifs = offered.filter((preset) => preset.format === 'gif')
    expect(gifs.length, 'the table has GIFs to hold').toBeGreaterThan(0)
    for (const gif of gifs) expect(presetTitle(gif.name), gif.name).toContain('GIF')
  })

  it('says a preset the app does not offer by its id, as it was', () => {
    expect(presetTitle('portfolio-gif')).toBe('portfolio-gif')
    expect(presetTitle('')).toBe('')
  })

  it('names an output by its title, its id, or as an export when the sidecar has none', () => {
    expect(outputName('linkedin-gif')).toBe('LinkedIn square GIF')
    expect(outputName('portfolio-mp4')).toBe('portfolio-mp4')
    expect(outputName(null)).toBe(UNNAMED_PRESET)
  })
})
