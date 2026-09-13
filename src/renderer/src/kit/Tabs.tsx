import { useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'

// A tab strip, on the WAI-ARIA tabs pattern (A5-01, specs/022-export-tab):
// a `tablist` of real buttons, one tab stop for the whole strip, the arrow
// keys moving between tabs and choosing the one they land on, Home and End
// to the ends, `aria-selected` on the chosen tab and `aria-controls` naming
// its panel. The panels are `TabPanel`, labelled by their tab.
//
// Not FigUI3's `fig-tabs`, although its MIT core has one: it watches its
// children with a mutation observer and adds scroll buttons of its own
// among them, and React owns those children. Plain buttons carry the
// platform's role, name and focus with nothing to mirror by hand
// (docs/DESIGN.md 8.2, "Tabs").

export interface Tab<T extends string> {
  id: T
  label: string
}

/**
 * The tab a key moves to from the current one, or null for a key the strip
 * does not use. Automatic activation: the tab focus lands on is chosen.
 */
export function tabAfterKey<T extends string>(
  tabs: readonly Tab<T>[],
  current: T,
  key: string,
): T | null {
  if (tabs.length === 0) return null
  const at = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === current),
  )
  switch (key) {
    case 'ArrowRight':
      return tabs[(at + 1) % tabs.length].id
    case 'ArrowLeft':
      return tabs[(at - 1 + tabs.length) % tabs.length].id
    case 'Home':
      return tabs[0].id
    case 'End':
      return tabs[tabs.length - 1].id
    default:
      return null
  }
}

/** The ids a strip gives its tabs and panels, so each can name the other. */
export const tabId = (prefix: string, id: string): string => `${prefix}-tab-${id}`
export const panelId = (prefix: string, id: string): string => `${prefix}-panel-${id}`

interface TabsProps<T extends string> {
  tabs: readonly Tab<T>[]
  selected: T
  onSelect: (id: T) => void
  /** What the strip chooses between, for a screen reader. */
  label: string
  /** Unique on the page; the tabs' and panels' ids are made from it. */
  idPrefix: string
}

export default function Tabs<T extends string>({
  tabs,
  selected,
  onSelect,
  label,
  idPrefix,
}: TabsProps<T>): JSX.Element {
  const buttons = useRef(new Map<T, HTMLButtonElement>())

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = tabAfterKey(tabs, selected, event.key)
    if (next === null) return
    event.preventDefault()
    onSelect(next)
    buttons.current.get(next)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const chosen = tab.id === selected
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) buttons.current.delete(tab.id)
              else buttons.current.set(tab.id, element)
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            className="tab"
            aria-selected={chosen}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * One tab's panel. Kept in the document while another tab is chosen, and
 * hidden: a panel holds work a person has started - a colour waiting to be
 * drawn, a start time half typed - and unmounting it would throw that away.
 */
export function TabPanel({
  idPrefix,
  id,
  selected,
  children,
}: {
  idPrefix: string
  id: string
  selected: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div
      role="tabpanel"
      className="tab-panel"
      id={panelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      hidden={!selected}
    >
      {children}
    </div>
  )
}
