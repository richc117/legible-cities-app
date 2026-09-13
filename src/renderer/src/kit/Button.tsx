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
// its inner button and nothing else, so the state attributes are written
// onto that button by hand (the shadow root is open). A submit
// button also renders a hidden native submit control so Enter in a field
// still submits the form, as the platform promises; it is disabled with
// the visible one, so Enter cannot submit twice while a request is out.
// Contract: specs/005-design-system-foundations/contracts/kit.md.
//
// aria-describedby is not given to the kit at all. The kit would copy the
// id onto its inner button, where an id resolves inside the shadow tree
// and the page's element is not, so the button had no description
// (docs/accessibility.md, F5). The wrapper reads the described elements'
// text instead and writes it onto the inner button as aria-description,
// kept current by an observer, which Chromium and Playwright both take as
// the button's description. `ariaDescribedByElements` would carry the
// reference itself, and Chromium honours it across the boundary, but
// Playwright's description ignores it, so no test could hold it; and a
// dangling inner aria-describedby beside aria-description is read first by
// Playwright and describes nothing (measured on 2026-09-13, issue 113).

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
  /** A toggle's state, mirrored onto the kit's inner button by hand as aria-expanded is. */
  'aria-pressed'?: boolean
  /**
   * Unavailable but still focusable, mirrored by hand too: for a button that
   * must not take its press again yet and must not drop the focus it holds,
   * which `disabled` would (Chromium blurs a disabled element). The press is
   * the caller's to refuse.
   */
  'aria-disabled'?: boolean
  'aria-describedby'?: string
  'aria-controls'?: string
}

type KitButton = HTMLElement & { type?: string }

/** Where the described elements are looked up: the button's document or shadow root. */
export interface DescriptionRoot {
  getElementById(id: string): { textContent: string | null } | null
}

/** The inner button, as far as its description goes. */
export interface DescriptionTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/**
 * Starts calling `callback` whenever the root's elements or their text
 * change, and returns the function that stops; a test passes its own.
 */
export type WatchRoot = (root: DescriptionRoot, callback: () => void) => () => void

const watchWithObserver: WatchRoot = (root, callback) => {
  const observer = new MutationObserver(callback)
  observer.observe(root as unknown as Node, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id'],
  })
  return () => observer.disconnect()
}

/**
 * The text an aria-describedby list names: each element's text with its
 * whitespace collapsed, in the list's order, joined by a space; an id
 * with no element, or an element with no text, adds nothing.
 */
export function describedText(root: DescriptionRoot, describedBy: string): string {
  return describedBy
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => (root.getElementById(id)?.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '')
    .join(' ')
}

/**
 * Keeps `target`'s aria-description equal to the text `describedBy` names,
 * and returns the function that stops. The whole root is watched rather
 * than the described elements, because an element can arrive after the
 * button or be replaced by another with the same id, and an observer on
 * the old one would never hear of it. Writing the attribute on a button
 * inside a shadow root is not a change the root's observer sees, so the
 * write cannot feed itself. Stopping disconnects the observer and removes
 * the description, so a removed prop leaves none behind.
 */
export function mirrorDescription(
  target: DescriptionTarget,
  root: DescriptionRoot,
  describedBy: string | undefined,
  watch: WatchRoot = watchWithObserver,
): () => void {
  const sync = (): void => {
    const text = describedBy === undefined ? '' : describedText(root, describedBy)
    if (text === '') {
      if (target.getAttribute('aria-description') !== null)
        target.removeAttribute('aria-description')
    } else if (target.getAttribute('aria-description') !== text) {
      target.setAttribute('aria-description', text)
    }
  }
  sync()
  if (describedBy === undefined) return () => undefined
  const stop = watch(root, sync)
  return () => {
    stop()
    target.removeAttribute('aria-description')
  }
}

const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    type = 'button',
    disabled = false,
    icon,
    children,
    'aria-expanded': expanded,
    'aria-pressed': pressed,
    'aria-disabled': unavailable,
    'aria-controls': controls,
    'aria-describedby': describedBy,
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
    set('aria-pressed', pressed === undefined ? undefined : String(pressed))
    set('aria-disabled', unavailable === true ? 'true' : undefined)
    // And on the host, where the app's stylesheet can draw it unavailable.
    if (unavailable === true) host.current?.setAttribute('data-unavailable', '')
    else host.current?.removeAttribute('data-unavailable')
    set('aria-controls', controls)
  }, [expanded, pressed, unavailable, controls])

  useEffect(() => {
    const element = host.current
    const inner = element?.shadowRoot?.querySelector('button')
    if (!element || !inner) return
    return mirrorDescription(inner, element.getRootNode() as Document | ShadowRoot, describedBy)
  }, [describedBy])

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
