import type { Diagnostics } from '../../../shared/protocol'
import type { RunReport } from './layoutRun'

// What the engine measured drawing a map, put into words and figures. No
// React here, and no arithmetic on the engine's numbers beyond the two
// shares the engine itself prints: a figure a person reads has to be the
// engine's or it is a second opinion (constitution II). The rule is that
// this file can be called without rendering, and the tests are what that
// buys (.claude/rules/renderer.md).
//
// The vocabulary is the engine's own `schematic/diagnostics.py`, which is
// where the numbers are built once for the terminal, the site and this
// app. Two of its names are worth reading twice: `degraded.skipped_calls`
// counts *trips* that skip an unmatched stop rather than calls, and
// `stops.unmatched` is the first few ids only - at most eight - so the
// number that did not match is not in the block at all. The caveat
// sentences carry it, which is why they are shown verbatim.

/** One line of the table: what was measured, the figure, and what it means. */
export interface Metric {
  /** Stable across renders and the key a test names. */
  id: string
  label: string
  value: string
  /** The explanation the row offers on hover and on focus. */
  explain: string
}

/** A count in the reader's own grouping. */
export function count(n: number): string {
  return n.toLocaleString()
}

/** A share as the engine prints it: a percentage, to as many decimals as asked. */
export function percent(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

/**
 * The engine's issue score as it sent it: a weighted sum of proportions
 * rounded to four decimals, where 0 is clean and nothing rescales it into
 * a percentage - its weights total ten, so it is not one.
 */
export function score(issues: number): string {
  if (!Number.isFinite(issues)) return '—'
  if (issues === 0) return '0'
  const fixed = issues.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return fixed === '0' ? issues.toFixed(4) : fixed
}

/**
 * The share of stops that matched, the way the engine computes it: zero
 * when a feed has no stops at all, rather than a division by nothing.
 */
export function coverage(stops: Diagnostics['stops']): number {
  return stops.total === 0 ? 0 : stops.matched / stops.total
}

/**
 * A few names from a long list, and how many were left. Used for the lines
 * the layout drew and for the unmatched stops it names.
 */
export function few(names: string[], keep = 6): string {
  if (names.length === 0) return 'none'
  if (names.length <= keep) return names.join(', ')
  return `${names.slice(0, keep).join(', ')}, and ${count(names.length - keep)} more`
}

/**
 * A path is not for a screen (constitution V), and the rule that keeps the
 * engine's progress sentences clean applies to anything else it sends.
 * These ids come from a feed and are not paths; an id that looks like one
 * is withheld rather than drawn, which costs an example and nothing else.
 */
export function shownIds(ids: string[]): string[] {
  return ids.filter((id) => id !== '' && !/(^|[\s(])(?:[A-Za-z]:[\\/]|[\\/][^\s\\/])/.test(id))
}

/** The three ways the schedule attaches a feed's stop to a node, weakest last. */
export const MATCHING: { id: string; key: keyof Diagnostics['stops']['by']; label: string }[] = [
  { id: 'by-station-id', key: 'station_id', label: 'Matched by station id' },
  { id: 'by-parent-station', key: 'parent_station', label: 'Matched by parent station' },
  { id: 'by-name', key: 'name', label: 'Matched by name' },
]

const EXPLAIN: Record<string, string> = {
  'by-station-id': "Matched on the stop's own id: the strongest of the three.",
  'by-parent-station':
    "Matched through the stop's parent station, which is how a platform reaches the station it belongs to.",
  'by-name':
    'Matched by name, when neither id did: the weakest of the three, and the one that can find the wrong place.',
}

/** The figures the panel shows, in the order the engine's own summary reads them. */
export function metrics(d: Diagnostics): Metric[] {
  const rows: Metric[] = [
    {
      id: 'octilinear',
      label: 'Octilinearity',
      value: percent(d.octilinear, 1),
      explain:
        'The share of the drawn length lying on a 45-degree multiple once the schematiser has finished. The engine prints the same figure.',
    },
    {
      id: 'stations',
      label: 'Stations',
      value: count(d.stations),
      explain: 'Nodes on the map a timetable can call at.',
    },
    {
      id: 'junctions',
      label: 'Junctions',
      value: count(d.junctions),
      explain: 'Nodes that are not stations: where lines meet, cross or turn.',
    },
    {
      id: 'edges',
      label: 'Edges',
      value: count(d.edges),
      explain: 'Runs of track between two nodes.',
    },
    {
      id: 'lines',
      label: 'Lines',
      value: count(d.lines.length),
      explain: `The lines the layout drew: ${few(d.lines)}.`,
    },
    {
      id: 'matched',
      label: 'Stops matched',
      value: `${count(d.stops.matched)} of ${count(d.stops.total)} (${percent(coverage(d.stops))})`,
      explain:
        'Stops in the feed the schedule could attach to a node on the map. A train passes straight through a stop that matched nothing.',
    },
  ]
  for (const method of MATCHING) {
    rows.push({
      id: method.id,
      label: method.label,
      value: count(d.stops.by[method.key]),
      explain: EXPLAIN[method.id],
    })
  }
  rows.push(
    {
      id: 'unmatched',
      label: 'Unmatched stops, the first few',
      value: few(shownIds(d.stops.unmatched)),
      explain:
        'Examples of stops that matched no node. The engine names a handful and never the whole list, so this is not a count; the caveats carry the count.',
    },
    {
      id: 'trips',
      label: 'Trips',
      value: count(d.trips.total),
      explain: 'Trips in the timetable for this day.',
    },
    {
      id: 'paths',
      label: 'Distinct paths',
      value: count(d.trips.paths),
      explain: 'The distinct routes through the map those trips were traced onto.',
    },
    {
      id: 'unrouted',
      label: 'Trips not traced',
      value: count(d.trips.unrouted),
      explain: 'Trips the map had no path for at all. They are not drawn.',
    },
    {
      id: 'skipped',
      label: 'Trips skipping a stop',
      value: count(d.degraded.skipped_calls),
      explain:
        'Trips that skip a stop the map does not carry: the train runs the right way and does not stop where the timetable says it should.',
    },
    {
      id: 'borrowed',
      label: 'Trips on borrowed track',
      value: count(d.degraded.borrowed_track),
      explain:
        "Trips that run part of the way on a neighbouring line's track, because the schematiser did not attribute that segment to their line. They follow the right corridor, but not always the right parallel track.",
    },
    {
      id: 'labels',
      label: 'Labels dropped',
      value: count(d.labels_dropped),
      explain:
        'Station names that had nowhere to sit without overlapping another, so they are not drawn.',
    },
    {
      id: 'peak',
      label: 'Peak trains at once',
      value: count(d.peak_concurrent),
      explain: 'The most trains moving at the same time on this day.',
    },
  )
  return rows
}

/** What the caveats line says, with the score the atlas is ordered by. */
export function caveatsSentence(report: RunReport): string {
  const clean = `No caveats: nothing was fudged, and the issues score is ${score(report.issues)}.`
  if (report.caveats.length === 0) return clean
  const n = report.caveats.length
  return `${count(n)} caveat${n === 1 ? '' : 's'}, and an issues score of ${score(report.issues)}, where 0 is clean.`
}

/**
 * "Copy as text": what the panel shows, as a plain block. Built from the
 * same rows the table renders, so what is copied is what was read.
 */
export function copyText(name: string, report: RunReport): string {
  const lines = [`${name} — the map drawn for ${report.date}`, '']
  for (const metric of metrics(report.diagnostics)) lines.push(`${metric.label}: ${metric.value}`)
  lines.push('')
  if (report.caveats.length === 0) lines.push('No caveats.')
  else {
    lines.push('Caveats:')
    for (const caveat of report.caveats) lines.push(`- ${caveat}`)
  }
  lines.push('', `Issues score: ${score(report.issues)} (0 is clean)`)
  return lines.join('\n')
}
