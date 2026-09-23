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
// The region is always in the document. A collapsed cell keeps its
// controls mounted, hidden, because a half-typed value and a running
// Cancel both live inside one and unmounting loses them silently; that is
// the same rule `kit/Tabs.tsx`'s `TabPanel` already follows.

export interface DisclosureProps {
  /** What the button says: the row's own contents, not a string. */
  summary: ReactNode
  open: boolean
  onToggle: (open: boolean) => void
  /** Read to assistive technology in place of the row's contents. */
  label: string
  /** The region's own accessible name, when it is not the label. */
  regionLabel?: string
  className?: string
  headingRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}

export default function Disclosure({
  summary,
  open,
  onToggle,
  label,
  regionLabel,
  className,
  headingRef,
  children,
}: DisclosureProps): JSX.Element {
  const id = useId()
  const regionId = `${id}-region`
  const buttonId = `${id}-toggle`
  return (
    <>
      <button
        type="button"
        id={buttonId}
        ref={headingRef}
        className={className}
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={label}
        onClick={() => onToggle(!open)}
      >
        {summary}
      </button>
      <div
        id={regionId}
        role="region"
        aria-label={regionLabel ?? label}
        hidden={!open}
        className="disclosure-region"
      >
        {children}
      </div>
    </>
  )
}
