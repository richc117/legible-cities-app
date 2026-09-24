import type { JSX } from 'react'

// The project's own left rail (ADR-045, docs/DESIGN.md 8.2 and 9): the six
// cells as a numbered stepper, and below them what the project has made.
//
// A stub, drawing nothing. It is here so that A5.5-10 (the stepper) and
// A5.5-11 (the outputs) each rewrite one file rather than inserting into
// the project screen, which fourteen of this milestone's open issues would
// otherwise share; `rail.css` is the same seam for its rules.
//
// It renders null rather than an empty element on purpose: an empty <nav>
// with no name is a landmark saying nothing, and the rail's name, its
// `aria-current="step"` and its `inert` while the inspector covers the
// main region are decisions that belong to the branch that draws it.

export default function Rail(): JSX.Element | null {
  return null
}
