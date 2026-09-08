# Contract: the kit

## Import

`src/renderer/src/kit/index.ts` is the only module that imports the kit:

```ts
import '@rogieking/figui3/fig.css'
import '@rogieking/figui3/fig.js'
```

`package.json` pins `"@rogieking/figui3": "9.0.0"` (no range). The guard
plugin refuses any id matching `figui3/(dist/|src/)?fig-(editor|lab)` with:
`FigUI3's editor and lab bundles are PolyForm Shield licensed and cannot
ship in this GPL app; import only fig.css and fig.js (ADR-026).`

## Adapter (`figui-adapter.css`, unlayered, after the kit's stylesheet)

| Kit variable | From |
|---|---|
| `--figma-color-bg` | `--surface` |
| `--figma-color-bg-secondary`, `-bg-tertiary` | `--surface-raised`, `--surface-sunken` |
| `--figma-color-bg-hover`, `-bg-pressed`, `-bg-selected` | `--surface-hover`, `--surface-selected`, `--surface-selected` |
| `--figma-color-bg-menu`, `-bg-menu-hover` | `--surface-raised`, `--surface-hover` |
| `--figma-color-bg-brand`, `-bg-brand-hover`, `-bg-brand-pressed` | `--accent`, `--accent` (color-mix 88% with --text), `--accent` |
| `--figma-color-bg-danger`, `-bg-danger-hover` | `--error`, `--error` |
| `--figma-color-bg-warning`, `-bg-success` | `--warning`, `--success` |
| `--figma-color-bg-disabled`, `-bg-disabled-secondary` | `--surface-sunken`, `--surface-raised` |
| `--figma-color-text`, `-text-secondary`, `-text-tertiary`, `-text-disabled` | `--text`, `--text-muted`, `--text-faint`, `--text-faint` |
| `--figma-color-text-brand`, `-text-danger`, `-text-warning`, `-text-success` | `--accent-text`, `--error`, `--warning`, `--success-strong` |
| `--figma-color-text-onbrand`, `-text-ondanger`, `-text-onselected` | `--on-accent`, `--surface` (the ground on the error fill: 5.0 in warm-dark, 5.7 in sepia, asserted by the contrast test), `--text` |
| `--figma-color-icon`, `-icon-secondary`, `-icon-tertiary`, `-icon-disabled` | `--text`, `--text-muted`, `--text-faint`, `--text-faint` |
| `--figma-color-icon-brand`, `-icon-danger`, `-icon-onbrand` | `--accent`, `--error`, `--on-accent` |
| `--figma-color-border`, `-border-strong`, `-border-disabled` | `--border`, `--border-strong`, `--border` |
| `--figma-color-border-brand`, `-border-selected`, `-border-danger` | `--accent`, `--accent`, `--error` |
| `--figma-focus-outline` | `var(--focus-ring-width) solid var(--focus)` |
| `--figma-focus-outline-offset` | `var(--focus-ring-offset)` |
| `--font-family` | `--font-chrome` |
| `--font-size` (root) | 16px kept; body sizes overridden below |
| `--text-body-medium-font-size`, `-large-`, `-small-` | `--font-ui`, `--font-ui-medium`, `--font-ui-small` |
| `--line-height` | `--line-ui` |
| `--body-medium-fontWeight` | 400 |
| `--spacer-4` (control height) | `--control-height` |
| `color-scheme` | `dark` at `:root`, `light` at `:root[data-theme="sepia"]` |
| leak: native `<option>` | `option { background: var(--surface-raised); color: var(--text) }` |
| leak: checkbox stroke | the check glyph's colour overridden through `--figma-color-icon-onbrand` where the kit reads it; otherwise the wrapper's own check |

Any kit variable not listed keeps its `light-dark()` default, which the
adapter's `color-scheme` steers to the right side; the contrast test does
not cover those, so a screen that uses a new kit element checks it by
doing.

## Wrappers

| Wrapper | Element | Props | Events |
|---|---|---|---|
| `Button` | `<fig-button>` | `variant` (`primary` / `secondary` / `ghost` / `destructive`), `type` (`button` / `submit`), `disabled`, `icon` (icon-only), `size`, `aria-*`, `children` | `onClick` |
| `TextInput` | `<fig-input-text>` | `id`, `value`, `placeholder`, `disabled`, `size`, `aria-*`, `spellCheck` | `onChange(value)` on every `input` event (from `event.detail` or the inner input's `value`) |
| `Select` | `<fig-dropdown>` | `value`, `label`, `disabled`, `children: <option>` | `onChange(value)` |

Each wrapper: a `ref` to the element; `value` set through the ref in an
effect (never in JSX); listeners attached in an effect; `forwardRef` so a
screen can focus the control. Labels stay native `<label htmlFor>` and the
wrappers pass `id` through.
