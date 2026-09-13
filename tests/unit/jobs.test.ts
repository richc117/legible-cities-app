// The job shape and what is made from it without a browser (A1-03,
// specs/024-jobs): the log buffer's bound, the order, the finished list's
// cap, the sentence said when a job ends, and the text "Copy log" sends.

import { describe, expect, it } from 'vitest'
import {
  composeJobLog,
  endSentence,
  failureOf,
  JOB_LOG_BYTES,
  keepFinished,
  LogBuffer,
  MAX_FINISHED,
  MAX_LOG_LINE_CHARS,
  MAX_LOG_LINES,
  newlyEnded,
  nextJobId,
  orderJobs,
  type Job,
} from '../../src/shared/jobs'

const job = (over: Partial<Job> = {}): Job => ({
  id: nextJobId(),
  kind: 'layout',
  projectId: 'p1',
  projectName: 'Los Angeles',
  label: 'Layout run',
  state: 'running',
  stages: [
    { id: 'gtfs2graph', label: 'gtfs2graph', state: 'done' },
    { id: 'topo', label: 'topo', state: 'running' },
  ],
  message: 'gtfs2graph: 3 nodes',
  hint: null,
  detail: null,
  rawDetail: null,
  log: [],
  dropped: 0,
  started: 1_000,
  ended: null,
  ...over,
})

describe('the caps', () => {
  it('are the spec’s: twenty finished jobs and two hundred log lines', () => {
    expect(MAX_FINISHED).toBe(20)
    expect(MAX_LOG_LINES).toBe(200)
    expect(JOB_LOG_BYTES).toBe(256 * 1024)
  })

  it('ids are never repeated', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextJobId()))
    expect(ids.size).toBe(50)
  })
})

describe('LogBuffer', () => {
  it('keeps the last lines and counts the ones it dropped', () => {
    const buffer = new LogBuffer()
    for (let i = 0; i < MAX_LOG_LINES + 5; i++) buffer.push(`line ${i}`)
    expect(buffer.lines).toHaveLength(MAX_LOG_LINES)
    expect(buffer.lines[0]).toBe('line 5')
    expect(buffer.dropped).toBe(5)
  })

  it('cuts a line too long to keep, and says so', () => {
    const buffer = new LogBuffer()
    buffer.push('x'.repeat(MAX_LOG_LINE_CHARS + 10))
    expect(buffer.lines[0]).toMatch(/\[line cut\]$/)
    expect(buffer.lines[0].length).toBeLessThan(MAX_LOG_LINE_CHARS + 20)
  })

  it('hands out a copy, so a reader cannot change what it keeps', () => {
    const buffer = new LogBuffer()
    buffer.push('a')
    buffer.lines.push('b')
    expect(buffer.lines).toEqual(['a'])
  })
})

describe('failureOf', () => {
  it("takes the engine's detail, with and without its paths", () => {
    const where = ['', 'home', 'someone', 'feed.zip'].join('/')
    expect(
      failureOf({
        code: -32000,
        message: 'x',
        data: { kind: 'io', detail: `No such file: ${where}`, hint: 'x' },
      }),
    ).toEqual({ detail: 'No such file: a file', rawDetail: `No such file: ${where}` })
  })

  it('has nothing for an error that is not the engine’s, or has no detail', () => {
    expect(failureOf(new Error('thrown'))).toEqual({ detail: null, rawDetail: null })
    expect(failureOf({ code: -32800, message: 'Request Cancelled' })).toEqual({
      detail: null,
      rawDetail: null,
    })
  })
})

describe('the order and the finished list', () => {
  it('puts running jobs first, newest first, then finished ones by when they ended', () => {
    const older = job({ id: 'r-old', started: 1 })
    const newer = job({ id: 'r-new', started: 5 })
    const endedFirst = job({ id: 'f-1', state: 'done', started: 2, ended: 3 })
    const endedLast = job({ id: 'f-2', state: 'failed', started: 0, ended: 9 })
    expect(orderJobs([endedFirst, older, endedLast, newer]).map((j) => j.id)).toEqual([
      'r-new',
      'r-old',
      'f-2',
      'f-1',
    ])
  })

  it('keeps at most twenty, dropping the oldest, and never adds a job twice', () => {
    let list: Job[] = []
    for (let i = 0; i < 21; i++) list = keepFinished(list, job({ id: `j${i}`, state: 'done' }))
    expect(list).toHaveLength(MAX_FINISHED)
    expect(list[0].id).toBe('j20')
    expect(list.map((j) => j.id)).not.toContain('j0')
    expect(keepFinished(list, list[3])).toHaveLength(MAX_FINISHED)
  })
})

describe('the sentence said when a job ends', () => {
  it('names the project, the job and how it ended, and never repeats the hint', () => {
    expect(endSentence(job({ state: 'done' }))).toBe('Los Angeles: Layout run, finished.')
    expect(endSentence(job({ state: 'cancelled', label: 'Export as instagram-reel' }))).toBe(
      'Los Angeles: Export as instagram-reel, cancelled.',
    )
    expect(endSentence(job({ state: 'failed', hint: 'the engine said this' }))).toBe(
      'Los Angeles: Layout run, failed.',
    )
    expect(
      endSentence(
        job({
          kind: 'feed-add',
          projectId: null,
          projectName: null,
          label: 'Feed add from a file',
          state: 'done',
        }),
      ),
    ).toBe('Feeds: Feed add from a file, finished.')
    expect(endSentence(job({ projectName: null, state: 'done' }))).toBe(
      'A project: Layout run, finished.',
    )
  })

  it('is said once per job, however often the list is read', () => {
    const running = job({ id: 'a' })
    let seen: ReadonlySet<string> = new Set()
    let step = newlyEnded([running], seen)
    expect(step.ended).toEqual([])
    seen = step.seen
    const finished = { ...running, state: 'done' as const, ended: 2_000 }
    step = newlyEnded([finished], seen)
    expect(step.ended.map((j) => j.id)).toEqual(['a'])
    step = newlyEnded([finished], step.seen)
    expect(step.ended).toEqual([])
  })
})

describe('the text "Copy log" sends', () => {
  it('holds the label, the state, the stages, the sentences and the log', () => {
    const text = composeJobLog(
      job({
        state: 'failed',
        hint: 'the line graph is empty',
        detail: 'ValueError: the line graph is empty (pipeline.py:403)',
        rawDetail: 'ValueError: the line graph is empty (pipeline.py:403)',
        log: ['[info] gtfs2graph: running'],
        ended: 2_000,
      }),
    )
    expect(text).toContain('# Layout run, Los Angeles')
    expect(text).toContain('State: failed')
    expect(text).toContain('topo: running')
    expect(text).toContain('## Hint\n\nthe line graph is empty')
    expect(text).toContain('## Detail\n\nValueError: the line graph is empty (pipeline.py:403)')
    expect(text).toContain('[info] gtfs2graph: running')
  })

  it('leaves the detail out when it is the hint, and says when there is no log', () => {
    const text = composeJobLog(
      job({ state: 'failed', hint: 'same', detail: 'same', rawDetail: 'same' }),
    )
    expect(text).not.toContain('## Detail')
    expect(text).toContain('No log lines were received.')
  })

  it('says when earlier lines were dropped, and where the rest are', () => {
    const text = composeJobLog(job({ log: ['last'], dropped: 1_234 }))
    expect(text).toContain(
      '1234 earlier lines were dropped; engine.log in the logs folder has the rest.',
    )
  })

  it('says an export’s log is its progress sentences', () => {
    expect(composeJobLog(job({ kind: 'export' }))).toMatch(/An export has no engine log of its own/)
  })

  it('stays within the bound the main process accepts, dropping the oldest lines first', () => {
    const line = 'é'.repeat(MAX_LOG_LINE_CHARS)
    const text = composeJobLog(
      job({ log: Array.from({ length: MAX_LOG_LINES }, (_, i) => `${i} ${line}`) }),
    )
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(JOB_LOG_BYTES)
    expect(text).toContain(`${MAX_LOG_LINES - 1} ${line}`)
    expect(text).not.toContain(`\n0 ${line}`)
    expect(text).toMatch(/earlier lines were dropped/)
  })

  it('cuts a head the engine made enormous rather than refusing', () => {
    const text = composeJobLog(
      job({ state: 'failed', hint: 'h', rawDetail: 'd'.repeat(JOB_LOG_BYTES * 2) }),
    )
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(JOB_LOG_BYTES)
    expect(text).toMatch(/\[cut to fit\]\n$/)
  })
})
