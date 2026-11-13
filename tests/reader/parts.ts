// The screen-reader walkthrough (docs/accessibility.md, "Walking it with a
// screen reader"), one entry per row, keyed by the row's bold name and in
// the record's order (issue 691). Each entry says which row of the screens'
// tables its result belongs to, how much of the row a script reaches, what
// it leaves to a person and why, and, where it reaches anything, the script.
//
// tests/unit/reader-record.test.ts holds every entry to a row of the
// document and every row to an entry, so a row added to the walkthrough
// without a part, or a part whose row was renamed, fails the unit suite
// rather than going quietly unwalked.
//
// The scripts say what to do and where to listen. What is to be heard is
// never typed here: a control's name, role, state, value and description
// are read from the page where focus lands, a sentence from the status or
// the alert that comes to hold it, and the few sentences a row names
// outright are imported from `src/`. A name in a locator says where a
// control is, not what it must sound like. The words VoiceOver may use for
// a role or a state are in one table, `SYNONYMS` in transcript.ts.
//
// Only types are imported from Playwright: this file is read by the unit
// suite, which runs in Node without a browser. The spec hands each script
// a `Ctx` that does the driving and the listening.

import type { Locator, Page } from '@playwright/test'
import { PUT_BACK_SIZES, SIZES_RESET_SAID } from '../../src/renderer/src/putBackWords'
import { EXPORT_ONE, NOTHING_YET } from '../../src/renderer/src/notebook/outputWords'
import { WORDS_SUMMARY } from '../../src/renderer/src/networkWords'
import { END, START, TRIP, WHOLE_NETWORK } from '../../src/renderer/src/tripWords'
import { FIND_A_FEED, SOURCE_HINT } from '../../src/shared/feedHelp'
import { withoutPaths, type Also as ReadingAlso } from './transcript'

export type CellId = 'data' | 'process' | 'frame' | 'style' | 'lines' | 'export'

/** What else a control is to be heard with, beyond its name, role and states. */
export interface Also extends ReadingAlso {
  /** The group, list, dialog or landmark it is in: that container's name and role are wanted too. */
  within?: Locator
  /** Sentences read from the page or imported from `src/` that are to be heard with it. */
  words?: readonly string[]
}

/**
 * A sentence the page says without moving focus: what the statuses and
 * alerts inside `scope` come to hold. `until` says when the thing being
 * listened for has ended (a run's button back); `pick` which of the
 * sentences held is the one wanted.
 */
export interface Said {
  scope: Locator
  pick?: 'all' | 'first' | 'last'
  until?: () => Promise<boolean>
  deadlineMs?: number
}

/** What a key's press is to be heard as. */
export interface After {
  /** Focus lands inside this, and what it lands on is to be heard; `true` wherever it lands. */
  focus?: Locator | true
  also?: Also
  /** Sentences read from the page after the press. */
  words?: () => Promise<readonly string[]>
  said?: Said | readonly Said[]
}

/** What the spec gives a script: every action is heard or deliberately quiet. */
export interface Ctx {
  readonly page: Page
  /** The project the sample card made, by its heading. */
  readonly project: string
  /** Tab onto `target`, from the control before it, and hear it. */
  tab(target: Locator, also?: Also): Promise<void>
  /** Focus put on `target` as the app puts it there (a heading), and heard. */
  focus(target: Locator, also?: Also): Promise<void>
  /** A key pressed where focus is, and what follows heard. */
  press(key: string, after: After): Promise<void>
  /** VoiceOver's own cursor moved on from just before `to` until each text is heard, at most `steps` times. */
  walk(to: Locator, texts: readonly string[], steps: number): Promise<void>
  /**
   * VoiceOver's own cursor moved on into `container` from just before it,
   * until its name and role, and each of `words`, are heard: the context
   * VoiceOver does not say on a Tab inside it.
   */
  walkInto(container: Locator, words: readonly string[], steps: number): Promise<void>
  /**
   * VoiceOver's own cursor moved back from `from` until each text is heard,
   * and the name and role of `within`, the container it walks back out of.
   */
  walkBack(from: Locator, texts: readonly string[], steps: number, within?: Locator): Promise<void>
  /** Mark this moment, to listen back to it. */
  mark(name: string): Promise<void>
  /** Hear what `said` came to hold since the mark, without acting. */
  listen(since: string, said: Said): Promise<void>
  /** Focus has come to rest inside `target` since the mark, and was heard there. */
  landed(target: Locator, since: string, also?: Also): Promise<void>
  /** Done without listening: a control set up, a sheet opened, a value typed. */
  readonly quietly: {
    press(key: string): Promise<void>
    fill(target: Locator, text: string): Promise<void>
    select(target: Locator, value: string): Promise<void>
    focus(target: Locator): Promise<void>
    click(target: Locator): Promise<void>
  }
  /** Wait for a control or a state, with a deadline; listening meanwhile. */
  visible(target: Locator, deadlineMs?: number): Promise<void>
  until(what: string, probe: () => Promise<boolean>, deadlineMs: number): Promise<void>
  /** What the page says, read now. */
  text(target: Locator): Promise<string>
  texts(target: Locator): Promise<string[]>
  description(target: Locator): Promise<string>
  name(target: Locator): Promise<string>
  cellHeading(id: CellId): Locator
  cellGroup(id: CellId): Locator
  /** A cell's whole section, its heading row included. */
  cellSection(id: CellId): Locator
  openCell(id: CellId): Promise<void>
  /** The polite line every job's end is said in. */
  readonly announcer: Locator
}

/**
 * When a script runs. The session is one launch of the app on a fresh
 * profile: the Library as it comes, the sample opened and laid out, the
 * project walked, the Library again, Settings, and the project deleted
 * last. A row runs in the phase its state needs, in the record's order
 * within it.
 */
export const PHASES = [
  'library',
  'open',
  'first layout',
  'project',
  'back',
  'settings',
  'last',
] as const
export type Phase = (typeof PHASES)[number]

interface Common {
  /** The walkthrough row's bold name, its full stop left off. */
  row: string
  /** The start of the Part cell of the screen row whose VoiceOver cell takes the result. */
  table: string
}

export type Part =
  | (Common & { scripted: 'none'; notScripted: string })
  | (Common & { scripted: 'full'; phase: Phase; run: (c: Ctx) => Promise<void> })
  | (Common & {
      scripted: 'part'
      notScripted: string
      phase: Phase
      run: (c: Ctx) => Promise<void>
    })

const MINUTE = 60_000
/** A real layout of the sample on a hosted runner took under a minute (the spike's record); this is generous. */
const LAYOUT_MS = 20 * MINUTE
/** A still export took seconds there. */
const EXPORT_MS = 10 * MINUTE
/** A sheet, a panel or a list arriving. */
const ARRIVE_MS = 30_000

const newProject = (c: Ctx): Locator => c.page.getByRole('button', { name: 'New project' })
const sheet = (c: Ctx): Locator => c.page.getByRole('dialog', { name: 'New project' })
const startFrom = (c: Ctx): Locator => sheet(c).getByRole('group', { name: 'Start from' })
const heading = (c: Ctx): Locator => c.page.getByRole('heading', { level: 1 })
const steps = (c: Ctx): Locator => c.page.getByRole('navigation', { name: 'Steps' })
const skipPastMap = (c: Ctx): Locator =>
  c.page.getByRole('button', { name: 'Skip past the map', exact: true })
const inTheFeed = (c: Ctx): Locator => c.page.getByRole('region', { name: 'In the feed' })
const routesRun = (c: Ctx): Locator => c.page.getByRole('region', { name: 'Where the routes run' })
const layoutRun = (c: Ctx): Locator => c.page.getByRole('region', { name: 'Layout run' })
const serviceDay = (c: Ctx): Locator => c.page.getByRole('region', { name: 'Service day' })
const sizes = (c: Ctx): Locator => c.page.getByRole('region', { name: 'Sizes', exact: true })
const lineColours = (c: Ctx): Locator => c.page.getByRole('region', { name: 'Line colours' })
const inspector = (c: Ctx): Locator => c.page.getByRole('complementary', { name: 'Inspector' })
const jobsToggle = (c: Ctx): Locator => c.page.getByRole('button', { name: /^Jobs, / })

/** The New project sheet, opened without listening if it is not open. */
async function openSheet(c: Ctx): Promise<void> {
  if (await sheet(c).isVisible()) return
  await c.quietly.click(newProject(c))
  await c.visible(sheet(c))
}

/** Each term and value of a description list, in order, as the page shows them. */
const listed = (c: Ctx, list: Locator): Promise<string[]> => c.texts(list.locator('dt, dd'))

export const PARTS: readonly Part[] = [
  // ------------------------------------------------ Header, on every screen
  {
    row: 'Jobs toggle, Settings',
    table: 'Jobs toggle, Settings',
    scripted: 'part',
    phase: 'library',
    notScripted:
      'the toggle pressed and read expanded, Jobs, 1 running while a run goes, and Settings dimmed while Settings is open',
    run: async (c) => {
      await c.tab(jobsToggle(c))
      await c.tab(c.page.getByRole('button', { name: 'Settings', exact: true }))
    },
  },
  {
    row: 'Engine status line',
    table: 'Engine status line',
    scripted: 'part',
    phase: 'library',
    notScripted:
      'the sentences before the engine is ready (Checking the engine… and Starting the engine.), only the last of which is listened for',
    run: async (c) => {
      const status = c.page.getByRole('status', { name: 'Engine' })
      // Said by itself as the app starts: VoiceOver is started before it.
      await c.listen('launch', { scope: status, pick: 'last' })
      // And again with the cursor on it, from the Jobs toggle after it.
      // Run 43471013113: the first step back says "end of Engine status",
      // and the sentence is a step or two further.
      await c.walkBack(jobsToggle(c), [await c.text(status)], 8)
    },
  },
  {
    row: 'Job-end announcement',
    table: 'Job-end announcement',
    scripted: 'part',
    phase: 'first layout',
    notScripted:
      'a second identical job said again, and a run ending while the Library is open (the export row hears a file named in it)',
    run: async (c) => {
      await c.listen('first layout', {
        scope: c.announcer,
        pick: 'first',
        deadlineMs: LAYOUT_MS,
      })
    },
  },
  {
    row: 'The quit question',
    table: 'The quit question (issue 552)',
    scripted: 'none',
    notScripted:
      'the question is asked by a quit or a close of the window during a run, and either answer ends the session the walk runs in or the run it needs (tests/e2e/quit-guard.spec.ts holds its names, focus and Escape)',
  },

  // ------------------------------------------------ The front door (Library)
  {
    row: 'Heading and New project',
    table: 'Heading, and the New project card first among the cards',
    scripted: 'part',
    phase: 'library',
    notScripted: 'the same with projects in the list',
    run: async (c) => {
      await c.focus(heading(c))
      await c.press('Tab', {
        focus: newProject(c),
        also: { within: c.page.getByRole('list', { name: 'Projects' }) },
      })
    },
  },
  {
    row: 'Empty state',
    table: 'Empty state',
    scripted: 'part',
    phase: 'library',
    notScripted: 'a project created from New project, focus back on it and the quiet line gone',
    run: async (c) => {
      const library = c.page.locator('main.library')
      const introduction = library.locator('p[role="status"].prose')
      const quiet = library.locator('.projects-none > p.hint')
      const projectsHeading = library.getByRole('heading', { level: 2 }).first()
      await c.walk(
        introduction,
        [await c.text(introduction), await c.text(projectsHeading), await c.text(quiet)],
        12,
      )
    },
  },
  {
    row: 'Project cards',
    table: 'Your projects: one card each',
    scripted: 'part',
    phase: 'back',
    notScripted:
      'the same card in both of the interface’s themes and with no picture, and the list Projects, which VoiceOver did not name on this Tab',
    run: async (c) => {
      const projects = c.page.getByRole('list', { name: 'Projects' })
      await c.tab(projects.getByRole('button', { name: `Open ${c.project}`, exact: true }), {
        description: true,
      })
    },
  },
  {
    row: 'Sample cards and feed rows (Start a project, Remove)',
    table: 'Sample cities: the same card',
    scripted: 'part',
    phase: 'open',
    notScripted:
      'the headings Sample cities and Your feeds, the list Presets, which VoiceOver does not name on a Tab to a card (it says the card’s own group), and an added feed’s row with its two buttons and its removal',
    run: async (c) => {
      const presets = c.page.getByRole('list', { name: 'Presets' })
      // The sample the acceptance checklist opens, and the spike heard.
      await c.tab(presets.getByRole('button', { name: /^LA Metro Rail,/ }))
      await c.mark('first layout')
      await c.press('Enter', {
        focus: heading(c),
        said: { scope: layoutRun(c), pick: 'first', deadlineMs: 2 * MINUTE },
      })
    },
  },
  {
    row: 'The engine down (issue 562)',
    table: 'Sample cities while the engine is down',
    scripted: 'none',
    notScripted: 'a launch with no engine to start, which this run does not make',
  },
  {
    row: 'New project sheet (A5.6-05)',
    table: 'New project sheet, a listed feed',
    scripted: 'part',
    phase: 'library',
    notScripted: 'Where to find a feed pressed, which opens the browser',
    run: async (c) => {
      await c.tab(newProject(c))
      await c.press('Enter', {
        focus: sheet(c).getByRole('button', { name: 'Cancel', exact: true }),
        also: { within: sheet(c) },
      })
      // A dialog's description is not said as focus enters it (run
      // 43431978278): it is read with VoiceOver's own cursor, back from the
      // first control after it.
      const description = await c.description(sheet(c))
      const findAFeed = sheet(c).getByRole('button', { name: FIND_A_FEED })
      await c.walkBack(findAFeed, [description], 4)
      await c.tab(findAFeed)
      // Where to find a feed is the group's first control, so nothing in
      // the sheet comes before the group to walk into it from (run
      // 43471013113 stopped there): it is walked back out of instead, which
      // run 43471013113 heard as "A feed is a transit agency’s timetable…" /
      // "Start from" / "Start from group".
      await c.walkBack(findAFeed, [SOURCE_HINT], 6, startFrom(c))
      await c.tab(startFrom(c).getByRole('radio', { checked: true }))
      await c.tab(sheet(c).getByRole('combobox', { name: 'Feed' }), { value: true })
      const name = sheet(c).getByRole('textbox', { name: 'Name' })
      await c.tab(name, { value: true })
      const create = sheet(c).getByRole('button', { name: 'Create', exact: true })
      await c.tab(create)
      await c.quietly.fill(name, '')
      await c.quietly.focus(create)
      await c.press('Enter', { focus: name, also: { description: true } })
      await c.press('Escape', { focus: newProject(c) })
    },
  },
  {
    row: 'The sheet, from a zip',
    table: 'New project sheet, a zip chosen',
    scripted: 'part',
    phase: 'library',
    notScripted: 'the platform’s file chooser, and focus back on Choose a zip after it',
    run: async (c) => {
      await openSheet(c)
      await c.tab(startFrom(c).getByRole('radio', { checked: true }))
      await c.press('ArrowDown', {
        focus: startFrom(c).getByRole('radio', { name: 'A GTFS zip on this computer' }),
      })
      await c.tab(sheet(c).getByRole('button', { name: 'Choose a zip' }), { description: true })
    },
  },
  {
    row: 'The sheet, from an address',
    table: 'New project sheet, an address refused',
    scripted: 'full',
    phase: 'library',
    run: async (c) => {
      await openSheet(c)
      const address = startFrom(c).getByRole('radio', { name: 'A feed at an address' })
      await c.quietly.focus(startFrom(c).getByRole('radio', { checked: true }))
      await c.press('ArrowDown', { focus: address })
      const field = sheet(c).getByRole('textbox', { name: 'Feed address' })
      // What a person types, not what is heard.
      await c.quietly.fill(field, 'abc')
      await c.tab(sheet(c).getByRole('button', { name: 'Add the feed' }))
      await c.press('Enter', { focus: field, said: { scope: sheet(c), pick: 'last' } })
      await c.quietly.press('Escape')
    },
  },
  {
    row: "The sheet's progress line",
    table: 'New project sheet, its add running',
    scripted: 'none',
    notScripted: 'a second feed added by address, which this run does not add',
  },
  {
    row: 'Remove-feed confirmation',
    table: 'Remove-feed confirmation',
    scripted: 'none',
    notScripted: 'an added feed to remove, which this run does not add',
  },

  // ------------------------------------- Project: the header, the rail and the map
  {
    row: 'The heading',
    table: "The project's name as the `h1`",
    scripted: 'full',
    phase: 'project',
    run: async (c) => {
      await c.focus(heading(c))
    },
  },
  {
    row: "The notebook's sentence, Run all and Stop",
    table: "The notebook's sentence, Run all and Stop",
    scripted: 'part',
    phase: 'project',
    notScripted:
      'Run all on a project not laid out, its handover to Stop, a failed run said once, and whether the sentence floods speech',
    run: async (c) => {
      const sentence = c.page.locator('p.project-run-state')
      await c.walk(sentence, [await c.text(sentence)], 12)
    },
  },
  {
    row: 'The rail: Steps',
    table: 'Steps: six buttons',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the current step following the scroll',
    run: async (c) => {
      await c.walkInto(steps(c), [], 14)
      await c.tab(steps(c).getByRole('button').first())
      await c.tab(steps(c).getByRole('button').nth(3))
      await c.press('Enter', { focus: c.cellSection('style') })
    },
  },
  {
    row: 'The rail: Outputs',
    table: 'Outputs: a button',
    scripted: 'part',
    phase: 'project',
    notScripted: 'a row per export with its Reveal, and a file since moved or deleted',
    run: async (c) => {
      const outputs = c.page.getByRole('region', { name: 'Outputs', exact: true })
      const exportOne = outputs.getByRole('button', { name: EXPORT_ONE })
      await c.walk(exportOne, [NOTHING_YET], 6)
      await c.tab(exportOne)
      await c.press('Enter', { focus: c.cellSection('export') })
    },
  },
  {
    row: 'Skip past the map',
    table: 'Skip past the map',
    scripted: 'full',
    phase: 'project',
    run: async (c) => {
      await c.tab(skipPastMap(c))
      await c.press('Enter', { focus: c.cellSection('frame') })
    },
  },
  {
    row: 'No map yet',
    table: "The map's block before there is a map",
    scripted: 'part',
    phase: 'first layout',
    notScripted: 'the button that lays it out, and where it sends focus',
    run: async (c) => {
      await c.listen('first layout', {
        scope: c.page.locator('.preview-status'),
        pick: 'last',
        until: async () => (await c.page.locator('.preview[data-map="drawn"]').count()) > 0,
        deadlineMs: LAYOUT_MS,
      })
    },
  },
  {
    row: 'Viewer frame',
    table: "The map's frame, in the column after cell 02",
    scripted: 'part',
    phase: 'project',
    notScripted: 'the engine’s page inside the frame and its own controls',
    run: async (c) => {
      const map = c.page.getByRole('region', { name: 'Map' })
      await c.walkInto(map, [], 6)
      await c.tab(skipPastMap(c))
      await c.press('Tab', { focus: map })
    },
  },

  // --------------------------------------------------------- Project: the cells
  {
    row: "The cells' rows",
    table: 'Six rows, each a plain `<button>`',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the six found by VoiceOver’s heading navigation, and their level',
    run: async (c) => {
      for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const) {
        await c.tab(c.cellHeading(id))
      }
      const day = c.cellHeading('frame')
      await c.tab(day)
      await c.press('Enter', { focus: day })
      await c.press('Enter', { focus: day })
    },
  },
  {
    row: 'The provenance footer',
    table: 'The provenance footer of cells 02, 03 and 06',
    scripted: 'part',
    phase: 'project',
    notScripted: 'cell 06’s footer, which is there only after an export',
    run: async (c) => {
      for (const id of ['process', 'frame'] as const) {
        await c.openCell(id)
        const strip = c.cellSection(id).locator('.cell-footer > dl.cell-provenance')
        const terms = await listed(c, strip)
        // VoiceOver takes some four steps a term ("definition list 8
        // items", "Layout: term (1 of 8)", "Layout", ":", …).
        await c.walk(strip, terms, terms.length * 5 + 8)
      }
    },
  },

  // ------------------------------------------------------------ Cell 01, Data
  {
    row: 'Fields',
    table: 'Fields',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the list while a refused choice’s sentence is up',
    run: async (c) => {
      await c.openCell('data')
      const fields = c.cellSection('data').locator('.cell-body > dl.fields')
      await c.walk(fields, await listed(c, fields), 10)
    },
  },
  {
    row: "Inspect: mode, operator, the feed's entry",
    table: "In the feed: mode, operator, the feed's entry",
    scripted: 'part',
    phase: 'project',
    notScripted:
      'another mode chosen and the feed’s entry put back, and the Operator pop-up button of a feed with several operators',
    run: async (c) => {
      await c.openCell('data')
      const mode = inTheFeed(c).getByRole('combobox', { name: 'Mode' })
      await c.visible(mode, 10 * MINUTE)
      await c.tab(mode, { value: true })
    },
  },
  {
    row: 'Inspect: the two tables',
    table: 'In the feed: the two tables',
    scripted: 'none',
    notScripted:
      'the tables’ cells read with their headers, which VoiceOver’s table commands and the rotor reach',
  },
  {
    row: 'Inspect: sortable headers',
    table: 'In the feed: sortable headers',
    scripted: 'full',
    phase: 'project',
    run: async (c) => {
      await c.openCell('data')
      const routes = inTheFeed(c).getByRole('table', { name: /^Routes/ })
      await c.visible(routes, 10 * MINUTE)
      for (const column of ['Label', 'Label', 'Trips', 'Type']) {
        const header = routes.getByRole('button', { name: column, exact: true })
        await c.tab(header)
        await c.press('Enter', { focus: header })
      }
    },
  },
  {
    row: 'Geographic view',
    table: 'Where the routes run',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the network’s sentences and each line’s stations, the keys on the drawing, and the check from the sentences alone',
    run: async (c) => {
      await c.openCell('data')
      const stage = routesRun(c).getByRole('group', { name: 'Stage', exact: true })
      await c.visible(stage, 10 * MINUTE)
      await c.tab(stage.getByRole('button', { pressed: true }), { within: stage })
      const pan = routesRun(c).getByRole('group', { name: 'Pan and zoom', exact: true })
      await c.tab(pan.getByRole('button').first(), { within: pan })
      await c.tab(routesRun(c).getByRole('group', { name: /^The \S+ stage/ }), {
        description: true,
      })
      const words = routesRun(c).getByRole('button', { name: WORDS_SUMMARY, exact: true })
      await c.tab(words)
      await c.press('Enter', { focus: words })
      await c.press('Enter', { focus: words })
    },
  },
  {
    row: 'Geographic view, while a layout runs',
    table: 'Where the routes run',
    scripted: 'none',
    notScripted: 'a layout watched from cell 01 as it runs, which this run does not make',
  },

  // --------------------------------------------------------- Cell 02, Process
  {
    row: 'Layout run and its progress line',
    table: 'The layout run and its progress line',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the eight stages’ picture at rest, and the sentence of a project never laid out',
    run: async (c) => {
      await c.openCell('process')
      const again = c.page.getByRole('button', { name: 'Lay out again', exact: true })
      const done = async (): Promise<boolean> => (await again.count()) > 0
      await c.tab(again)
      await c.mark('second layout')
      await c.press('Enter', {
        focus: layoutRun(c).getByRole('button', { name: 'Cancel', exact: true }),
        said: [
          { scope: layoutRun(c), pick: 'last', until: done, deadlineMs: LAYOUT_MS },
          { scope: c.announcer, pick: 'first', until: done, deadlineMs: LAYOUT_MS },
        ],
      })
      await c.landed(again, 'second layout')
    },
  },
  {
    row: 'Lay out from scratch… warning',
    table: 'Lay out from scratch… warning',
    scripted: 'part',
    phase: 'project',
    notScripted: 'Lay out from scratch pressed, and the run it starts with focus on Cancel',
    run: async (c) => {
      await c.openCell('process')
      const scratch = c
        .cellSection('process')
        .getByRole('button', { name: /^Lay out from scratch/ })
      const dialog = c.page.getByRole('dialog')
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      await c.tab(scratch)
      await c.press('Enter', { focus: cancel, also: { within: dialog } })
      await c.walkBack(cancel, [await c.description(dialog)], 4)
      await c.quietly.focus(cancel)
      await c.press('Enter', { focus: scratch })
    },
  },
  {
    row: 'Layout tuning',
    table: 'Layout tuning: a closed disclosure',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'another grid chosen, Reset to the defaults with its focus and the button that puts the tuning back',
    run: async (c) => {
      await c.openCell('process')
      const toggle = c.cellSection('process').getByRole('button', { name: /^Layout tuning\b/ })
      await c.tab(toggle)
      await c.press('Enter', { focus: toggle })
      const group = c.page.getByRole('group', { name: 'Layout tuning', exact: true })
      await c.tab(group.getByRole('combobox', { name: 'Grid' }), { value: true })
      const merge = group.getByRole('textbox', { name: 'Merge distance' })
      await c.tab(merge, { value: true, description: true })
      const was = await merge.inputValue()
      // A figure out of range, as a person types it.
      await c.quietly.fill(merge, '600')
      await c.press('Enter', { focus: merge, said: { scope: group, pick: 'last' } })
      // Invalid is not said where focus stays; it is read on coming back.
      await c.tab(merge)
      await c.quietly.fill(merge, was)
      await c.quietly.press('Enter')
      await c.quietly.focus(toggle)
      await c.quietly.press('Enter')
    },
  },
  {
    row: 'The engine log',
    table: 'Engine log: a closed disclosure',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the box scrolled with the arrow keys, and that the box’s name and the disclosure’s are not heard nested in each other',
    run: async (c) => {
      await c.openCell('process')
      const toggle = c.cellSection('process').getByRole('button', { name: /^Engine log\b/ })
      await c.tab(toggle)
      await c.press('Enter', { focus: toggle })
      const group = c.page.getByRole('group', { name: "The engine's log for this run" })
      await c.tab(group.locator('[aria-label="Log lines"]'))
      const copy = group.getByRole('button', { name: /^Copy log: / })
      await c.tab(copy)
      await c.press('Enter', { focus: copy, said: { scope: group, pick: 'last' } })
      await c.quietly.focus(toggle)
      await c.quietly.press('Enter')
    },
  },
  {
    row: 'Diagnostics panel',
    table: 'What the layout had to compromise on',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the table of what the engine measured, read cell by cell',
    run: async (c) => {
      await c.openCell('process')
      const panel = c.page.getByRole('region', { name: 'What the layout had to compromise on' })
      const sentence = panel.locator('p.prose[role="status"]')
      await c.walk(sentence, [await c.text(sentence)], 6)
      const what = panel.getByRole('button', { name: /^What .+ means$/ }).first()
      await c.tab(what, { description: true })
      await c.press('Enter', { focus: what })
      await c.press('Escape', { focus: what })
      const copy = panel.getByRole('button', { name: 'Copy as text' })
      await c.tab(copy)
      await c.press('Enter', { focus: copy, said: { scope: panel, pick: 'last' } })
    },
  },

  // ------------------------------------------------------------- Cell 03, Day
  {
    row: 'Service day and date control',
    table: 'Service day and date control',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the date’s value, which VoiceOver reads a part at a time (11 Month), another day chosen and drawn, the busiest weekday put back, and a date outside the feed refused',
    run: async (c) => {
      await c.openCell('frame')
      const sentence = serviceDay(c).locator('p.prose[role="status"]').first()
      await c.walk(sentence, [await c.text(sentence)], 6)
      await c.tab(serviceDay(c).getByLabel('Draw for another day'))
    },
  },
  {
    row: 'Revert',
    table: 'Revert, while a chosen day is not drawn',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'that the button goes with its own press, and the date’s value, which VoiceOver reads a part at a time',
    run: async (c) => {
      await c.openCell('frame')
      const field = serviceDay(c).getByLabel('Draw for another day')
      const drawn = await field.inputValue()
      const first = await field.getAttribute('min')
      const last = await field.getAttribute('max')
      const other = first !== null && first !== drawn ? first : last
      if (other === null || other === drawn) throw new Error('the date field offers no other day')
      await c.quietly.fill(field, other)
      const revert = serviceDay(c).getByRole('button', { name: /^Revert to / })
      await c.visible(revert, ARRIVE_MS)
      await c.tab(revert)
      await c.press('Enter', { focus: field, said: { scope: serviceDay(c), pick: 'last' } })
    },
  },
  {
    row: 'Transport',
    table: 'Transport: Time of day',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the refusal while a run holds the map, and nothing said on a second press',
    run: async (c) => {
      await c.openCell('frame')
      const transport = c.page.getByRole('region', { name: 'Transport', exact: true })
      const clock = transport.getByRole('slider', { name: 'Time of day' })
      await c.tab(clock, { value: true })
      await c.press('ArrowRight', { focus: clock, also: { value: true } })
      const play = transport.getByRole('button', { name: /^(Play day|Pause)$/ })
      await c.tab(play)
      await c.press('Enter', { focus: play })
      await c.press('Enter', { focus: play })
      await c.tab(transport.getByRole('combobox', { name: 'Speed' }), { value: true })
    },
  },
  {
    row: 'Trip',
    table: 'Trip: Start, End',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the legs read as a list, the same trip chosen again, the same station at both ends, and Tab from Start',
    run: async (c) => {
      await c.openCell('frame')
      const trip = c.page.getByRole('region', { name: TRIP, exact: true })
      const start = trip.getByRole('combobox', { name: START, exact: true })
      const end = trip.getByRole('combobox', { name: END, exact: true })
      const highlighted = trip.locator('[role="option"][aria-selected="true"]')
      await c.tab(start)
      // A letter, as a person types it.
      await c.press('a', { focus: start, said: { scope: trip, pick: 'last' } })
      await c.press('ArrowDown', {
        focus: start,
        words: async () => [await c.text(highlighted)],
      })
      await c.press('Enter', { focus: start, also: { value: true } })
      await c.tab(end)
      await c.quietly.press('ArrowDown')
      await c.press('ArrowDown', { focus: end, words: async () => [await c.text(highlighted)] })
      await c.press('Enter', { focus: end, said: { scope: trip, pick: 'last' } })
      const whole = trip.getByRole('button', { name: WHOLE_NETWORK })
      await c.tab(whole)
      await c.press('Enter', { focus: start })
    },
  },

  // ----------------------------------------------------------- Cell 04, Style
  {
    row: 'Theme switch',
    table: 'Theme switch: two native radios',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'both radios dimmed while a run holds the map, with its sentence and focus on the cell',
    run: async (c) => {
      await c.openCell('style')
      const themes = c.cellSection('style').getByRole('group', {
        name: 'The theme this map is drawn in',
      })
      await c.tab(themes.getByRole('radio', { checked: true }), { within: themes })
      await c.press('ArrowDown', { focus: themes.getByRole('radio', { checked: true }) })
      await c.press('ArrowUp', { focus: themes.getByRole('radio', { checked: true }) })
    },
  },
  {
    row: 'Sizes',
    table: 'Sizes: eight numeric fields',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the sentence about the map’s units, and nothing said while a figure is typed',
    run: async (c) => {
      await c.openCell('style')
      const width = sizes(c).getByRole('textbox', { name: 'Line width' })
      await c.tab(width, { value: true, description: true })
      const was = await width.inputValue()
      // A figure out of range, then one in range, as a person types them.
      await c.quietly.fill(width, '30')
      await c.press('Enter', { focus: width, said: { scope: sizes(c), pick: 'last' } })
      // Read as invalid, with the refusal in its description, on coming back.
      await c.tab(width, { description: true })
      await c.quietly.fill(width, String(Number(was) + 1))
      await c.quietly.press('Enter')
      const reset = sizes(c).getByRole('button', { name: /^Reset to the engine/ })
      await c.until('Reset to the engine’s sizes is offered', () => reset.isEnabled(), ARRIVE_MS)
      await c.tab(reset)
      await c.press('Enter', {
        focus: sizes(c).getByRole('button', { name: PUT_BACK_SIZES, exact: true }),
        words: async () => [SIZES_RESET_SAID],
      })
      await c.press('Enter', { focus: reset })
    },
  },
  {
    row: 'Look, markers, typeface and trains',
    table: 'Sizes, since issue 391',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'a look chosen and the fields read with its numbers, Custom after a change, and the dot size refused',
    run: async (c) => {
      await c.openCell('style')
      await c.tab(sizes(c).getByRole('combobox', { name: 'Look' }), {
        value: true,
        description: true,
      })
      await c.tab(sizes(c).getByRole('combobox', { name: 'Station marker' }), { value: true })
      const trains = sizes(c).getByRole('group', { name: 'Trains' })
      await c.tab(trains.getByRole('textbox', { name: 'Dot size' }), {
        value: true,
        description: true,
        within: trains,
      })
    },
  },

  // ----------------------------------------------------------- Cell 05, Lines
  {
    row: 'Line colours',
    table: 'Line colours',
    scripted: 'part',
    phase: 'project',
    notScripted: 'each row’s sentence of its colour, Reset every line and Put back your colours',
    run: async (c) => {
      await c.openCell('lines')
      const lines = lineColours(c).getByRole('list', { name: 'Lines', exact: true })
      await c.tab(lines.getByRole('button', { name: /^Choose the colour of line / }).first(), {
        within: lines,
      })
    },
  },
  {
    row: 'Colour picker',
    table: 'Colour picker',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the sliders moved, a hex refused, and the panel closing as focus leaves it',
    run: async (c) => {
      await c.openCell('lines')
      const chip = lineColours(c)
        .getByRole('list', { name: 'Lines', exact: true })
        .getByRole('button', { name: /^Choose the colour of line / })
        .first()
      await c.tab(chip)
      await c.press('Enter', { focus: chip })
      const panel = c.page.getByRole('group', { name: /^Colour for line / })
      await c.press('Tab', { focus: panel, also: { within: panel } })
      await c.press('Escape', { focus: chip })
    },
  },
  {
    row: 'Line options',
    table: 'Line options: a disclosure',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the name refused, a casing chosen, a line hidden, and Reset line',
    run: async (c) => {
      await c.openCell('lines')
      const toggle = lineColours(c)
        .getByRole('button', { name: /^Line options for line / })
        .first()
      await c.tab(toggle)
      await c.press('Enter', { focus: toggle })
      const group = c.page.getByRole('group', { name: /^Line options for line / }).first()
      await c.tab(group.getByRole('textbox', { name: 'Name' }), { description: true })
      await c.tab(group.getByRole('switch', { name: 'Shown', exact: true }), { description: true })
      await c.tab(group.getByRole('combobox', { name: 'Width' }), { value: true })
      await c.quietly.focus(toggle)
      await c.quietly.press('Enter')
    },
  },
  {
    row: 'Line order',
    table: 'Line order, and its drag',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the list Lines in the order they are drawn, which VoiceOver did not name on a Tab to its buttons, a line moved to the end with focus handed to its up button, and the grip, which must not be heard',
    run: async (c) => {
      await c.openCell('lines')
      const order = c.page.getByRole('region', { name: 'Line order' })
      const list = order.getByRole('list')
      const down = list.getByRole('button', { name: /^Move line .* down$/ }).first()
      const name = await c.name(down)
      await c.tab(down)
      await c.press('Enter', {
        focus: list.getByRole('button', { name, exact: true }),
        said: { scope: order, pick: 'last' },
      })
      const back = order.getByRole('button', { name: 'Back to alphabetical' })
      await c.tab(back)
      await c.press('Enter', {
        focus: c.cellSection('lines'),
        said: { scope: order, pick: 'last' },
      })
    },
  },

  // ---------------------------------------------------------- Cell 06, Export
  {
    row: 'Preset, storyboard, view, quality',
    table: 'Preset, storyboard, view, quality',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the presets’ groups by platform, and a JPEG still with Quality dimmed',
    run: async (c) => {
      await c.openCell('export')
      const cell = c.cellGroup('export')
      for (const name of ['Preset', 'Storyboard', 'Quality']) {
        await c.tab(cell.getByRole('combobox', { name, exact: true }), { value: true })
      }
    },
  },
  {
    row: 'Frame switches, lines to keep',
    table: 'Frame switches, lines to keep',
    scripted: 'part',
    phase: 'project',
    notScripted: 'the sentence of Lines to keep',
    run: async (c) => {
      await c.openCell('export')
      const shows = c.cellGroup('export').getByRole('group', { name: 'What the frame shows' })
      const boxes = await shows.getByRole('checkbox').all()
      for (const [at, box] of boxes.entries()) {
        await c.tab(box, at === 0 ? { within: shows } : {})
      }
      const keep = c.cellGroup('export').getByRole('group', { name: 'Lines to keep' })
      await c.tab(keep.getByRole('checkbox').first(), { within: keep })
    },
  },
  {
    row: 'Start time, filename tag',
    table: 'Start time, filename tag',
    scripted: 'part',
    phase: 'project',
    notScripted: 'Start time, which a still shows, and its refusal',
    run: async (c) => {
      await c.openCell('export')
      await c.tab(c.cellGroup('export').getByRole('textbox', { name: 'Filename tag' }), {
        description: true,
      })
    },
  },
  {
    row: 'Caption, clock corner, alt text (issue 352)',
    table: 'Caption, Clock corner, Alt text',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the count and the refusal of a long caption and a long alt text, and the sentence after the corner',
    run: async (c) => {
      await c.openCell('export')
      const cell = c.cellGroup('export')
      await c.tab(cell.getByRole('textbox', { name: 'Caption' }), { description: true })
      await c.tab(cell.getByRole('combobox', { name: 'Clock corner' }), { value: true })
      await c.tab(cell.getByRole('textbox', { name: /^Alt text/ }), { description: true })
    },
  },
  {
    row: 'Opening, card and draw-in (issue 392)',
    table: 'Opening, Card and Draw-in',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'its options, the sentence after it, and the Card and Draw-in fields an opening brings',
    run: async (c) => {
      await c.openCell('export')
      await c.tab(c.cellGroup('export').getByRole('combobox', { name: 'Opening' }), {
        value: true,
      })
    },
  },
  {
    row: 'Where it goes',
    table: 'Where it goes: Choose folder',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'the sentence Choose folder is described by, which may name a folder’s path, the platform’s folder chooser, Use the app’s folder, and the refusal of a folder inside the app',
    run: async (c) => {
      await c.openCell('export')
      await c.tab(c.cellGroup('export').getByRole('button', { name: 'Choose folder' }))
    },
  },
  {
    row: 'Export, its progress line, Cancel, Reveal',
    table: 'Export, its progress line, Cancel, Reveal',
    scripted: 'part',
    phase: 'project',
    notScripted:
      'Reveal pressed, which opens the Finder, the tenths of a reel’s frames, a cancelled export, and the description of an export that replaces a file',
    run: async (c) => {
      await c.openCell('export')
      const cell = c.cellGroup('export')
      // A still, which is quick: the checklist's own choice in its step 12.
      await c.quietly.select(
        cell.getByRole('combobox', { name: 'Preset', exact: true }),
        'instagram-post',
      )
      const exportButton = cell.getByRole('button', { name: 'Export', exact: true })
      const reveal = cell.getByRole('button', { name: /^Reveal/ })
      await c.tab(exportButton)
      await c.mark('export')
      await c.press('Enter', {
        focus: c.page
          .getByRole('region', { name: 'Export run', exact: true })
          .getByRole('button', { name: 'Cancel', exact: true }),
        said: {
          scope: c.announcer,
          pick: 'first',
          until: async () => (await reveal.count()) > 0,
          deadlineMs: EXPORT_MS,
        },
      })
      await c.landed(reveal, 'export')
    },
  },
  {
    row: "Cell 06's preview",
    table: "Cell 06's preview frame",
    scripted: 'part',
    phase: 'project',
    notScripted: 'its caption, and what the engine’s page inside it shows',
    run: async (c) => {
      await c.openCell('export')
      const frame = c.cellGroup('export').locator('iframe')
      const title = (await frame.getAttribute('title')) ?? ''
      await c.walk(frame, [title], 8)
      await c.tab(c.cellHeading('export'))
      await c.press('Tab', {
        focus: c.cellGroup('export').getByRole('combobox', { name: 'Preset', exact: true }),
      })
    },
  },

  // ---------------------------------------------------------- Project: the footer
  {
    row: 'Created and Modified',
    table: 'Created and Modified',
    scripted: 'full',
    phase: 'project',
    run: async (c) => {
      const dates = c.page.locator('main.project > dl.fields')
      // From the last control before it, which is cell 06's, through its footer.
      await c.walk(dates, await listed(c, dates), 40)
    },
  },
  {
    row: 'Rename form',
    table: 'Rename form',
    scripted: 'full',
    phase: 'project',
    run: async (c) => {
      const rename = c.page.getByRole('button', { name: 'Rename', exact: true })
      await c.tab(rename)
      await c.press('Enter', { focus: rename })
      const form = c.page.locator('form.inline-form')
      const field = form.getByRole('textbox', { name: 'New name' })
      await c.tab(field, { value: true })
      await c.quietly.fill(field, '')
      const save = form.getByRole('button', { name: 'Save', exact: true })
      await c.tab(save)
      await c.press('Enter', { focus: field, also: { description: true } })
      await c.tab(form.getByRole('button', { name: 'Cancel', exact: true }))
      await c.press('Enter', { focus: rename })
    },
  },
  {
    row: 'Delete confirmation',
    table: 'Delete confirmation',
    scripted: 'part',
    phase: 'last',
    notScripted: 'the status while it deletes, which is too quick to rely on',
    run: async (c) => {
      const remove = c.page.getByRole('button', { name: 'Delete project', exact: true })
      const dialog = c.page.getByRole('dialog')
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
      await c.tab(remove)
      await c.press('Enter', { focus: cancel, also: { within: dialog } })
      await c.walkBack(cancel, [await c.description(dialog)], 4)
      await c.tab(dialog.getByRole('button', { name: 'Delete', exact: true }))
      await c.press('Enter', { focus: heading(c) })
    },
  },

  // --------------------------------------------------------------- Settings
  {
    row: 'Folder rows',
    table: 'Folder rows',
    scripted: 'part',
    phase: 'settings',
    notScripted:
      'each button’s folder read as its description, since a path is a machine’s and never written into the record, Choose the export folder, which LEGIBLE_EXPORT_FOLDER fixes for this run so it is not offered, another folder chosen in the platform’s dialog, and the engine folder’s size as it is measured',
    run: async (c) => {
      const settings = c.page.getByRole('button', { name: 'Settings', exact: true })
      await c.tab(settings)
      await c.press('Enter', { focus: heading(c) })
      const folders = c.page.getByRole('region', { name: 'Folders' })
      await c.tab(folders.getByRole('button', { name: 'Choose the engine data folder' }))
    },
  },
  {
    row: 'Logs, Copy diagnostics',
    table: 'Logs, Copy diagnostics',
    scripted: 'part',
    phase: 'settings',
    notScripted: 'Open logs folder, which opens the Finder',
    run: async (c) => {
      const logs = c.page.getByRole('region', { name: 'Logs and diagnostics' })
      const copy = logs.getByRole('button', { name: 'Copy diagnostics' })
      await c.tab(copy, { description: true })
      await c.press('Enter', { focus: copy, said: { scope: logs, pick: 'last' } })
    },
  },
  {
    row: 'Theme select',
    table: 'Theme select',
    scripted: 'part',
    phase: 'settings',
    notScripted: 'the theme changed and changed back',
    run: async (c) => {
      await c.tab(c.page.getByRole('combobox', { name: 'Theme' }), { value: true })
    },
  },
  {
    row: 'Versions',
    table: 'Versions',
    scripted: 'part',
    phase: 'settings',
    notScripted: 'a value that is a folder’s path (ffmpeg’s), which is a machine’s and not wanted',
    run: async (c) => {
      const versions = c.page.getByRole('region', { name: 'Versions' }).locator('dl.fields')
      const said = (await listed(c, versions)).filter((t) => withoutPaths(t) === t)
      await c.walk(versions, said, said.length * 5 + 8)
    },
  },
  {
    row: 'Reset engine data and its confirmation',
    table: 'Reset engine data and its confirmation',
    scripted: 'none',
    notScripted: 'the reset, which ends the sitting, with a run going and without',
  },
  {
    row: 'Licences section (issue 108)',
    table: 'Licences section (issue 108)',
    scripted: 'part',
    phase: 'settings',
    notScripted:
      'the list of components and their licences, and the presses, which open other apps',
    run: async (c) => {
      const licences = c.page.getByRole('region', { name: 'Licences' })
      await c.tab(licences.getByRole('button', { name: 'Open the notices' }))
    },
  },
  {
    row: 'Bundled tools rows (A6-02)',
    table: 'Bundled tools rows (A6-02)',
    scripted: 'full',
    phase: 'settings',
    run: async (c) => {
      const tools = c.page.getByRole('region', { name: 'Bundled tools' })
      const texts = [
        await c.text(tools.getByRole('heading').first()),
        await c.text(tools.getByRole('status').first()),
        ...(await listed(c, tools.locator('dl'))),
      ]
      // From Theme, the last control before it, through Versions.
      await c.walk(tools.getByRole('heading').first(), texts, 110)
    },
  },

  // ------------------------------------------------------------ Jobs inspector
  {
    row: 'Toggle, heading, Close, Escape',
    table: 'Toggle, heading, Close, Escape',
    scripted: 'full',
    phase: 'settings',
    run: async (c) => {
      await c.tab(jobsToggle(c))
      await c.press('Enter', {
        focus: inspector(c).getByRole('heading', { level: 2 }).first(),
        also: { within: inspector(c) },
      })
      await c.tab(inspector(c).getByRole('button', { name: 'Close the inspector' }))
      await c.press('Escape', { focus: jobsToggle(c) })
    },
  },
  {
    row: 'Jobs: progress line, Cancel, Copy log, Details',
    table: 'Jobs: progress line, Cancel, Copy log, Details',
    scripted: 'part',
    phase: 'settings',
    notScripted:
      'each job’s item and picture, Cancel on a running job with focus on its heading, and Details',
    run: async (c) => {
      if (!(await inspector(c).isVisible())) await c.quietly.click(jobsToggle(c))
      await c.visible(inspector(c))
      const copy = inspector(c)
        .getByRole('button', { name: /^Copy log: / })
        .first()
      await c.tab(copy)
      await c.press('Enter', { focus: copy, said: { scope: inspector(c), pick: 'last' } })
      await c.quietly.press('Escape')
    },
  },
  {
    row: 'Below 900px, over the main region',
    table: 'Below 900px, over the main region',
    scripted: 'none',
    notScripted: 'a narrowed window, read with VoiceOver’s own navigation around the inert region',
  },

  // --------------------------------------------------------------- First-run dialog
  {
    row: 'The dialog: its details disclosure, Copy diagnostics, How to install, OK',
    table: 'The dialog: its details disclosure',
    scripted: 'none',
    notScripted: 'the dialog, which opens only on a launch with LOOM missing',
  },
  {
    row: 'Focus after it closes',
    table: 'Focus after it closes',
    scripted: 'none',
    notScripted: 'the dialog, which opens only on a launch with LOOM missing',
  },
  {
    row: 'Waiting for another dialog',
    table: 'Waiting for another dialog',
    scripted: 'none',
    notScripted: 'the dialog, which opens only on a launch with LOOM missing',
  },

  // --------------------------------------------------------------- Mismatch dialog
  {
    row: 'The dialog and OK',
    table: 'The dialog and OK',
    scripted: 'none',
    notScripted: 'the dialog, which opens only with another engine version installed',
  },
]
