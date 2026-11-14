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

const RELEASE = { name: 'release (draft)', conclusion: 'success', url: '' }
const run = (id: string, over: Record<string, unknown> = {}) =>
  report.parseRun({
    databaseId: Number(id),
    workflowName: 'build',
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
  acceptance: run('22', {
    workflowName: 'acceptance',
    event: 'workflow_dispatch',
    headBranch: 'main',
  }),
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
    expect(text).toContain('darwin-arm64 step 3, First run: fail; its notes mention [#901]')
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
      '| c | smudged | |',
      '| d | far | cannot tell |',
      '',
    ].join('\n')
    const text = page({ records: new Map([['darwin-arm64', record(STEPS, evidence)]]) })
    expect(text).toContain('Verdicts: 1 looks right, 1 looks wrong, 1 cannot tell, 1 not recorded.')
    expect(text).toContain('darwin-arm64 evidence b: looks wrong')
  })

  it('names a failed job of the build', () => {
    const build = run('11', {
      jobs: [RELEASE, { name: 'verify (attestations)', conclusion: 'failure', url: '' }],
    })
    expect(page({ build })).toContain('build job verify (attestations): failure; no issue named')
  })

  it('refuses a rehearsal by its artefacts', () => {
    expect(() =>
      report.assemble(inputs({ artefacts: ['rehearsal-acceptance-darwin-arm64'] })),
    ).toThrow(/rehearsal/)
  })

  it('refuses a rehearsal by its title alone', () => {
    const acceptance = run('22', {
      workflowName: 'acceptance',
      displayTitle: 'acceptance REHEARSAL of build run 7',
    })
    expect(() => report.assemble(inputs({ acceptance }))).toThrow(/its title says REHEARSAL/)
  })

  it("refuses a rehearsal by its record's heading", () => {
    const heading = "## Acceptance run: REHEARSAL, not a candidate's run"
    const records = new Map([['darwin-arm64', record(STEPS, '', TAG, heading)]])
    expect(() => report.assemble(inputs({ records }))).toThrow(/headed REHEARSAL/)
  })

  it('refuses an acceptance run of another tag', () => {
    const records = new Map([['darwin-arm64', record(STEPS, '', 'v1.0.0-rc.8')]])
    expect(() => report.assemble(inputs({ records }))).toThrow(/v1\.0\.0-rc\.8, not v1\.0\.0-rc\.9/)
    const acceptance = run('22', {
      workflowName: 'acceptance',
      displayTitle: 'acceptance v1.0.0-rc.8',
    })
    expect(() => report.assemble(inputs({ acceptance }))).toThrow(
      /is titled "acceptance v1\.0\.0-rc\.8"/,
    )
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

  it('refuses a build run that is not a push of the tag', () => {
    const branch = run('11', { headBranch: 'some-branch' })
    expect(() => report.assemble(inputs({ build: branch }))).toThrow(/not the push of/)
    const dispatched = run('11', { event: 'workflow_dispatch' })
    expect(() => report.assemble(inputs({ build: dispatched }))).toThrow(/not the push of/)
  })

  it('refuses a run of the wrong workflow', () => {
    expect(() => report.assemble(inputs({ build: run('11', { workflowName: 'ci' }) }))).toThrow(
      /not build/,
    )
    const acceptance = run('22', { workflowName: 'build' })
    expect(() => report.assemble(inputs({ acceptance }))).toThrow(/not acceptance/)
  })

  it('takes a bare acceptance title only on a record that names the tag', () => {
    const exact = run('22', { workflowName: 'acceptance', displayTitle: `acceptance ${TAG}` })
    expect(() => report.assemble(inputs({ acceptance: exact, records: new Map() }))).not.toThrow()
    expect(() => report.assemble(inputs({ records: new Map() }))).toThrow(/no record to say/)
    const other = run('22', { workflowName: 'acceptance', displayTitle: 'acceptance of something' })
    expect(() => report.assemble(inputs({ acceptance: other }))).toThrow(/is titled/)
  })

  it('refuses a record that does not say which release it is of', () => {
    const text = record(STEPS).replace(/- The release under test: .*\n/, '')
    const records = new Map([['darwin-arm64', text]])
    expect(() => report.assemble(inputs({ records }))).toThrow(/says no tag/)
  })

  it('refuses a build whose release (draft) did not succeed', () => {
    const skipped = run('11', {
      jobs: [{ name: 'release (draft)', conclusion: 'skipped', url: '' }],
    })
    expect(() => report.assemble(inputs({ build: skipped }))).toThrow(
      /release \(draft\) is skipped/,
    )
    expect(() => report.assemble(inputs({ build: run('11', { jobs: [] }) }))).toThrow(/absent/)
  })

  it('counts a skipped or cancelled build job as a failure', () => {
    const build = run('11', {
      jobs: [RELEASE, { name: 'attest (provenance)', conclusion: 'skipped', url: '' }],
    })
    expect(page({ build })).toContain('build job attest (provenance): skipped')
  })

  it('lists a not run row and a result the checklist does not have as failures', () => {
    const steps: Array<[number, string, string, string]> = [
      [6, 'Cell 02', 'not run', ''],
      [7, 'Cell 03', 'passed', 'see issue 12'],
    ]
    const text = page({ records: new Map([['darwin-arm64', record(steps)]]) })
    expect(text).toContain('darwin-arm64 step 6, Cell 02: not run; no issue named')
    expect(text).toContain(
      'darwin-arm64 step 7, Cell 03: passed (not a result the checklist has); its notes mention [#12]',
    )
    expect(text).not.toContain('step 7, Cell 03: pass,')
  })

  it('reports a short row and a missing step instead of dropping them', () => {
    const text = page({ records: new Map([['darwin-arm64', record(STEPS)]]) })
    expect(text).toContain('darwin-arm64 step 22: missing from the record')
    const short = record(STEPS).replace(
      /^\| 1 \|.*$/m,
      '| 1 | Download and check the installer | pass |',
    )
    const shortText = page({ records: new Map([['darwin-arm64', short]]) })
    expect(shortText).toContain('step 1, Download and check the installer: the row has fewer cells')
  })

  it('renders both systems, and a system with no job or record is not recorded and a failure', () => {
    const text = page()
    expect(text).toContain('#### win-x64')
    expect(text).toContain('Job: not recorded.')
    expect(text).toContain('win-x64 record: not recorded; no issue named')
    expect(text).toContain('acceptance job win-x64: not recorded; no issue named')
    expect(text).toContain('job not recorded, record not recorded')
  })

  it('lists a verdict outside the three words as a failure, and points at a linked review', () => {
    const evidence = [
      '## Visual evidence',
      '',
      '| Entry | What is visible | Verdict |',
      '|---|---|---|',
      '| a | a map | pass |',
      '',
    ].join('\n')
    const text = page({ records: new Map([['darwin-arm64', record(STEPS, evidence)]]) })
    expect(text).toContain('evidence a: "pass" is not one of looks right')
    const linked = page({
      links: { review: 'https://github.com/richc117/legible-cities-app/issues/5' },
    })
    expect(linked).toContain(
      "Verdicts: in the review's record linked above; this page does not read them.",
    )
  })

  it('reads an issue only as "issue N", "issues N" or an issues link, never a bare #N', () => {
    expect(report.issuesNamed('a colour #123456 in a message')).toEqual([])
    expect(report.issuesNamed('see issue 12, issues 13 and /issues/14')).toEqual([12, 13, 14])
  })

  it('merges the pages of a paginated artefact list', () => {
    expect(report.mergeArtefactPages('["a","b"]\n["c"]')).toEqual(['a', 'b', 'c'])
    expect(report.mergeArtefactPages('[]\n["c"]')).toEqual(['c'])
    expect(report.mergeArtefactPages('[\n  "a"\n]')).toEqual(['a'])
  })

  it('refuses a tag that is not a tag before it goes into an API path', () => {
    expect(() =>
      report.parseArgs(['--tag', 'main/../x', '--build', '1', '--acceptance', '2']),
    ).toThrow(/neither v<X.Y.Z>/)
  })

  it('names every part that reads not recorded, apart from the failures', () => {
    const text = page()
    const tail = text.slice(text.indexOf('### Not recorded'))
    expect(tail).toContain('- the scripted VoiceOver run')
    expect(tail).toContain("- the visual review's verdicts")
    expect(tail).toContain('- the sitting')
    expect(tail).toContain('- win-x64 record')
    expect(tail).not.toContain('Every part above has a record.')
    const linked = page({
      links: {
        sitting: 'https://github.com/richc117/legible-cities-app/issues/3',
        review: 'https://github.com/richc117/legible-cities-app/issues/5',
      },
    })
    expect(linked.slice(linked.indexOf('### Not recorded'))).not.toContain('the sitting')
  })

  it('says every part has a record when none is missing', () => {
    const acceptance = run('22', {
      workflowName: 'acceptance',
      jobs: [
        { name: 'acceptance (darwin-arm64)', conclusion: 'success', url: '' },
        { name: 'acceptance (win-x64)', conclusion: 'success', url: '' },
        { name: 'reader (VoiceOver, darwin-arm64)', conclusion: 'success', url: '' },
      ],
    })
    const build = run('11', {
      jobs: [
        RELEASE,
        ...['attest (provenance)', 'verify (attestations)'].map((name) => ({
          name,
          conclusion: 'success',
          url: '',
        })),
      ],
    })
    const records = new Map([
      ['darwin-arm64', record(STEPS)],
      ['win-x64', record(STEPS)],
    ])
    const links = {
      sitting: 'https://github.com/richc117/legible-cities-app/issues/3',
      review: 'https://github.com/richc117/legible-cities-app/issues/5',
    }
    const text = page({ acceptance, build, records, links })
    expect(text).toContain('Every part above has a record.')
  })

  it("only mentions an issue number in a failure's notes, never takes it as the failure's", () => {
    const steps: Array<[number, string, string, string]> = [
      [
        9,
        'Cell 05',
        'fail',
        'Failed: the colour did not change. Not automated: the line options (issue 394): the look.',
      ],
    ]
    const text = page({ records: new Map([['darwin-arm64', record(steps)]]) })
    expect(text).toContain('its notes mention [#394]')
    expect(text).not.toMatch(/fail; \[#394\]/)
  })

  it('refuses a wrong run before anything is downloaded', () => {
    const args = { ...inputs(), build: run('11', { workflowName: 'ci' }) }
    expect(() => report.refuseRun(args)).toThrow(/not build/)
    expect(() => report.refuseRun(inputs())).not.toThrow()
  })
})
