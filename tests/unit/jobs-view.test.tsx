// The inspector and its jobs, rendered without a browser (A1-03,
// specs/024-jobs): the region and its heading, the empty sentence, each
// job's line, sentence, Cancel only while running, the hint and the detail
// behind a closed disclosure, no path anywhere, and "Copy log" as a
// function. The end-to-end suite drives it in the built app
// (tests/e2e/jobs.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Inspector, { toggleName } from '../../src/renderer/src/Inspector'
import JobsList, {
  copyLog,
  createAnnouncer,
  describeJob,
  handOff,
  JobItem,
  LOG_COPIED,
  logNotCopied,
} from '../../src/renderer/src/Jobs'
import { nextJobId, type Job } from '../../src/shared/jobs'

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
    { id: 'loom', label: 'loom', state: 'pending' },
  ],
  message: 'gtfs2graph: 3 nodes, 2 edges',
  hint: null,
  detail: null,
  rawDetail: null,
  log: [],
  dropped: 0,
  started: Date.UTC(2026, 8, 13, 12, 0, 0),
  ended: null,
  ...over,
})

const noop = (): void => undefined
const copied = async (): Promise<string> => LOG_COPIED

describe('the toggle', () => {
  it('names the running count in words', () => {
    expect(toggleName(0)).toBe('Jobs, none running')
    expect(toggleName(1)).toBe('Jobs, 1 running')
    expect(toggleName(3)).toBe('Jobs, 3 running')
  })
})

describe('the inspector', () => {
  it('is a region named Inspector with a Jobs heading that takes focus, and says when there are none', () => {
    const html = renderToStaticMarkup(<Inspector onClose={noop} />)
    expect(html).toMatch(/^<aside id="inspector" class="inspector" aria-label="Inspector"/)
    expect(html).toContain('<h2 id="jobs-heading" tabindex="-1">Jobs</h2>')
    expect(html).toContain('There are no jobs this session.')
  })
})

describe('a job', () => {
  it('shows who it is for, what it is, its stages and its sentence, and Cancel while it runs', () => {
    const html = renderToStaticMarkup(
      <JobItem job={job()} onCancel={noop} onCancelFocus={noop} onCopy={copied} />,
    )
    expect(html).toContain('Los Angeles')
    expect(html).toContain('Layout run')
    expect(html).toContain('aria-label="Running topo."')
    expect(html).toContain('gtfs2graph: 3 nodes, 2 edges')
    expect(html).toContain('aria-label="Cancel: Layout run, Los Angeles"')
    expect(html).toContain('aria-label="Copy log: Layout run, Los Angeles"')
    expect(html).not.toContain('<details')
  })

  it("shows the engine's hint when it failed, and its detail behind a closed disclosure", () => {
    const html = renderToStaticMarkup(
      <JobItem
        job={job({
          state: 'failed',
          hint: "la-metro-rail: the line graph is empty. Check the feed's route_type values.",
          detail: 'ValueError: la-metro-rail: the line graph is empty (pipeline.py:403)',
          ended: Date.UTC(2026, 8, 13, 12, 1, 0),
        })}
        onCancel={noop}
        onCancelFocus={noop}
        onCopy={copied}
      />,
    )
    expect(html).toContain('class="message error"')
    expect(html).toContain('the line graph is empty. Check the feed&#x27;s route_type values.')
    expect(html).toMatch(/<details class="job-detail"><summary>Details<\/summary>/)
    expect(html).not.toMatch(/<details[^>]* open/)
    expect(html).not.toContain('Cancel:')
  })

  it('shows no disclosure when the detail says only what the hint says', () => {
    const html = renderToStaticMarkup(
      <JobItem
        job={job({ state: 'failed', hint: 'same words', detail: 'same words' })}
        onCancel={noop}
        onCancelFocus={noop}
        onCopy={copied}
      />,
    )
    expect(html).not.toContain('<details')
  })

  it('names a feed add by what it is, not by a project', () => {
    const html = renderToStaticMarkup(
      <JobItem
        job={job({
          kind: 'feed-add',
          projectId: null,
          projectName: null,
          label: 'Feed add from a web address',
        })}
        onCancel={noop}
        onCancelFocus={noop}
        onCopy={copied}
      />,
    )
    expect(html).toContain('Feeds')
    expect(html).toContain('Feed add from a web address')
  })

  it('carries no absolute path, whatever the job holds for the copy', () => {
    const where = ['', 'home', 'someone', 'engine', 'graphs', 'la.json'].join('/')
    const html = renderToStaticMarkup(
      <JobsList
        jobs={[
          job({
            state: 'failed',
            hint: 'the graph is empty in a file',
            detail: 'ValueError: empty in a file',
            rawDetail: `ValueError: empty in ${where}`,
            log: [`[info] reading ${where}`],
          }),
        ]}
        onCancel={noop}

        onCopy={copied}
      />,
    )
    expect(html).not.toContain(where)
  })

  it('lists jobs in the order given', () => {
    const html = renderToStaticMarkup(
      <JobsList
        jobs={[job({ projectName: 'First' }), job({ projectName: 'Second', state: 'done' })]}
        onCancel={noop}

        onCopy={copied}
      />,
    )
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'))
  })
})

describe('describeJob', () => {
  it('says the running stage, or how the job ended', () => {
    expect(describeJob(job())).toBe('Running topo.')
    expect(describeJob(job({ stages: [] }))).toBe('Layout run is running.')
    expect(describeJob(job({ state: 'cancelled' }))).toBe('Layout run cancelled.')
  })
})

describe('copyLog', () => {
  it("sends the job's text and says it is on the clipboard", async () => {
    const sent: string[] = []
    const sentence = await copyLog(job({ log: ['[info] topo: running'] }), async (text) => {
      sent.push(text)
    })
    expect(sentence).toBe(LOG_COPIED)
    expect(sent[0]).toContain('[info] topo: running')
  })

  it('turns a refusal into a sentence', async () => {
    const sentence = await copyLog(job(), async () => {
      throw new Error('the log still named your home folder, so nothing was copied')
    })
    expect(sentence).toBe(
      logNotCopied('the log still named your home folder, so nothing was copied'),
    )
  })
})

describe('the announcement', () => {
  it('says the same sentence twice as two changes, emptying the region between', () => {
    const written: string[] = []
    const frames: (() => void)[] = []
    const announce = createAnnouncer(
      (text) => written.push(text),
      (then) => frames.push(then),
    )
    announce('Los Angeles: Layout run, finished.')
    frames.shift()?.()
    announce('Los Angeles: Layout run, finished.')
    frames.shift()?.()
    expect(written).toEqual([
      '',
      'Los Angeles: Layout run, finished.',
      '',
      'Los Angeles: Layout run, finished.',
    ])
  })

  it('says two ends in the same frame together, once', () => {
    const written: string[] = []
    const frames: (() => void)[] = []
    const announce = createAnnouncer(
      (text) => written.push(text),
      (then) => frames.push(then),
    )
    announce('A: Layout run, finished.')
    announce('B: Export as x, cancelled.')
    expect(frames).toHaveLength(1)
    frames.shift()?.()
    expect(written).toEqual(['', 'A: Layout run, finished. B: Export as x, cancelled.'])
  })
})

describe('handing focus to a job', () => {
  it('gives the heading the focus when it was lost, and watches while the job runs', () => {
    expect(handOff('lost', true)).toEqual({ focus: true, keep: true })
    expect(handOff('lost', false)).toEqual({ focus: true, keep: false })
  })

  it('leaves focus that is still in the job, and stops once the job has ended', () => {
    expect(handOff('in-job', true)).toEqual({ focus: false, keep: true })
    expect(handOff('in-job', false)).toEqual({ focus: false, keep: false })
  })

  it('leaves a person who has moved on alone', () => {
    expect(handOff('elsewhere', true)).toEqual({ focus: false, keep: false })
  })
})
