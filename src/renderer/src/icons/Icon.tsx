import type { JSX } from 'react'
import mark from './mark.svg?raw'

// The interface's icons: Phosphor's files vendored under ./phosphor (light
// at 16px, regular at 24px, fill for a toggled state), inlined so they take
// currentColor. Decorative unless a label is given, in which case the icon
// is an image with that name. docs/DESIGN.md, section 6.
//
// The mark is the exception and is not monochrome: it is the identity, and
// the identity is four coloured lines (ADR-044). It is inlined for a
// different reason - so the theme's --line-* tokens reach it - and it
// ignores currentColor entirely. Draw it at 24px or larger; at 16px the
// four lines and the gaps where they cross collapse into noise.
//
// mark.svg is the brand icon's small master (no stations) from
// assets/brand/icon/legible-cities-icon-small.svg, with its five colours
// swapped for tokens and its clip path dropped, because an id inlined twice
// on one page is not an id and the header and the Library's empty state can
// both be showing. Dropping it is not quite free: the strokes are 84 units
// wide, so the ends of the two horizontals overlap the rounded corners, and
// the clip shaved about a unit off them. Measured against the master at
// 1024px, that is 44 pixels of a million, all in the first two and last
// columns - at 24px it is a fortieth of a pixel, and with the ground
// dissolved there is no tile edge for it to show against.
//
// The gaps where the lines cross are the ground, so the mark is only right
// on the surface it names: set --mark-ground where that is not --surface.
// It carries no comment of its own because the file is inlined verbatim
// into the document.
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
