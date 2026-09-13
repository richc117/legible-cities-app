// The tab strip on the WAI-ARIA tabs pattern (A5-01): its markup, rendered
// without a browser, and the keys, as the function the strip calls. The
// end-to-end suite drives it from the keyboard in the built app
// (tests/e2e/export-tab.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Tabs, { panelId, TabPanel, tabAfterKey, tabId } from '../../src/renderer/src/kit/Tabs'

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'export', label: 'Export' },
] as const

describe('Tabs', () => {
  it('is a labelled tablist of buttons, one tab stop, the chosen one selected and naming its panel', () => {
    const html = renderToStaticMarkup(
      <Tabs
        tabs={TABS}
        selected="export"
        onSelect={() => undefined}
        label="Project"
        idPrefix="p"
      />,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Project"')
    const tabs = [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0])
    expect(tabs).toHaveLength(2)
    const [map, exportTab] = tabs
    expect(map).toContain('role="tab"')
    expect(map).toContain('type="button"')
    expect(map).toContain('aria-selected="false"')
    expect(map).toContain('tabindex="-1"')
    expect(map).toContain(`aria-controls="${panelId('p', 'map')}"`)
    expect(map).toContain(`id="${tabId('p', 'map')}"`)
    expect(exportTab).toContain('aria-selected="true"')
    expect(exportTab).toContain('tabindex="0"')
    expect(exportTab).toContain('>Export<')
  })

  it('labels each panel by its tab, and hides the one not chosen without unmounting it', () => {
    const html = renderToStaticMarkup(
      <>
        <TabPanel idPrefix="p" id="map" selected={false}>
          <p>kept</p>
        </TabPanel>
        <TabPanel idPrefix="p" id="export" selected>
          <p>shown</p>
        </TabPanel>
      </>,
    )
    expect(html).toContain(
      `<div role="tabpanel" class="tab-panel" id="${panelId('p', 'map')}" aria-labelledby="${tabId('p', 'map')}" tabindex="0" hidden=""><p>kept</p></div>`,
    )
    expect(html).toContain(
      `<div role="tabpanel" class="tab-panel" id="${panelId('p', 'export')}" aria-labelledby="${tabId('p', 'export')}" tabindex="0"><p>shown</p></div>`,
    )
  })

  it('moves with the arrow keys, wrapping, and to the ends with Home and End', () => {
    const three = [...TABS, { id: 'more', label: 'More' }]
    expect(tabAfterKey(three, 'map', 'ArrowRight')).toBe('export')
    expect(tabAfterKey(three, 'more', 'ArrowRight')).toBe('map')
    expect(tabAfterKey(three, 'map', 'ArrowLeft')).toBe('more')
    expect(tabAfterKey(three, 'export', 'Home')).toBe('map')
    expect(tabAfterKey(three, 'map', 'End')).toBe('more')
    expect(tabAfterKey(three, 'map', 'Enter')).toBeNull()
    expect(tabAfterKey(three, 'map', 'ArrowDown'), 'a horizontal strip').toBeNull()
    expect(tabAfterKey([], 'map', 'ArrowRight')).toBeNull()
  })
})
