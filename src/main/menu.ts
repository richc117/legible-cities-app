// The app's own menu (issue 554). Until this the app never set one, so every
// release shipped Electron's default: Reload and Toggle Developer Tools in a
// packaged build, and no Help, Settings or New project. A reload in the
// middle of a run leaves work going that the new page can neither see nor
// cancel, and the developer tools put the preload bridge one console away.
//
// The layout is each platform's own (DESIGN.md section 9): Apple's app menu,
// File, Edit, View, Window and Help on macOS; Microsoft's File, Edit, View,
// Window and Help on Windows, and the same on Linux. The system's roles are
// used wherever one exists, because a role behaves as the platform's own
// item does - copy and paste in a text field on macOS need the Edit menu's
// roles, and Electron does not say so - with the label set here in the
// app's sentence case. About on Windows and Linux is not the `about` role,
// which is a native message box there (rules/main.md, "Native dialogs"): it
// opens Settings at its versions, which already say the app's version.
//
// Reload, Force reload and Toggle developer tools are a development build's
// only. Nothing is hidden by state: an item that cannot act right now acts on
// nothing (the page ignores a command while a modal dialog is open).
//
// No Electron import, so the template is tested without a session; index.ts
// builds it and hands in what each item does.

import type { HelpPage, MenuCommand } from '../shared/menu'

/** The system's items this menu uses, by Electron's names for them. */
export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'close'
  | 'minimize'
  | 'editMenu'
  | 'windowMenu'
  | 'help'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'

/** One item of the template: the part of Electron's own options this menu uses. */
export interface MenuItemTemplate {
  id?: string
  label?: string
  role?: MenuRole
  type?: 'separator'
  accelerator?: string
  visible?: boolean
  /** macOS only: a hidden item's accelerator still fires. */
  acceleratorWorksWhenHidden?: boolean
  submenu?: MenuItemTemplate[]
  click?: () => void
}

/** What an item of the app's own does: tell the page, or open a Help page. */
export type MenuAction =
  { kind: 'command'; command: MenuCommand } | { kind: 'help'; page: HelpPage }

export interface MenuOptions {
  /** `process.platform`. */
  platform: string
  /** `app.isPackaged`: a packaged build has no Reload and no developer tools. */
  packaged: boolean
  /** The product's name, as the app menu and its items say it. */
  name: string
  /** What happens when one of the app's own items is chosen. */
  act?: (action: MenuAction) => void
}

const SEPARATOR: MenuItemTemplate = { type: 'separator' }

/**
 * The Help pages the menu offers, in its order. "Finding a feed" is not one
 * yet: its page, `docs/feeds.md`, comes with issue 555, which adds the item
 * with it, so the menu never opens a page that is not there.
 */
export const MENU_HELP_PAGES: readonly HelpPage[] = ['guide', 'install', 'report']

/** The whole menu bar for one platform. */
export function menuTemplate(options: MenuOptions): MenuItemTemplate[] {
  const { name, packaged } = options
  const act = options.act ?? (() => undefined)
  const mac = options.platform === 'darwin'
  // A label gets its access key on Windows and Linux (Alt and the letter, or
  // the letter in an open menu); macOS has none and would show the
  // ampersand. A top-level label takes its first letter.
  const key = (label: string): string => (mac ? label.replace('&', '') : label)
  const top = (label: string): string => key(`&${label}`)
  const command = (id: MenuCommand, label: string, accelerator?: string): MenuItemTemplate => ({
    id,
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    click: () => act({ kind: 'command', command: id }),
  })
  const help = (page: HelpPage, label: string): MenuItemTemplate => ({
    id: `help-${page}`,
    label,
    click: () => act({ kind: 'help', page }),
  })

  const newProject = command('new-project', 'New project…', 'CmdOrCtrl+N')
  const edit: MenuItemTemplate = { label: top('Edit'), role: 'editMenu' }
  const view: MenuItemTemplate = {
    label: top('View'),
    submenu: [
      { label: 'Actual size', role: 'resetZoom' },
      // The two zooms share a first letter, so each takes its second word's.
      { label: key('Zoom &in'), role: 'zoomIn' },
      // The role's own accelerator is Plus, which takes Shift on most
      // keyboards; the key beside it, unshifted, zooms in too.
      {
        label: key('Zoom &in'),
        role: 'zoomIn',
        accelerator: 'CmdOrCtrl+=',
        visible: false,
        acceleratorWorksWhenHidden: true,
      },
      { label: key('Zoom &out'), role: 'zoomOut' },
      SEPARATOR,
      { label: 'Full screen', role: 'togglefullscreen' },
      ...(packaged
        ? []
        : [
            SEPARATOR,
            { label: 'Reload', role: 'reload' as const },
            { label: 'Force reload', role: 'forceReload' as const },
            { label: 'Toggle developer tools', role: 'toggleDevTools' as const },
          ]),
    ],
  }
  const helpItems: MenuItemTemplate[] = [
    help('guide', `${name} guide`),
    help('install', 'Install and troubleshooting guide'),
    SEPARATOR,
    help('report', 'Report a problem'),
    command('copy-diagnostics', 'Copy diagnostics'),
  ]

  if (mac) {
    return [
      {
        label: name,
        submenu: [
          { label: `About ${name}`, role: 'about' },
          SEPARATOR,
          command('settings', 'Settings…', 'CmdOrCtrl+,'),
          SEPARATOR,
          { label: 'Services', role: 'services' },
          SEPARATOR,
          { label: `Hide ${name}`, role: 'hide' },
          { label: 'Hide others', role: 'hideOthers' },
          { label: 'Show all', role: 'unhide' },
          SEPARATOR,
          { label: `Quit ${name}`, role: 'quit' },
        ],
      },
      { label: 'File', submenu: [newProject, SEPARATOR, { label: 'Close window', role: 'close' }] },
      edit,
      view,
      { label: 'Window', role: 'windowMenu' },
      // The `help` role makes it the system's Help menu, with its search field.
      { label: 'Help', role: 'help', submenu: helpItems },
    ]
  }
  return [
    {
      label: top('File'),
      submenu: [
        newProject,
        command('settings', 'Settings', 'CmdOrCtrl+,'),
        SEPARATOR,
        { label: options.platform === 'win32' ? 'Exit' : 'Quit', role: 'quit' },
      ],
    },
    edit,
    view,
    {
      label: top('Window'),
      submenu: [
        { label: 'Minimize', role: 'minimize' },
        { label: 'Close window', role: 'close' },
      ],
    },
    {
      label: top('Help'),
      submenu: [...helpItems, SEPARATOR, command('about', `About ${name}`)],
    },
  ]
}
