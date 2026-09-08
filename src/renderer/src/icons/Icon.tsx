import type { JSX } from 'react'
import mark from './mark.svg?raw'

// The interface's icons: Phosphor's files vendored under ./phosphor (light
// at 16px, regular at 24px, fill for a toggled state) and the app's own
// mark, inlined so they take currentColor. Decorative unless a label is
// given, in which case the icon is an image with that name.
// docs/DESIGN.md, section 6.
const files = import.meta.glob('./phosphor/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const ICON_NAMES = [
  'train',
  'map',
  'layers',
  'route',
  'clock',
  'play',
  'pause',
  'export',
  'settings',
  'warning',
  'check',
  'close',
  'add',
  'trash',
  'edit',
  'back',
  'forward',
  'info',
  'spinner',
] as const

export type IconName = (typeof ICON_NAMES)[number] | 'mark'

interface Props {
  name: IconName
  size?: 16 | 24
  /** A toggled state's glyph, where the set has one. */
  fill?: boolean
  /** Given, the icon is an image with this name; absent, it is decorative. */
  label?: string
  className?: string
}

export function iconMarkup(name: IconName, size: 16 | 24, fill = false): string {
  if (name === 'mark') return mark
  const key = `./phosphor/${name}-${fill ? 'fill' : size}.svg`
  const markup = files[key]
  if (markup === undefined) throw new Error(`no icon file for ${name} at ${fill ? 'fill' : size}`)
  return markup
}

export default function Icon({ name, size = 16, fill, label, className }: Props): JSX.Element {
  const classes = ['icon', size === 24 ? 'icon-24' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <span
      className={classes}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: iconMarkup(name, size, fill) }}
    />
  )
}
