// The app's own menu (issue 554): each platform's template, walked as data.
// A packaged build has no Reload and no developer tools at any depth; the
// Edit menu's role is there, without which copy and paste stop working in a
// text field on macOS; the standard shortcuts and places are kept; every
// label is in the app's sentence case; and each of the app's own items does
// what its name says.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MENU_HELP_PAGES,
  menuTemplate,
  type MenuAction,
  type MenuItemTemplate,
} from '../../src/main/menu'

const NAME = 'Legible Cities'
const PLATFORMS = ['darwin', 'win32', 'linux'] as const

/** Every item at every depth, in order. */
function walk(items: readonly MenuItemTemplate[]): MenuItemTemplate[] {
  return items.flatMap((item) => [item, ...walk(item.submenu ?? [])])
}

/** The top-level menu whose label, without its access key, is `label`. */
function menu(items: readonly MenuItemTemplate[], label: string): MenuItemTemplate {
  const found = items.find((item) => item.label?.replace('&', '') === label)
  if (found === undefined) throw new Error(`no ${label} menu`)
  return found
}

const DEVELOPMENT_ROLES = ['reload', 'forceReload', 'toggleDevTools']

// Words that keep their capital inside a label: the product's name.
const PROPER = new Set(['Legible', 'Cities'])

function sentenceCase(label: string): boolean {
  const words = label.replace('&', '').replace(/…$/, '').split(' ')
  if (!/^[A-Z]/.test(words[0])) return false
  return words.slice(1).every((word) => PROPER.has(word) || !/^[A-Z]/.test(word))
}

describe('the menu of a packaged build', () => {
  it.each(PLATFORMS)('has no Reload, Force reload or developer tools on %s', (platform) => {
    // Mutation (`menu.mutations.json`): `packaged` ignored, so the
    // development items are in every build.
    const roles = walk(menuTemplate({ platform, packaged: true, name: NAME })).map((i) => i.role)
    for (const role of DEVELOPMENT_ROLES) expect(roles).not.toContain(role)
  })

  it.each(PLATFORMS)('has all three in a development build on %s, under View', (platform) => {
    const view = menu(menuTemplate({ platform, packaged: false, name: NAME }), 'View')
    const roles = walk(view.submenu ?? []).map((i) => i.role)
    for (const role of DEVELOPMENT_ROLES) expect(roles).toContain(role)
  })
})

describe('each platform’s places and shortcuts', () => {
  it.each(PLATFORMS)('keeps the Edit menu’s role on %s', (platform) => {
    // Mutation (`menu.mutations.json`): the Edit menu's role deleted - a
    // label with nothing under it, and no copy or paste on macOS.
    const template = menuTemplate({ platform, packaged: true, name: NAME })
    expect(menu(template, 'Edit').role).toBe('editMenu')
  })

  it('follows Apple’s order on macOS, with Settings… at Command-comma in the app menu', () => {
    const template = menuTemplate({ platform: 'darwin', packaged: true, name: NAME })
    expect(template.map((i) => i.label)).toEqual([NAME, 'File', 'Edit', 'View', 'Window', 'Help'])
    const appMenu = template[0].submenu ?? []
    const roles = appMenu.filter((i) => i.type !== 'separator').map((i) => i.role ?? i.id)
    expect(roles).toEqual(['about', 'settings', 'services', 'hide', 'hideOthers', 'unhide', 'quit'])
    const settings = appMenu.find((i) => i.id === 'settings')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    expect(settings?.label).toBe('Settings…')
    expect(menu(template, 'Window').role).toBe('windowMenu')
    expect(menu(template, 'Help').role).toBe('help')
  })

  it.each(['win32', 'linux'])('puts Settings in File and About last in Help on %s', (platform) => {
    const template = menuTemplate({ platform, packaged: true, name: NAME })
    expect(template.map((i) => i.label)).toEqual(['&File', '&Edit', '&View', '&Window', '&Help'])
    const file = (menu(template, 'File').submenu ?? []).filter((i) => i.type !== 'separator')
    expect(file.map((i) => i.id ?? i.role)).toEqual(['new-project', 'settings', 'quit'])
    expect(file[1].accelerator).toBe('CmdOrCtrl+,')
    expect(file[1].label).toBe('Settings')
    const help = menu(template, 'Help').submenu ?? []
    const about = help[help.length - 1]
    expect(about.label).toBe(`About ${NAME}`)
    expect(about.id).toBe('about')
    // Never the role: on Windows and Linux it is a native message box.
    expect(walk(template).map((i) => i.role)).not.toContain('about')
  })

  it('says Exit on Windows and Quit on Linux', () => {
    const quit = (platform: string) =>
      walk(menuTemplate({ platform, packaged: true, name: NAME })).find((i) => i.role === 'quit')
    expect(quit('win32')?.label).toBe('Exit')
    expect(quit('linux')?.label).toBe('Quit')
    expect(quit('darwin')?.label).toBe(`Quit ${NAME}`)
  })

  it.each(PLATFORMS)('has New project at Command or Control N on %s', (platform) => {
    const items = walk(menuTemplate({ platform, packaged: true, name: NAME }))
    expect(items.find((i) => i.id === 'new-project')?.accelerator).toBe('CmdOrCtrl+N')
  })

  it.each(PLATFORMS)('zooms with the system’s roles on %s', (platform) => {
    const view = menu(menuTemplate({ platform, packaged: true, name: NAME }), 'View')
    const roles = (view.submenu ?? []).map((i) => i.role).filter((r) => r !== undefined)
    expect(roles).toEqual(['resetZoom', 'zoomIn', 'zoomIn', 'zoomOut', 'togglefullscreen'])
    // The second Zoom in is the unshifted key's, hidden.
    const hidden = (view.submenu ?? []).filter((i) => i.visible === false)
    expect(hidden).toEqual([
      expect.objectContaining({ role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }),
    ])
  })
})

describe('the labels', () => {
  const all = PLATFORMS.flatMap((platform) =>
    [true, false].flatMap((packaged) =>
      walk(menuTemplate({ platform, packaged, name: NAME })).map((item) => ({ platform, item })),
    ),
  )

  it('give every item but a separator a label, in sentence case', () => {
    const labelled = all.filter(({ item }) => item.type !== 'separator')
    expect(labelled.length).toBeGreaterThan(60)
    const wrong = labelled.filter(({ item }) => !sentenceCase(item.label ?? ''))
    expect(wrong.map(({ item }) => item.label)).toEqual([])
  })

  it('end in an ellipsis only where more is asked: New project, and Settings on macOS', () => {
    const ellipses = new Set(
      all
        .filter(({ item }) => item.label?.endsWith('…') || item.label?.endsWith('...'))
        .map(({ platform, item }) => `${platform}: ${item.label}`),
    )
    expect([...ellipses].sort()).toEqual([
      'darwin: New project…',
      'darwin: Settings…',
      'linux: New project…',
      'win32: New project…',
    ])
  })
})

describe('the app’s own items', () => {
  it.each(PLATFORMS)('send the page its commands and open the Help pages on %s', (platform) => {
    const acted: MenuAction[] = []
    const items = walk(
      menuTemplate({ platform, packaged: true, name: NAME, act: (action) => acted.push(action) }),
    )
    const own = items.filter((i) => i.click !== undefined)
    for (const item of own) item.click?.()
    expect(acted).toEqual(
      expect.arrayContaining([
        { kind: 'command', command: 'new-project' },
        { kind: 'command', command: 'settings' },
        { kind: 'command', command: 'copy-diagnostics' },
        ...MENU_HELP_PAGES.map((page) => ({ kind: 'help', page })),
      ]),
    )
    // About is the page's only where the system has no About of its own.
    const abouts = acted.filter((a) => a.kind === 'command' && a.command === 'about')
    expect(abouts).toHaveLength(platform === 'darwin' ? 0 : 1)
    // Each item does one thing, and no two do the same.
    expect(new Set(acted.map((a) => JSON.stringify(a))).size).toBe(own.length)
    // An item of the app's own is never also a role.
    expect(own.filter((i) => i.role !== undefined)).toEqual([])
  })

  it.each(PLATFORMS)('put Help’s pages in one order on %s', (platform) => {
    // Mutation (`menu.mutations.json`): Finding a feed left out of Help.
    const help = menu(menuTemplate({ platform, packaged: true, name: NAME }), 'Help')
    expect((help.submenu ?? []).filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual([
      `${NAME} guide`,
      'Finding a feed',
      'Install and troubleshooting guide',
      'Report a problem',
      'Copy diagnostics',
      ...(platform === 'darwin' ? [] : [`About ${NAME}`]),
    ])
  })
})

describe('the access keys on Windows and Linux', () => {
  it.each(['win32', 'linux'])('give each item of View its own on %s', (platform) => {
    const view = menu(menuTemplate({ platform, packaged: true, name: NAME }), 'View')
    const keys = (view.submenu ?? [])
      .filter((i) => i.type !== 'separator' && i.visible !== false && i.label?.includes('&'))
      .map((i) => i.label?.[i.label.indexOf('&') + 1]?.toLowerCase())
    expect(keys).toEqual(['i', 'o'])
  })

  it('show no ampersand on macOS', () => {
    const labels = walk(menuTemplate({ platform: 'darwin', packaged: false, name: NAME })).map(
      (i) => i.label ?? '',
    )
    expect(labels.filter((label) => label.includes('&'))).toEqual([])
  })
})

describe('what index.ts hands the menu and the window', () => {
  // The flag is read in index.ts, where Electron is; the source is read as
  // the interpreter's test reads it, since nothing there can run here.
  const source = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf8')

  it('builds the template for the app as packaged', () => {
    const call = source.slice(source.indexOf('menuTemplate({'))
    expect(call.slice(0, call.indexOf('})'))).toMatch(/^\s*packaged: app\.isPackaged,$/m)
  })

  it('gives the app’s window developer tools only in development', () => {
    expect(source.match(/^\s*devTools: !app\.isPackaged,$/gm)).toHaveLength(1)
  })

  it('sets the menu before the first window', () => {
    expect(source.indexOf('setAppMenu(helpDeps)')).toBeGreaterThan(0)
    expect(source.indexOf('setAppMenu(helpDeps)')).toBeLessThan(
      source.indexOf('mainWindow = createWindow()\n\n    // The app'),
    )
  })
})
