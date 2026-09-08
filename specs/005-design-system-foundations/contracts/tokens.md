# Contract: the tokens

Values per theme and the contrast the test asserts. "on bg" is against
`--surface`; "on raised" against `--surface-raised`. Text needs 4.5,
controls and icons 3.0.

## Ramp (`--tone-N`)

| N | warm-dark | sepia |
|---|---|---|
| 0 | #15120f | #f7efe1 |
| 1 | #1e1b18 | #efe7d9 |
| 2 | #272420 | #e7dfd1 |
| 3 | #322e2b | #ddd5c8 |
| 4 | #3d3936 | #d3cabe |
| 5 | #4a4743 | #c7beb2 |
| 6 | #5c5854 | #b6aea2 |
| 7 | #726e69 | #a29a8f |
| 8 | #8f8a85 | #887f75 |
| 9 | #b0aba6 | #6a6158 |
| 10 | #d1ccc6 | #4b423a |
| 11 | #f2ede6 | #2d241d |

## Semantic

| Token | warm-dark | sepia | Asserted |
|---|---|---|---|
| `--surface` | var(--bg) | var(--bg) | — |
| `--surface-raised` | var(--bg-soft) | var(--bg-soft) | — |
| `--surface-sunken` | var(--tone-2) | var(--tone-2) | — |
| `--surface-hover` | var(--tone-2) | var(--tone-1) | — |
| `--surface-selected` | var(--tone-3) | var(--tone-3) | — |
| `--border-strong` | var(--tone-7) | var(--tone-8) | ≥ 3.0 on bg and raised |
| `--text-muted` | var(--muted) | var(--muted) | ≥ 4.5 on bg, raised, sunken, selected |
| `--text-faint` | var(--tone-8) | var(--tone-9) | ≥ 4.5 on bg and raised |
| `--accent` | #81a5ff | #4068cf | ≥ 3.0 on bg and raised (control) |
| `--accent-text` | #81a5ff | #2f56b8 | ≥ 4.5 on bg and raised |
| `--on-accent` | #15120f | #f2ede6 | ≥ 4.5 on `--accent` warm-dark; ≥ 3.0 on `--accent` sepia (large or bold text only) |
| `--success` | #5fb37a | #2f7a4f | ≥ 3.0 on bg and raised |
| `--success-strong` | #5fb37a | #276a44 | ≥ 4.5 on bg and raised (status text) |
| `--warning` | #e0a83a | #8a5a10 | ≥ 4.5 on bg and raised |
| `--error` | #e0574a | #b3261e | ≥ 4.5 on bg and raised |
| `--selection` | color-mix(in srgb, var(--accent) 30%, transparent) | color-mix(in srgb, var(--accent) 25%, transparent) | — |
| `--text` on every surface (bg, raised, sunken, hover, selected) | | | ≥ 4.5 |
| `--focus` on bg and raised | | | ≥ 3.0 |

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
