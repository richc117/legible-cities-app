# Contract: the tokens

Values per theme and the contrast the test asserts. "on bg" is against
`--surface`; "on raised" against `--surface-raised`. Text needs 4.5,
controls and icons 3.0.

Every value here is the interface's own and lives in `theme.css`
(ADR-044). The theme identifiers stay the engine's - the dark theme takes
no attribute, the light one `data-theme="sepia"` - because a project's map
wears the engine's two and they must keep matching. The names a person
reads are **Night** and **Parchment**, and they name these colours only;
`tokens.css` still holds the engine page's own two blocks, drift-tested
and loaded by nothing.

## Ground and ink

| Token | Night | Parchment |
|---|---|---|
| `--bg` | #1a1410 | #f5e6c8 |
| `--bg-soft` | #211c17 | #e9dabe |
| `--text` | #f5ead8 | #2d241d |
| `--muted` | #c4bbac | #5c5347 |
| `--border` | #37322d | #c0b39b |
| `--focus` | var(--line-cobalt) #6f9bff | var(--line-cobalt) #2a5bb5 |

## The brand lines

Identity, never a state. Nothing consumes them yet; the icon and the
progress line will.

| Token | Night | Parchment |
|---|---|---|
| `--line-vermilion` | #f05a40 | #d6402a |
| `--line-cobalt` | #6f9bff | #2a5bb5 |
| `--line-saffron` | #f5ad35 | #eb9a1c |
| `--line-jade` | #3fb47c | #1d8757 |
| `--station-fill` | #1a1410 | #fffaf0 |
| `--station-ink` | #f5ead8 | #2d241d |

## Ramp (`--tone-N`)

| N | Night | Parchment |
|---|---|---|
| 0 | #1a1410 | #f5e6c8 |
| 1 | #221d18 | #eddec1 |
| 2 | #2a2621 | #e5d6ba |
| 3 | #34302a | #dacdb2 |
| 4 | #3f3b35 | #d0c2a9 |
| 5 | #4e4842 | #c3b79f |
| 6 | #5f5a52 | #b3a791 |
| 7 | #767066 | #9e9380 |
| 8 | #938c80 | #837969 |
| 9 | #b5ad9f | #655c4f |
| 10 | #d8cebe | #453d34 |
| 11 | #f5ead8 | #2d241d |

## Semantic

| Token | Night | Parchment | Asserted |
|---|---|---|---|
| `--surface` | var(--bg) | var(--bg) | — |
| `--surface-raised` | var(--bg-soft) | var(--bg-soft) | — |
| `--surface-sunken` | var(--tone-2) | var(--tone-2) | — |
| `--surface-hover` | var(--tone-2) | var(--tone-1) | — |
| `--surface-selected` | var(--tone-3) | var(--tone-3) | — |
| `--border-strong` | var(--tone-7) | var(--tone-8) | ≥ 3.0 on bg and raised |
| `--text-muted` | var(--muted) | var(--muted) | ≥ 4.5 on bg, raised, sunken, selected |
| `--text-faint` | var(--tone-8) | var(--tone-9) | ≥ 4.5 on bg and raised |
| `--accent` | var(--line-cobalt) #6f9bff | var(--line-cobalt) #2a5bb5 | ≥ 3.0 on bg and raised (control) |
| `--accent-text` | var(--line-cobalt) #6f9bff | #2753a6 | ≥ 4.5 on bg and raised |
| `--on-accent` | var(--bg) #1a1410 | var(--bg) #f5e6c8 | ≥ 4.5 on `--accent` in both themes |
| `--success` | #5fb37a | #2f7a4f | ≥ 3.0 on bg and raised |
| `--success-strong` | #5fb37a | #276a44 | ≥ 4.5 on bg and raised (status text) |
| `--warning` | #e0a83a | #83560f | ≥ 4.5 on bg and raised |
| `--error` | #e0574a | #b3261e | ≥ 4.5 on bg and raised |
| `--selection` | color-mix(in srgb, var(--accent) 30%, transparent) | color-mix(in srgb, var(--accent) 25%, transparent) | — |
| `--text` on every surface (bg, raised, sunken, hover, selected) | | | ≥ 4.5 |
| `--focus` on bg and raised | | | ≥ 3.0 |

### Which ground a colour may be drawn on

The figures above are against `--surface`. On the denser grounds some fall
short, so the rule is the narrow one that holds in both themes:

- `--error`, `--warning` and `--border-strong`: `--surface` and
  `--surface-raised` only.
- `--text-faint` and `--success-strong`: everywhere except
  `--surface-selected`.
- `--text`, `--text-muted`, `--accent`, `--accent-text` and `--focus`:
  every ground, both themes.

## Scale

| Token | Value |
|---|---|
| `--font-ui-smaller` / `--font-ui-small` / `--font-ui` / `--font-ui-medium` / `--font-ui-large` | 11px / 12px / 13px / 15px / 20px |
| `--line-ui-tight` / `--line-ui` / `--line-ui-large` | 16px / 20px / 24px |
| `--font-text` / `--font-text-small` / `--line-text` | 18px / 0.86em / 1.72 |
| `--font-chrome` | system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif |
| `--font-prose` | "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif |
| `--font-mono` | ui-monospace, "SF Mono", Menlo, Consolas, monospace |
| `--space-2-1` … `--space-2-3` | 2px 4px 6px |
| `--space-4-1` … `--space-4-16` | 4 8 12 16 20 24 32 48 64px (multiples 1 2 3 4 5 6 8 12 16) |
| `--control-height` / `-small` / `-large` | 28px / 24px / 32px |
| `--icon-size` / `--icon-size-large` | 16px / 24px |
| `--target-min` | 24px |
| `--radius-small` / `--radius` / `--radius-large` / `--radius-pill` | 2px / 4px / 8px / 999px |
| `--border-width` | 1px |
| `--focus-ring-width` / `--focus-ring-offset` | 2px / 2px |
| `--dialog-width` / `--dialog-width-wide` / `--measure` | 28rem / 40rem / 40rem |
| `--layer-base` / `-raised` / `-overlay` / `-dialog` / `-toast` | 0 / 10 / 100 / 1000 / 1100 |
| `--duration-fast` / `--duration` / `--easing` | 120ms / 200ms / cubic-bezier(0.2, 0, 0, 1) |
| `--backdrop-opacity` | 0.6 |
