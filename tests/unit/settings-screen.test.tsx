// Settings' markup, rendered without a browser: what a person who opens it
// is told and where they find it (issue 544). Effects do not run in a
// server render, so what is read here is the screen as it first draws,
// which for the Versions section is the engine-away case.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Settings from '../../src/renderer/src/Settings'
import { iconMarkup } from '../../src/renderer/src/icons/Icon'
import type { SettingsView } from '../../src/shared/settings'

const VIEW: SettingsView = {
  appVersion: '4.2.0-test',
  theme: 'system',
  engine: { path: '/engine', source: 'default', pending: null, locked: false },
  export: { path: '/exports', source: 'default', pending: null, locked: false },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function markup(engine: Parameters<typeof Settings>[0]['engine']): string {
  // Only what a first render reads: the licence buttons look at the bridge
  // while they are being described.
  vi.stubGlobal('window', {
    api: {
      licences: {
        openNotices: async () => undefined,
        showTexts: async () => undefined,
        openChromium: async () => undefined,
      },
    },
  })
  return renderToStaticMarkup(
    <Settings settings={VIEW} onChanged={() => undefined} engine={engine} />,
  )
}

/** The markup of the `<section>` whose heading is `name`. */
function section(html: string, name: string): string {
  const sections = html.split('<section ').slice(1)
  const found = sections.find((s) => new RegExp(`<h2[^>]*>${name}</h2>`).test(s))
  if (found === undefined) throw new Error(`no section headed ${name}`)
  return found.slice(0, found.indexOf('</section>'))
}

describe('the Versions section', () => {
  it('names the app first, with the version the main process reported, when the engine is away', () => {
    const versions = section(
      markup({ state: 'unavailable', reason: 'it did not start' }),
      'Versions',
    )
    expect(versions).toContain('<dt>App</dt><dd>4.2.0-test</dd>')
    // The engine's own sentence stays, for the rows that need it.
    expect(versions).toContain('The engine is not running, so it cannot say what versions it has.')
    expect(versions).not.toContain('<dt>Engine</dt>')
  })

  it('names the app first while the engine is still being asked', () => {
    const versions = section(markup({ state: 'ready', version: '0.20.0', protocol: 1 }), 'Versions')
    expect(versions.indexOf('<dt>')).toBe(versions.indexOf('<dt>App</dt>'))
    expect(versions).toContain('<dd>4.2.0-test</dd>')
    expect(versions).toContain('Asking the engine…')
  })
})

describe('the sections that hold the logs and the folders', () => {
  const html = markup({ state: 'unavailable', reason: 'it did not start' })

  it('file the logs and Copy diagnostics under a heading of their own', () => {
    const logs = section(html, 'Logs and diagnostics')
    expect(logs).toContain('Open logs folder')
    expect(logs).toContain('Copy diagnostics')
    expect(logs).toContain('main.log')
  })

  it('end Folders after the export folder, with neither of them left in it', () => {
    const folders = section(html, 'Folders')
    expect(folders).toContain('Export folder')
    expect(folders).not.toContain('Open logs folder')
    expect(folders).not.toContain('Copy diagnostics')
  })

  it('give each section a heading that is its own region name', () => {
    const headings = [...html.matchAll(/<h2 id="(settings-[^"]+)">([^<]+)<\/h2>/g)].map((m) => m[2])
    expect(headings).toEqual([
      'Folders',
      'Logs and diagnostics',
      'Appearance',
      'Versions',
      'Bundled tools',
      'Licences',
      'Engine data',
    ])
    for (const [, id] of html.matchAll(/<h2 id="(settings-[^"]+)">/g))
      expect(html, id).toContain(`aria-labelledby="${id}"`)
  })
})

describe('one glyph, one meaning', () => {
  const html = markup({ state: 'unavailable', reason: 'it did not start' })
  const FOLDER = iconMarkup('folder', 16)
  const JOBS = iconMarkup('layers', 16)

  it('draws both Choose folder buttons and Open logs folder with the folder glyph', () => {
    // A button's label follows its icon, which is a span with the svg inside.
    const icons = [
      ...html.matchAll(
        /<span class="icon"[^>]*>(<svg.*?<\/svg>)<\/span>(Choose folder|Open logs folder)/g,
      ),
    ]
    expect(icons.map((m) => m[2])).toEqual(['Choose folder', 'Choose folder', 'Open logs folder'])
    for (const [, svg, label] of icons) expect(svg, label).toBe(FOLDER)
  })

  it('does not draw the Jobs glyph anywhere on the screen', () => {
    expect(html).not.toContain(JOBS)
  })

  it('keeps the Jobs glyph out of every control that chooses a folder, in any component', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.tsx')) files.push(path)
      }
    }
    walk(root)
    const wrong: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/<Icon name="(\w+)" \/>\s*(Choose folder|Open logs folder)/g))
        if (m[1] !== 'folder') wrong.push(`${file}: ${m[2]} carries ${m[1]}`)
    }
    expect(wrong).toEqual([])
    // And the check above found the buttons it speaks of.
    const exportTab = readFileSync(join(root, 'ExportTab.tsx'), 'utf8')
    expect(exportTab).toMatch(/<Icon name="folder" \/>\s*Choose folder/)
  })
})
