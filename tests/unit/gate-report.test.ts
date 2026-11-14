// The gate report's decisions (issue 693): what is refused, what is copied
// from a record and what reads "not recorded". Fixtures are made up; nothing
// here talks to GitHub.

import { describe, expect, it } from 'vitest'
// @ts-expect-error the script is plain JavaScript with no declarations
import * as report from '../../scripts/gate-report.mjs'

const TAG = 'v1.0.0-rc.9'
const COMMIT = 'a'.repeat(40)

const record = (
  steps: Array<[number, string, string, string]>,
  extra = '',
  tag = TAG,
  heading = '## Acceptance run',
) =>
  [
    heading,
    '',
    '| | |',
    '|---|---|',
    '| App version | 1.0.0-rc.9 |',
    '',
    '## Steps',
    '',
    '| # | Step | Result | Notes and failure issues |',
    '|---|---|---|---|',
    ...steps.map(([n, title, result, notes]) => `| ${n} | ${title} | ${result} | ${notes} |`),
    '',
    extra,
    '## Anything else',
    '',
    `- The release under test: ${tag}.`,
    '',
  ].join('\n')

const STEPS: Array<[number, string, string, string]> = [
  [1, 'Download and check the installer', 'pass', ''],
  [2, 'Install and open it the first time', 'not automated', "A person's."],
  [3, 'First run', 'fail', 'It stalled, see issue 901.'],
  [4, 'Open a sample city', 'fail', 'The map stayed blank.'],
  [5, 'Cell 01', 'pass, part not automated', 'Not automated: the look.'],
]

const run = (id: string, over: Record<string, unknown> = {}) =>
  report.parseRun({
    databaseId: Number(id),
    displayTitle: 'acceptance',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    headSha: COMMIT,
    headBranch: TAG,
    jobs: [
      {
        name: 'release (draft)',
        conclusion: 'success',
        url: 'https://github.com/richc117/legible-cities-app/actions/runs/1/job/2',
      },
      { name: 'acceptance (darwin-arm64)', conclusion: 'success', url: '' },
    ],
    url: `https://github.com/richc117/legible-cities-app/actions/runs/${id}`,
    ...over,
  })

const inputs = (over: Record<string, unknown> = {}) => ({
  tag: TAG,
  build: run('11'),
  acceptance: run('22', { event: 'workflow_dispatch', headBranch: 'main' }),
  tagCommit: COMMIT,
  artefacts: ['acceptance-darwin-arm64'],
  records: new Map([['darwin-arm64', record(STEPS)]]),
  ...over,
})

const page = (over: Record<string, unknown> = {}) =>
  report.renderReport(report.assemble(inputs(over)))

describe('the gate report', () => {
  it('lists every failed row with the issue its notes name, or says none is named', () => {
    const text = page()
    expect(text).toContain('darwin-arm64 step 3, First run: fail; [#901]')
    expect(text).toContain('darwin-arm64 step 4, Open a sample city: fail; no issue named')
  })

  it('copies a result as the record wrote it and lists the rows still not automated', () => {
    const text = page()
    expect(text).toContain('| 5 | Cell 01 | pass, part not automated |')
    expect(text).toContain('- 2. Install and open it the first time: not automated')
    expect(text).toContain('- 5. Cell 01: pass, part not automated')
  })

  it('never writes pass for a row the record marks not automated', () => {
    const text = page()
    expect(text).toContain('| 2 | Install and open it the first time | not automated |')
    expect(text).not.toMatch(/\| 2 \| Install and open it the first time \| pass/)
  })

  it('reads "not recorded" for the parts the run has no record of', () => {
    const text = page()
    expect(text).toContain('Not recorded: this run has no reader job')
    expect(text).toContain('Verdicts: not recorded.')
    expect(text).toContain('Not recorded: no issue was given for it.')
    expect(text).toContain('| attest (provenance) | not recorded |')
  })

  it('keeps the visual review to its three verdicts and counts a blank one as not recorded', () => {
    const evidence = [
      '## Visual evidence',
      '',
      '| Entry | What is visible | Verdict |',
      '|---|---|---|',
      '| a | a map | looks right |',
      '| b | a blank page | looks wrong |',
      '| c | smudged | pass |',
      '| d | far | cannot tell |',
      '',
    ].join('\n')
    const text = page({ records: new Map([['darwin-arm64', record(STEPS, evidence)]]) })
    expect(text).toContain('Verdicts: 1 looks right, 1 looks wrong, 1 cannot tell, 1 not recorded.')
    expect(text).toContain('darwin-arm64 evidence b: looks wrong')
  })

  it('names a failed job of the build', () => {
    const build = run('11', {
      jobs: [{ name: 'verify (attestations)', conclusion: 'failure', url: '' }],
    })
    expect(page({ build })).toContain('build job verify (attestations): failure; no issue named')
  })

  it('refuses a rehearsal by its artefacts', () => {
    expect(() =>
      report.assemble(inputs({ artefacts: ['rehearsal-acceptance-darwin-arm64'] })),
    ).toThrow(/rehearsal/)
  })

  it("refuses a rehearsal by its record's heading", () => {
    const heading = "## Acceptance run: REHEARSAL, not a candidate's run"
    const records = new Map([['darwin-arm64', record(STEPS, '', TAG, heading)]])
    expect(() => report.assemble(inputs({ records }))).toThrow(/rehearsal/)
  })

  it('refuses an acceptance run of another tag', () => {
    const records = new Map([['darwin-arm64', record(STEPS, '', 'v1.0.0-rc.8')]])
    expect(() => report.assemble(inputs({ records }))).toThrow(/v1\.0\.0-rc\.8, not v1\.0\.0-rc\.9/)
    const acceptance = run('22', { displayTitle: 'acceptance v1.0.0-rc.8' })
    expect(() => report.assemble(inputs({ acceptance }))).toThrow(/is of v1\.0\.0-rc\.8/)
  })

  it("refuses a build run that is not the tag's commit", () => {
    expect(() => report.assemble(inputs({ tagCommit: 'b'.repeat(40) }))).toThrow(
      /not v1\.0\.0-rc\.9's commit bbbbbbb/,
    )
  })

  it('refuses what is not an acceptance record', () => {
    const records = new Map([['darwin-arm64', '# something else\n']])
    expect(() => report.assemble(inputs({ records }))).toThrow(/not an acceptance record/)
  })

  it('writes no machine path and no address beyond this repository', () => {
    const text = page()
    expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/)
    for (const url of text.match(/https?:\/\/[^\s)]+/g) ?? []) {
      expect(url.startsWith('https://github.com/richc117/legible-cities-app/')).toBe(true)
    }
  })

  it('takes an issue number or a link into this repository, and nothing else', () => {
    expect(report.repoLink('12')).toBe('https://github.com/richc117/legible-cities-app/issues/12')
    expect(() => report.repoLink('https://example.com/x')).toThrow(/neither an issue number/)
  })

  it('reads a cell with an escaped pipe whole', () => {
    expect(report.splitRow('| 1 | a \\| b | pass | |')).toEqual(['1', 'a | b', 'pass', ''])
  })
})
