// What a draw of a record sends, for the tests that make a record drawn by
// hand (spec 037). Since part 1 of the record session the store makes `drawn`
// from what a run's `map.build` was sent, carried by every completion, and
// never from the record at the write; a test that writes a completion
// through the store or the bridge hands it this, and a test that builds a
// drawn record as a fixture builds its block from it.

import type { LayoutDone, LayoutResult } from '../../src/shared/layout'
import { drawnFromSent } from '../../src/main/record/drawn'
import { sentSet } from '../../src/renderer/src/record'
import { drawnDate } from '../../src/shared/project/helpers'
import {
  type DrawnFrom,
  type LineOrder,
  type Palette,
  type ProjectLines,
  type ProjectRecord,
  type ProjectStyle,
  type RebuildDone,
  type SentSet,
} from '../../src/shared/project/types'
import type { Station } from '../../src/shared/trip'

/** The fields of a record a draw reads; anything else is ignored. */
type Drawable = Pick<
  ProjectRecord,
  'layout' | 'made' | 'date' | 'colors' | 'defaultColor' | 'lineOrder' | 'style' | 'lines'
>

/**
 * What a draw of this record as it stands would send: its layout and
 * `made`, its day, and its palette, order, style and line options, each
 * overridden where a test says so (the layout a run has just answered, the
 * day a rebuild draws, the palette a recolour draws).
 */
export function sentOf(
  record: Partial<Drawable>,
  overrides: Partial<Omit<SentSet, 'lines'>> & { lines?: ProjectRecord['lines'] } = {},
): SentSet {
  const layout = overrides.layout ?? record.layout
  const date = overrides.date ?? record.date
  if (layout == null || date == null) throw new Error('a draw needs a layout and a day')
  return sentSet({
    layout,
    made: overrides.made !== undefined ? overrides.made : (record.made ?? null),
    date,
    palette: {
      colors: overrides.colors ?? record.colors ?? {},
      defaultColor: overrides.defaultColor ?? record.defaultColor ?? '#888888',
    },
    order: overrides.lineOrder ?? record.lineOrder ?? [],
    style: overrides.style ?? record.style ?? {},
    lines: 'lines' in overrides ? overrides.lines : record.lines,
  })
}

/**
 * The block a draw of this record as it stands would leave: what it would
 * send, the record's theme, and the stations its last draw kept while the
 * layout is the one they were listed for. Null for a record with no layout,
 * which has drawn nothing. What `drawnFrom` answered before spec 037, for
 * the fixtures that build a record whose map shows it.
 */
export function drawnOf(
  record: Drawable & Pick<ProjectRecord, 'theme' | 'drawn'>,
): DrawnFrom | null {
  if (record.layout === null) return null
  // A record with no day of its own drew none: a block from before the day
  // was resolved (ADR-031) says so with null, which no sent set can hold.
  const drawn = drawnFromSent(
    sentOf(record, { date: record.date ?? '1970-01-01' }),
    record.theme,
    record.drawn,
  )
  return record.date === null ? { ...drawn, date: null } : drawn
}

/** The store's six completions, as a test calls them. */
interface Completions {
  get(id: string): Promise<ProjectRecord>
  completeLayout(id: string, done: LayoutDone): Promise<LayoutResult>
  completeRebuild(id: string, done: RebuildDone): Promise<ProjectRecord>
  completeColors(
    id: string,
    palette: Palette,
    sent: SentSet,
    stations?: Station[],
  ): Promise<ProjectRecord>
  completeOrder(
    id: string,
    order: LineOrder,
    sent: SentSet,
    stations?: Station[],
  ): Promise<ProjectRecord>
  completeStyle(
    id: string,
    style: ProjectStyle,
    sent: SentSet,
    stations?: Station[],
  ): Promise<ProjectRecord>
  completeLines(
    id: string,
    lines: ProjectLines,
    sent: SentSet,
    stations?: Station[],
  ): Promise<ProjectRecord>
}

/**
 * The store's completions as a run makes them, for a test that writes one by
 * hand and has no run: each reads the record first, as a run reads it at its
 * start, and sends what a draw of it would - the layout run's own layout,
 * `made` and day; the rebuild's day; the redraw's own choice beside the rest,
 * for the day the map already shows. A test about what is sent hands the
 * store its own set instead.
 */
export function drawsOn(store: Completions) {
  const read = (id: string) => store.get(id)
  // A record with nothing to draw from still gets a set of the right shape,
  // so the store's own refusal of it ("lay the project out first") is what a
  // test sees, as it is what a renderer that got that far would see.
  const redraw = async (id: string, overrides: Parameters<typeof sentOf>[1]) => {
    const record = await read(id)
    return sentOf(record, {
      layout: record.layout ?? '0'.repeat(64),
      date: drawnDate(record) ?? '1970-01-01',
      ...overrides,
    })
  }
  return {
    completeLayout: async (
      id: string,
      done: Omit<LayoutDone, 'sent'> & { sent?: SentSet },
    ): Promise<LayoutResult> =>
      store.completeLayout(id, {
        ...done,
        sent:
          done.sent ??
          sentOf(await read(id), { layout: done.layout, made: done.made, date: done.date }),
      }),
    completeRebuild: async (
      id: string,
      done: { date: string; stations?: Station[] },
    ): Promise<ProjectRecord> =>
      store.completeRebuild(id, {
        sent: await redraw(id, { date: done.date }),
        ...(done.stations === undefined ? {} : { stations: done.stations }),
      }),
    completeColors: async (id: string, palette: Palette, stations?: Station[]) =>
      store.completeColors(
        id,
        palette,
        await redraw(id, { colors: palette.colors, defaultColor: palette.defaultColor }),
        stations,
      ),
    completeOrder: async (id: string, order: LineOrder, stations?: Station[]) =>
      store.completeOrder(id, order, await redraw(id, { lineOrder: order }), stations),
    completeStyle: async (id: string, style: ProjectStyle, stations?: Station[]) =>
      store.completeStyle(id, style, await redraw(id, { style }), stations),
    completeLines: async (id: string, lines: ProjectLines, stations?: Station[]) =>
      store.completeLines(id, lines, await redraw(id, { lines }), stations),
  }
}
