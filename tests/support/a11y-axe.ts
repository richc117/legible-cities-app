// The rule behind the sweeps' second net (issue 692): what to do with the
// findings of axe, run over a screen after the sweeps' own checks. It is a
// function of the findings and of the list below, so it is tested without
// the app (`tests/unit/a11y-axe.test.ts`); the call that gets the findings
// out of the page is `axeFindings` in `tests/support/a11y.ts`.
//
// - A violation is a finding unless the list excuses it, and a finding fails
//   the sweep.
// - An excuse is narrow: one rule, and a selector that the element itself
//   must match, so a new instance of the same rule anywhere else still
//   fails.
// - An excuse that matched nothing, on a screen where it was bound to, is a
//   finding too, so that the list cannot outlive the defect it was written
//   for.
// - `incomplete` results are never a pass: they are reported, to be
//   attached to the test and listed.

/** One element axe flagged, with what the page said about it. */
export interface AxeNode {
  /** axe's own selector for the element, one entry a frame deep. */
  target: string[]
  /**
   * The selectors of `KNOWN_FINDINGS` (by their `selector`) this very
   * element matches, asked of the page with `Element.matches` and not read
   * from `target`, which is a path axe chose and that changes with the DOM.
   */
  matches: string[]
}

export interface AxeResult {
  /** axe's rule id. */
  id: string
  impact: string | null
  nodes: AxeNode[]
}

export interface KnownFinding {
  rule: string
  /** A CSS selector the flagged element itself matches. */
  selector: string
  /** The issue that carries the defect. */
  issue: number
  /**
   * The sweeps that must find it, by their `where` text up to the theme: it
   * has to match something on each of them, or it is stale. Sweeps outside
   * the list are not judged for staleness, since the cards are not on them.
   */
  expectedOn: readonly string[]
}

/**
 * The defects axe finds that are decided, each with its issue. Narrow on
 * purpose, and an entry that matches nothing on a sweep it is expected on
 * fails that sweep.
 */
export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    // Label in Name (WCAG 2.5.3): axe joins the three spans of a sample
    // city's card with nothing between them, and compares that with the
    // name, which has ", " between the lines.
    rule: 'label-content-name-mismatch',
    selector: 'ul[aria-label="Presets"] > li > button.card',
    issue: 707,
    expectedOn: ['Library, empty', 'Library, with a project'],
  },
]

export interface AxeJudgement {
  /** Violations nothing excused, one line each, rule and element. */
  failures: string[]
  /** Entries that were due on this sweep and matched nothing. */
  stale: string[]
  /** What the list excused, listed so a reader sees it was used. */
  excused: string[]
  /** `incomplete` results, one line each, never passed. */
  incomplete: string[]
}

const describeNode = (rule: string, node: AxeNode): string => `${rule}: ${node.target.join(' ')}`

/**
 * Judge one sweep's axe results. `where` is the sweep's label without its
 * theme, which `expectedOn` is compared with, exactly.
 */
export function judgeAxe(
  violations: readonly AxeResult[],
  incomplete: readonly AxeResult[],
  where: string,
  known: readonly KnownFinding[] = KNOWN_FINDINGS,
): AxeJudgement {
  const used = new Set<KnownFinding>()
  const failures: string[] = []
  const excused: string[] = []
  for (const result of violations) {
    for (const node of result.nodes) {
      const entry = known.find((k) => k.rule === result.id && node.matches.includes(k.selector))
      if (entry === undefined) {
        failures.push(describeNode(result.id, node))
      } else {
        used.add(entry)
        excused.push(`${describeNode(result.id, node)} (issue ${entry.issue})`)
      }
    }
  }
  const stale = known
    .filter((k) => k.expectedOn.includes(where) && !used.has(k))
    .map((k) => `${k.rule} on ${k.selector} (issue ${k.issue}) matched nothing on ${where}`)
  const open = incomplete.flatMap((r) => r.nodes.map((n) => describeNode(r.id, n)))
  return { failures, stale, excused, incomplete: open }
}

/**
 * Which of `selectors` the one element `css` names matches. It is run in the
 * page, as source (`.toString()`), so it holds no reference to anything
 * outside itself. `css` is axe's selector for a node: it is an answer only
 * when exactly one element matches it, and an empty one is given when none
 * does, several do, or the selector will not parse, so a node is never
 * excused on the strength of a different element.
 */
export function selectorsMatching(root: ParentNode, css: string, selectors: string[]): string[] {
  try {
    const found = root.querySelectorAll(css)
    if (found.length !== 1) return []
    const element = found[0]
    return selectors.filter((selector) => element.matches(selector))
  } catch {
    return []
  }
}
