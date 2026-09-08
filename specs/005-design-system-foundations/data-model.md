# Data model: Design system foundations

Nothing is stored. These are the names the code and the tests share.

## Token tiers

| Tier | File | Selector | Names |
|---|---|---|---|
| 1 brand | `tokens.css` | `:root`, `:root[data-theme="sepia"]` | `--bg --bg-soft --text --muted --border --link-hover --focus --map-*` (unchanged, drift-tested) |
| 2 ramp | `theme.css` | same two selectors | `--tone-0` … `--tone-11` |
| 3 semantic | `theme.css` | same two selectors | `--surface --surface-raised --surface-sunken --surface-hover --surface-selected --border-strong --text-muted --text-faint --accent --accent-text --on-accent --success --success-strong --warning --error --selection` (plus `--border`, `--text`, `--focus` from tier 1) |
| scale | `scale.css` | `:root` | `--font-ui-smaller --font-ui-small --font-ui --font-ui-medium --font-ui-large`, `--font-text --font-text-small`, `--line-ui-tight --line-ui --line-ui-large --line-text`, `--font-chrome --font-prose --font-mono`, `--space-2-1 … --space-4-16`, `--control-height --control-height-small --control-height-large --icon-size --icon-size-large --target-min`, `--radius-small --radius --radius-large --radius-pill --border-width`, `--focus-ring-width --focus-ring-offset`, `--dialog-width --dialog-width-wide --measure`, `--layer-*`, `--duration-fast --duration --easing`, `--backdrop-opacity` |
| 4 component | `app.css` | component rules | derived only; no new colour or size values |
| adapter | `figui-adapter.css` | `:root` (unlayered) | `--figma-color-*`, `--figma-focus-outline*`, the kit's type and spacer tokens |

The theme attribute is the engine's: no attribute is warm-dark,
`data-theme="sepia"` is the light theme. `theme.css` repeats the two
selectors `tokens.css` uses.

## Semantic token values

See `contracts/tokens.md` for every value and its contrast; the design
document's section 3 is the source and the contract is the copy the test
reads back.

## ProgressLine

```ts
interface Stage {
  id: string
  label: string                       // "topo"
  state: 'pending' | 'running' | 'done' | 'failed'
  message?: string                    // the engine's sentence for the stage
}
interface ProgressLineProps {
  stages: Stage[]
  /** The sentence beside the line: the running stage's message, or the failure. */
  ariaLabel: string
}
```

Geometry: a horizontal line two grid units down a 48px-high SVG, the
labels beneath it, stages twelve units apart; the line begins with a
45-degree lead-in segment of one grid unit (Beck's join). Every mark is
the same 8-unit square, and the state's class shapes it with a transform:
a pending stage a 2px vertical tick, a done stage a filled 4px tick, the
running stage a hollow diamond of 10px in `--accent` with a 2px stroke, a
failed stage a filled diamond in `--error`. Labels sit under the marks at
`--font-ui-small`; the current message below the line at `--font-ui`.
Under reduced motion the diamond becomes a tick at once; otherwise over
`--duration`, because the element stays and only its class changes.

## Icon

```ts
type IconName = 'train' | 'map' | 'layers' | 'route' | 'clock' | 'play' | 'pause'
  | 'export' | 'settings' | 'warning' | 'check' | 'close' | 'add' | 'trash'
  | 'edit' | 'back' | 'forward' | 'info' | 'spinner' | 'mark'
interface IconProps { name: IconName; size?: 16 | 24; label?: string }
```

Without `label` the icon is `aria-hidden`; with one it is `role="img"`
with that name. `size` selects the light (16) or regular (24) file; the
mark has one drawing used at both sizes.
