import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from 'react'

// FigUI3's button, the app's way: a variant name from the design system,
// the platform's submit behaviour inside a form, and every accessible
// attribute passed through. The kit renders a real <button> inside its
// shadow root with delegated focus, so the role, the name and the focus
// ring are the platform's.
//
// Things React cannot do for a kit element that declares `type` and
// `disabled` as fields: React 19 sets such props as properties, and the
// kit reads the *attributes* when it connects and when they change. So
// both are written through the ref after connection: `type` as the kit's
// property (what its click handler reads), `disabled` as the attribute it
// observes. The kit forwards aria-label, -labelledby and -describedby to
// its inner button and nothing else, so the two state attributes are
// written onto that button by hand (the shadow root is open). A submit
// button also renders a hidden native submit control so Enter in a field
// still submits the form, as the platform promises; it is disabled with
// the visible one, so Enter cannot submit twice while a request is out.
// Contract: specs/005-design-system-foundations/contracts/kit.md.

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  type?: 'button' | 'submit'
  size?: 'compact' | 'large'
  disabled?: boolean
  /** Icon-only styling; give an aria-label. */
  icon?: boolean
  onClick?: (event: MouseEvent<HTMLElement>) => void
  children: ReactNode
  className?: string
  id?: string
  'aria-label'?: string
  'aria-expanded'?: boolean
  'aria-describedby'?: string
  'aria-controls'?: string
}

type KitButton = HTMLElement & { type?: string }

const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    type = 'button',
    disabled = false,
    icon,
    children,
    'aria-expanded': expanded,
    'aria-controls': controls,
    ...rest
  },
  ref,
): JSX.Element {
  const host = useRef<KitButton>(null)
  useImperativeHandle(ref, () => host.current as HTMLElement)

  useEffect(() => {
    const element = host.current
    if (element) element.type = type
  }, [type])

  useEffect(() => {
    const element = host.current
    if (!element) return
    if (disabled) element.setAttribute('disabled', '')
    else element.removeAttribute('disabled')
  }, [disabled])

  useEffect(() => {
    const inner = host.current?.shadowRoot?.querySelector('button')
    if (!inner) return
    const set = (name: string, value: string | undefined): void => {
      if (value === undefined) inner.removeAttribute(name)
      else inner.setAttribute(name, value)
    }
    set('aria-expanded', expanded === undefined ? undefined : String(expanded))
    set('aria-controls', controls)
  }, [expanded, controls])

  return (
    <>
      {type === 'submit' && <button type="submit" hidden disabled={disabled} />}
      <fig-button ref={host} variant={variant} icon={icon || undefined} {...rest}>
        {children}
      </fig-button>
    </>
  )
})

export default Button
