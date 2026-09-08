import { forwardRef, useEffect, useRef, type JSX, type ReactNode } from 'react'

// The select is the platform's own <select>, which FigUI3's fig-dropdown
// wraps and styles (ADR-026: never the kit's custom listbox, which lives in
// its PolyForm-licensed half). Options are ordinary <option> children.
// Contract: specs/005-design-system-foundations/contracts/kit.md.

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  /** The accessible name the kit gives the native select. */
  label: string
  disabled?: boolean
  children: ReactNode
  className?: string
}

const Select = forwardRef<HTMLElement, SelectProps>(function Select(
  { value, onChange, label, disabled, children, className },
  ref,
): JSX.Element {
  const host = useRef<HTMLElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (typeof detail === 'string') onChange(detail)
    }
    element.addEventListener('change', handler)
    return () => element.removeEventListener('change', handler)
  }, [onChange])

  useEffect(() => {
    const element = host.current
    if (element && element.getAttribute('value') !== value) element.setAttribute('value', value)
  }, [value])

  return (
    <fig-dropdown
      ref={(element: HTMLElement | null) => {
        host.current = element
        if (typeof ref === 'function') ref(element)
        else if (ref) ref.current = element
      }}
      label={label}
      disabled={disabled || undefined}
      className={className}
    >
      {children}
    </fig-dropdown>
  )
})

export default Select
