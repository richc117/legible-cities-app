// The FigUI3 elements the interface uses, declared for JSX. The kit ships
// no types; these are the attributes contracts/kit.md relies on. Values
// are set through refs by the wrappers, never as JSX attributes on
// re-render (the kit's own guidance).

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type Fig<Extra> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Extra

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'fig-button': Fig<{
        variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructiveSecondary'
        type?: 'button' | 'submit' | 'toggle'
        size?: 'large' | 'compact'
        disabled?: boolean
        icon?: boolean
        selected?: boolean
        full?: boolean
      }>
      'fig-input-text': Fig<{
        placeholder?: string
        type?: 'text' | 'number'
        size?: 'large'
        disabled?: boolean
        multiline?: boolean
        name?: string
      }>
      'fig-dropdown': Fig<{
        label?: string
        variant?: 'ghost'
        disabled?: boolean
      }>
      'fig-header': Fig<Record<string, never>>
      'fig-tooltip': Fig<{ text?: string; delay?: number }>
      'fig-spinner': Fig<Record<string, never>>
      'fig-separator': Fig<Record<string, never>>
    }
  }
}
