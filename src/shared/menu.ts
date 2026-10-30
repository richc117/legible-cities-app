// What the app's own menu can say across the bridge (issue 554), in both
// directions, as closed sets: the commands main sends the page when a menu
// item belongs to the interface, and the help pages the page may ask main to
// open. Neither carries anything else. A help page is a name, never an
// address: main holds the addresses (`HELP_PAGES`, src/main/help-ipc.ts), so
// nothing the page sends can choose where the browser goes.

/**
 * The menu's items that the interface answers, because only the page holds
 * what they need: the Library's sheet, the Settings screen and the reports
 * of the maps drawn this session, which "Copy diagnostics" gathers.
 */
export const MENU_COMMANDS = ['new-project', 'settings', 'copy-diagnostics', 'about'] as const
export type MenuCommand = (typeof MENU_COMMANDS)[number]

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value)
}

/**
 * The pages the Help menu opens in the platform's browser, by name: the
 * guide, finding a feed, installing and troubleshooting, and the tracker's
 * bug form.
 */
export const HELP_PAGE_KEYS = ['guide', 'feeds', 'install', 'report'] as const
export type HelpPage = (typeof HELP_PAGE_KEYS)[number]

export function isHelpPage(value: unknown): value is HelpPage {
  return typeof value === 'string' && (HELP_PAGE_KEYS as readonly string[]).includes(value)
}
