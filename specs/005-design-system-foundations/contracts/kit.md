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

`Button` hands `aria-label` to the kit, which copies it onto the
`<button>` in its shadow root, and mirrors `aria-expanded`,
`aria-pressed` and `aria-disabled` onto that button itself. An id
reference set on that button resolves inside the shadow root, where the
page's elements are not. So `aria-describedby` is never given to the kit
(docs/accessibility.md, F5): the wrapper writes the described elements'
text onto the inner button as `aria-description` instead, follows it with
a `MutationObserver` on the button's document, and removes it when the
prop goes or the button unmounts (issue 113). The wrapper does not take
`aria-labelledby`, which would fail the same way.

`aria-controls` is never written as an attribute either, on the host or
the inner button, because an id there relates the button to nothing
(docs/accessibility.md, F6). The wrapper resolves the ids in the button's
document and sets the elements themselves as the inner button's
`ariaControlsElements`, which Chromium's accessibility tree takes as the
button's `controls` relation across the shadow boundary (measured in
Chromium 151 and 153 with the kit's `fig.js`, either side of Electron
44.2.0's Chromium 152). It follows the document with a `MutationObserver`,
since a controlled element renders after its button, goes and comes back
as another element, clears the reference when no named element is left,
when the prop goes and when the button unmounts, and sets it again after
any change of `disabled` (`mirrorControls`, issue 121). The choice over
dropping `aria-controls` from kit buttons: the relation can be carried and
read back in a test, so a caller's claim stays true. Setting the attribute
clears an element reference, so nothing else may write `aria-controls` on
the inner button, the wrapper's own state syncing included.

The kit observes `disabled` on the host and, inside every change of it,
re-syncs its inner button synchronously, removing `aria-pressed` from the
host and the inner button of any button that is not its own toggle. So
`Button` writes `disabled` and the mirrored attributes (`aria-expanded`,
`aria-pressed`, `aria-disabled`, and `data-unavailable` on the host) in one effect that runs whenever any of them changes,
`disabled` first, so the mirrored state is re-applied after the kit's
re-sync (`syncKitButton`, issue 124). The re-sync does not touch
`aria-description` or `aria-controls`.

Each wrapper: a `ref` to the element; `value` set through the ref in an
effect (never in JSX); listeners attached in an effect; `forwardRef` so a
screen can focus the control. Labels stay native `<label htmlFor>` and the
wrappers pass `id` through.
