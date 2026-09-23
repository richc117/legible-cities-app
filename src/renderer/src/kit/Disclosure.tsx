import { useId, type JSX, type ReactNode } from 'react'

// A disclosure: a real button carrying `aria-expanded` over a region it
// names, on the WAI-ARIA disclosure pattern (docs/DESIGN.md 8.2, "The
// cell").
//
// Not FigUI3's, for the reason `kit/Tabs.tsx` already records: the kit's
// composite controls watch their children with a mutation observer and add
// elements of their own among them, and React owns those children.
//
// And not `<details>`/`<summary>`, which is the other obvious answer. The
// cell's heading row carries three things beside the toggle's name - the
// number, the state and, while it is collapsed, a sentence saying what the
// cell holds - and `<summary>`'s own layout owns that row. A button and a
// region put the row where the design document draws it and cost nothing
// but this file.
//
// The disclosed part is a named `group`, not a `region`. A region is a
// landmark, and six cells would put six of them in a screen reader's
// landmark menu beside the main region and the inspector, where they say
// nothing a person navigating landmarks wants. The WAI-ARIA disclosure
// pattern asks for no role on the disclosed content at all; a named group
// keeps the name without the landmark.
//
// The disclosed part is always in the document. A collapsed cell keeps its
// controls mounted, hidden, because a half-typed value and a running
// Cancel both live inside one and unmounting loses them silently; that is
// the same rule `kit/Tabs.tsx`'s `TabPanel` already follows.

export interface DisclosureProps {
  /** What the button says: the row's own contents, not a string. */
  summary: ReactNode
  open: boolean
  onToggle: (open: boolean) => void
  /**
   * The disclosed part's own accessible name. The button's name is its
   * contents: a label here would replace them, and then everything a cell
   * puts in its row would have to be repeated in a string beside it.
   */
  label: string
  className?: string
  /**
   * The heading the button sits in, where the disclosure is a section of
   * the page rather than a control in a form: a notebook of six is walked
   * by heading, and something has to be there to walk to. Omitted, the
   * button stands alone, which is right for a disclosure inside a row.
   */
  heading?: 'h2' | 'h3'
  headingRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}

export default function Disclosure({
  summary,
  open,
  onToggle,
  label,
  className,
  heading: Heading,
  headingRef,
  children,
}: DisclosureProps): JSX.Element {
  const id = useId()
  const regionId = `${id}-region`
  const toggle = (
    <button
      type="button"
      ref={headingRef}
      className={className}
      aria-expanded={open}
      aria-controls={regionId}
      onClick={() => onToggle(!open)}
    >
      {summary}
    </button>
  )
  return (
    <>
      {Heading === undefined ? toggle : <Heading className="disclosure-heading">{toggle}</Heading>}
      <div
        id={regionId}
        role="group"
        aria-label={label}
        hidden={!open}
        className="disclosure-region"
      >
        {children}
      </div>
    </>
  )
}
