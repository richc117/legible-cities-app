import type { JSX } from 'react'

// Past the map, from the keyboard (issue 106, finding F3 in
// docs/accessibility.md). The viewer's frame holds the engine's page, and
// every control on that page is a Tab stop between the project's panels and
// its own toolbar. This is the bypass-blocks pattern (WCAG 2.4.1): a control
// just before the frame, out of sight until it takes focus, that moves focus
// to the first thing after the frame. It does not reach into the frame, which
// the app never scripts (ADR-028); a person who wants the map presses Tab
// again instead and walks into it as before (DESIGN.md 8.2, "Skip past the
// map").

/** What the choice reads of a candidate: a kit button carries `disabled` on its host. */
export type SkipCandidate = Pick<Element, 'hasAttribute' | 'isConnected'>

/**
 * Where focus goes: the first candidate that can take it, in the order the
 * toolbar draws them, or the fallback when none can: a project's Rename is
 * disabled while it is read-only and its Delete while a run or an export
 * goes, and should both be at once, focus still lands after the map rather
 * than nowhere.
 */
export function skipTarget<T extends SkipCandidate>(
  candidates: readonly (T | null)[],
  fallback: T | null,
): T | null {
  return (
    candidates.find(
      (candidate): candidate is T =>
        candidate !== null && candidate.isConnected && !candidate.hasAttribute('disabled'),
    ) ?? fallback
  )
}

export default function SkipPastMap({ onSkip }: { onSkip: () => void }): JSX.Element {
  // A button and not a link: it moves focus by script, and a fragment link
  // would rewrite the window's address and move nothing a kit button holds.
  return (
    <button type="button" className="skip-link" onClick={onSkip}>
      Skip past the map
    </button>
  )
}
