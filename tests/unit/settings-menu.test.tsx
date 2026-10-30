// @vitest-environment jsdom
// Settings, arrived at from the app's menu (issue 554): About takes focus
// to the Versions heading, Copy diagnostics to the Logs and diagnostics
// heading and copies there, its result said under its own button. Each ask
// is answered once, and a second ask of the same section is answered again.

import { afterEach, describe, expect, it, vi } from 'vitest'
import Settings, { DIAGNOSTICS_COPIED, type SettingsSection } from '../../src/renderer/src/Settings'
import type { SettingsView } from '../../src/shared/settings'
import { answered, cleanup, READY, renderPanel } from '../support/render'

const VIEW: SettingsView = {
  appVersion: '4.2.0-test',
  theme: 'system',
  engine: { path: '/engine', source: 'default', pending: null, locked: false },
  export: { path: '/exports', source: 'default', pending: null, locked: false },
}

afterEach(() => {
  cleanup()
})

function draw(section?: SettingsSection) {
  const copyDiagnostics = vi.fn(async () => undefined)
  const element = (at?: SettingsSection) => (
    <Settings settings={VIEW} onChanged={() => undefined} engine={READY} section={at} />
  )
  const view = renderPanel(element(section), {
    api: {
      projects: { list: async () => [] },
      settings: { engineSize: () => new Promise(() => undefined), copyDiagnostics },
      licences: { read: () => new Promise(() => undefined) },
      firstRun: { get: () => new Promise(() => undefined), onChanged: () => () => undefined },
    },
  })
  return { copyDiagnostics, redraw: (at?: SettingsSection) => view.rerender(element(at)) }
}

const focused = (): string | null => document.activeElement?.id ?? null
const copiedLine = (): string =>
  document.querySelector('[aria-labelledby="settings-logs"] [aria-live="polite"]')?.textContent ??
  ''

describe('Settings from the menu', () => {
  it('opens on its own heading when nothing is asked, and copies nothing', async () => {
    const { copyDiagnostics } = draw()
    await answered()
    expect(focused()).toBe('settings-heading')
    expect(copyDiagnostics).not.toHaveBeenCalled()
  })

  it('takes About to the versions, and copies nothing', async () => {
    const { copyDiagnostics } = draw({ name: 'versions', at: 1 })
    await answered()
    expect(focused()).toBe('settings-versions')
    expect(copyDiagnostics).not.toHaveBeenCalled()
  })

  it('takes Copy diagnostics to its section and copies, once for each ask', async () => {
    // Mutation (`settings-menu.mutations.json`): the copy on arrival removed,
    // so the menu's Copy diagnostics only scrolls.
    const { copyDiagnostics, redraw } = draw({ name: 'diagnostics', at: 1 })
    await answered()
    expect(focused()).toBe('settings-logs')
    expect(copyDiagnostics).toHaveBeenCalledTimes(1)
    expect(copiedLine()).toBe(DIAGNOSTICS_COPIED)

    // The same ask drawn again is not asked again.
    redraw({ name: 'diagnostics', at: 1 })
    await answered()
    expect(copyDiagnostics).toHaveBeenCalledTimes(1)

    // About, and then Copy diagnostics again, while the screen is open.
    redraw({ name: 'versions', at: 2 })
    await answered()
    expect(focused()).toBe('settings-versions')
    redraw({ name: 'diagnostics', at: 3 })
    await answered()
    expect(focused()).toBe('settings-logs')
    expect(copyDiagnostics).toHaveBeenCalledTimes(2)
  })
})
