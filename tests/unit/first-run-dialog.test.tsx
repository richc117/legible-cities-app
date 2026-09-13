// The first-run dialog's markup, rendered without a browser (A6-02,
// specs/026): its title names each tool that will not run, each tool's
// sentence says what it stops, the detail sits behind a closed disclosure,
// and the three actions are there with the safe one marked primary.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FirstRunDialog, {
  anotherDialogOpen,
  applyStep,
  firstRunTitle,
  nextStep,
  type DialogLike,
} from '../../src/renderer/src/FirstRunDialog'
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

describe('waiting for another dialog', () => {
  const page = (open: object[]) => ({ querySelectorAll: () => open as unknown as Element[] })
  const own = {} as Element

  it('waits while a dialog other than its own is open', () => {
    const creating = {}
    expect(anotherDialogOpen(page([creating]), own)).toBe(true)
    expect(anotherDialogOpen(page([own, creating]), own)).toBe(true)
  })

  it('does not wait for itself, or when nothing is open', () => {
    expect(anotherDialogOpen(page([own]), own)).toBe(false)
    expect(anotherDialogOpen(page([]), own)).toBe(false)
    expect(anotherDialogOpen(page([]), null)).toBe(false)
  })

  it('asks the page for open dialogs only', () => {
    const asked: string[] = []
    anotherDialogOpen(
      {
        querySelectorAll: (selector) => {
          asked.push(selector)
          return []
        },
      },
      own,
    )
    expect(asked).toEqual(['dialog[open]'])
  })
})

describe('what the dialog element does', () => {
  it('shows only when wanted, not yet shown, and no other dialog is open', () => {
    expect(nextStep({ wanted: true, shown: false, another: false })).toBe('show')
    // The case the end-to-end suite caught: mounted while New project was open.
    expect(nextStep({ wanted: true, shown: false, another: true })).toBe('none')
  })

  it('stays once shown, whatever opens over it, and closes when no longer wanted', () => {
    expect(nextStep({ wanted: true, shown: true, another: true })).toBe('none')
    expect(nextStep({ wanted: true, shown: true, another: false })).toBe('none')
    expect(nextStep({ wanted: false, shown: true, another: false })).toBe('close')
    expect(nextStep({ wanted: false, shown: false, another: true })).toBe('none')
  })

  it('reads the page when it decides: mounted while another dialog is open, it does not show', () => {
    // A dialog element and its page, as far as the decision touches them.
    function fake(othersOpen: number) {
      const calls: string[] = []
      const page = {
        querySelectorAll: () => [...Array.from({ length: othersOpen }, () => ({})), dialog],
      }
      const dialog = {
        open: false,
        ownerDocument: page,
        showModal: () => {
          calls.push('showModal')
          dialog.open = true
        },
        close: () => {
          calls.push('close')
          dialog.open = false
        },
      }
      return { dialog: dialog as unknown as DialogLike, calls }
    }

    const busy = fake(1)
    expect(applyStep(busy.dialog, true)).toBe('none')
    expect(busy.calls).toEqual([])

    const free = fake(0)
    expect(applyStep(free.dialog, true)).toBe('show')
    expect(free.calls).toEqual(['showModal'])
    // Shown, then no longer wanted.
    expect(applyStep(free.dialog, false)).toBe('close')
    expect(free.calls).toEqual(['showModal', 'close'])
  })
})
