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
  /** The interface themes it holds in; all of them when left out. Excuses and staleness are judged in these alone. */
  themes?: readonly string[]
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
  {
    // The same rule on a project's card: named "Open <project>", while the
    // card shows the name and its facts.
    rule: 'label-content-name-mismatch',
    selector: 'ul[aria-label="Projects"] > li > button.card:not(.card-new)',
    issue: 707,
    expectedOn: ['Library, with a project'],
  },
  {
    // The rail's step buttons (`Rail.tsx`, `stepName`), each given an
    // `aria-label` of its number, name and state ("01 Data, ready") over
    // three spans that say them without the punctuation. They are the
    // `button[aria-label="01 Data, ready"]` of the first run, not the
    // cells' own headers, which carry no label of their own.
    rule: 'label-content-name-mismatch',
    selector: 'nav[aria-label="Steps"] button.rail-step',
    issue: 707,
    expectedOn: [
      'a sample, its download in cell 01',
      'cell 01, the network in words closed',
      'cell 01, the network in words open',
      'cell 01, the network in words open with a line’s stations',
      'the delete confirmation',
      'the inspector',
      'the project, a colour picker open',
      'the project, an export finished',
      'the project, cell 06 open',
      'the project, every cell closed',
      'the project, its notebook',
      'the project, renaming',
      'the project, the engine log open',
      "the project, the layout tuning and a line's options open",
      'the project, the transport drawn',
      'the project, the trip’s pickers used',
      'the re-layout warning',
    ],
  },
  {
    // Settings' folder buttons, named "Choose the export folder" over their
    // own words. The real `button` is in the kit button's shadow root, so
    // the selector is the inner element's own. Only drawn when the folder
    // is not locked.
    rule: 'label-content-name-mismatch',
    selector: '.fig-button-control[aria-label="Choose the export folder"]',
    issue: 707,
    expectedOn: ['Settings', 'Settings, with the Bundled tools rows'],
  },
  {
    rule: 'label-content-name-mismatch',
    selector: '.fig-button-control[aria-label="Choose the engine data folder"]',
    issue: 707,
    expectedOn: ['Settings', 'Settings, with the Bundled tools rows'],
  },
  {
    // The Jobs toggle while a job runs, named "Jobs, 1 running". It has no
    // `expectedOn` on purpose: the download holds the job for about twenty
    // seconds, which two themes of axe and the Tab walks can outlast, and
    // the toggle then reads "Jobs" and a stale check would fail a correct
    // build. It is excused where it is seen and never checked for
    // staleness; issue 707 tracks its removal.
    rule: 'label-content-name-mismatch',
    selector: '.fig-button-control[aria-label^="Jobs, "]',
    issue: 707,
    expectedOn: [],
  },
  // Colour contrast, in Night only (issue 710): the words of two
  // disclosures (a line's options, the network in words) and the engine
  // log's toggle. The layout tuning's toggle passes: the first run's two
  // unnamed disclosures on its screen were the lines' option toggles.
  {
    rule: 'color-contrast',
    selector: 'button.line-options-toggle',
    issue: 710,
    expectedOn: ["the project, the layout tuning and a line's options open"],
    themes: ['Night'],
  },
  {
    rule: 'color-contrast',
    selector: 'button.line-options-toggle > .line-options-word',
    issue: 710,
    expectedOn: ["the project, the layout tuning and a line's options open"],
    themes: ['Night'],
  },
  {
    rule: 'color-contrast',
    selector: 'button.network-words-toggle',
    issue: 710,
    expectedOn: [
      'cell 01, the network in words open',
      'cell 01, the network in words open with a line’s stations',
    ],
    themes: ['Night'],
  },
  {
    rule: 'color-contrast',
    selector: 'button.engine-log-toggle',
    issue: 710,
    expectedOn: ['the project, the engine log open'],
    themes: ['Night'],
  },
  {
    rule: 'color-contrast',
    selector: 'button.engine-log-toggle > .engine-log-count',
    issue: 710,
    expectedOn: ['the project, the engine log open'],
    themes: ['Night'],
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
 * theme, which `expectedOn` is compared with, exactly; `theme` is compared
 * with an entry's `themes`.
 */
export function judgeAxe(
  violations: readonly AxeResult[],
  incomplete: readonly AxeResult[],
  { where, theme }: { where: string; theme: string },
  known: readonly KnownFinding[] = KNOWN_FINDINGS,
): AxeJudgement {
  const due = known.filter((k) => k.themes === undefined || k.themes.includes(theme))
  const used = new Set<KnownFinding>()
  const failures: string[] = []
  const excused: string[] = []
  for (const result of violations) {
    for (const node of result.nodes) {
      const entry = due.find((k) => k.rule === result.id && node.matches.includes(k.selector))
      if (entry === undefined) {
        failures.push(describeNode(result.id, node))
      } else {
        used.add(entry)
        excused.push(`${describeNode(result.id, node)} (issue ${entry.issue})`)
      }
    }
  }
  const stale = due
    .filter((k) => k.expectedOn.includes(where) && !used.has(k))
    .map((k) => `${k.rule} on ${k.selector} (issue ${k.issue}) matched nothing on ${where}`)
  const open = incomplete.flatMap((r) => r.nodes.map((n) => describeNode(r.id, n)))
  return { failures, stale, excused, incomplete: open }
}

/**
 * Which of `selectors` the one element `path` names matches. `path` is axe's
 * selector for a node: a string, or, for an element inside open shadow roots,
 * one selector per root, outermost first (the kit's buttons keep the real
 * `button` in the host's shadow root, which `querySelectorAll` and a
 * descendant combinator do not enter). It is run in the page, as source
 * (`.toString()`), so it holds no reference to anything outside itself. An
 * answer is given only when exactly one element matches at every step; an
 * empty one when none does, several do, a step has no open shadow root to go
 * into, or a selector will not parse, so a node is never excused on the
 * strength of a different element.
 */
export function selectorsMatching(
  root: ParentNode,
  path: string | string[],
  selectors: string[],
): string[] {
  try {
    const steps = typeof path === 'string' ? [path] : path
    if (steps.length === 0) return []
    let scope: ParentNode = root
    let element: Element | null = null
    for (let i = 0; i < steps.length; i++) {
      const found = scope.querySelectorAll(steps[i])
      if (found.length !== 1) return []
      element = found[0]
      if (i < steps.length - 1) {
        if (element.shadowRoot === null) return []
        scope = element.shadowRoot
      }
    }
    const target = element as Element
    return selectors.filter((selector) => target.matches(selector))
  } catch {
    return []
  }
}
