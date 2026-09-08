import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react'

// FigUI3's text input, the app's way. The kit renders a real <input>
// inside the host and reports typing through custom `input` and `change`
// events whose detail is the value; React never sets the value in JSX (the
// kit's own guidance: attributeChangedCallback would loop), so this
// wrapper owns a ref, writes the attribute only when it differs, and
// listens through the ref. `disabled` and `placeholder` are fields the kit
// declares, which React 19 would set as properties on a re-render while
// the kit observes attributes, so they go through the ref too. The aria
// attributes are set on the host, which the kit observes and mirrors onto
// the inner input, removing any the host lacks; the id goes on the inner
// input by hand so a <label for> addresses the control itself.
// Contract: specs/005-design-system-foundations/contracts/kit.md.

export interface TextInputHandle {
  focus(): void
}

export interface TextInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  size?: 'large'
  spellCheck?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

const TextInput = forwardRef<TextInputHandle, TextInputProps>(function TextInput(
  { id, value, onChange, placeholder, disabled = false, size, spellCheck, ...aria },
  ref,
): JSX.Element {
  const host = useRef<HTMLElement>(null)
  const inner = (): HTMLInputElement | null =>
    host.current?.querySelector<HTMLInputElement>('input, textarea') ?? null

  useImperativeHandle(ref, () => ({
    focus: () => (inner() ?? host.current)?.focus(),
  }))

  useEffect(() => {
    const element = host.current
    if (!element) return
    // The kit re-dispatches typing as a custom `input` with the value in
    // detail; a value set from outside (a test's fill, a paste handled by
    // the platform) arrives as the inner input's own event. Either way the
    // inner input holds the truth, so read it there.
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      const current = typeof detail === 'string' ? detail : inner()?.value
      if (typeof current === 'string') onChange(current)
    }
    element.addEventListener('input', handler)
    return () => element.removeEventListener('input', handler)
  }, [onChange])

  useEffect(() => {
    const element = host.current
    if (element && element.getAttribute('value') !== value) element.setAttribute('value', value)
  }, [value])

  useEffect(() => {
    const element = host.current
    if (!element) return
    if (disabled) element.setAttribute('disabled', '')
    else element.removeAttribute('disabled')
  }, [disabled])

  useEffect(() => {
    const element = host.current
    if (!element) return
    if (placeholder) element.setAttribute('placeholder', placeholder)
    else element.removeAttribute('placeholder')
  }, [placeholder])

  useEffect(() => {
    const input = inner()
    if (!input) return
    input.id = id
    if (spellCheck === false) {
      input.spellcheck = false
      input.setAttribute('autocapitalize', 'off')
      input.setAttribute('autocorrect', 'off')
    }
  }, [id, spellCheck])

  return (
    <fig-input-text
      ref={host}
      size={size}
      aria-describedby={aria['aria-describedby']}
      aria-invalid={aria['aria-invalid'] === true ? 'true' : undefined}
      aria-required={aria['aria-required'] === true ? 'true' : undefined}
    />
  )
})

export default TextInput
