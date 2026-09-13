// The first-run dialog's markup, rendered without a browser (A6-02,
// specs/026): its title names each tool that will not run, each tool's
// sentence says what it stops, the detail sits behind a closed disclosure,
// and the three actions are there with the safe one marked primary.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FirstRunDialog, { firstRunTitle } from '../../src/renderer/src/FirstRunDialog'
import { failureSentence, type FirstRunResult } from '../../src/shared/first-run'

const LOOM_MISSING: FirstRunResult['loom'] = {
  outcome: 'failed',
  kind: 'missing',
  sentence: failureSentence('loom', 'missing', false),
  detail: 'There is no LOOM folder at …/loom.',
  ms: 1,
}
const FFMPEG_TIMEOUT: FirstRunResult['ffmpeg'] = {
  outcome: 'failed',
  kind: 'timeout',
  sentence: failureSentence('ffmpeg', 'timeout', false),
  detail: 'ffmpeg gave no answer within 15 s and was ended.',
  ms: 15_000,
}

const markup = (result: FirstRunResult): string =>
  renderToStaticMarkup(
    <FirstRunDialog
      open
      result={result}
      onCopyDiagnostics={async () => 'copied'}
      onClose={() => undefined}
    />,
  )

describe('the first-run dialog', () => {
  it('names LOOM alone, says maps cannot be laid out, and keeps the detail closed', () => {
    const result: FirstRunResult = {
      finished: true,
      loom: LOOM_MISSING,
      ffmpeg: { outcome: 'passed', ms: 10 },
    }
    expect(firstRunTitle(result)).toBe('LOOM will not run')
    const html = markup(result)
    expect(html).toContain('aria-labelledby="first-run-title"')
    expect(html).toContain('aria-describedby="first-run-desc"')
    expect(html).toContain('The bundled LOOM tools are missing, so maps cannot be laid out.')
    expect(html).toContain('everything that does not need LOOM still works')
    expect(html).not.toContain('exports cannot be made')
    expect(html).toMatch(/<details class="job-detail"><summary>Details: LOOM<\/summary>/)
    expect(html).not.toContain('<details open')
    for (const action of ['Copy diagnostics', 'How to install', 'OK']) {
      expect(html).toContain(action)
    }
  })

  it('names both in one dialog when both fail', () => {
    const result: FirstRunResult = { finished: true, loom: LOOM_MISSING, ffmpeg: FFMPEG_TIMEOUT }
    expect(firstRunTitle(result)).toBe('LOOM and ffmpeg will not run')
    const html = markup(result)
    expect(html).toContain('maps cannot be laid out')
    expect(html).toContain('The bundled ffmpeg did not answer in time, so exports cannot be made.')
    expect(html).toContain('does not need LOOM or ffmpeg')
  })
})
