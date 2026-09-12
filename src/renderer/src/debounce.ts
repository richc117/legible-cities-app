// A debounce, as a plain function so a test can hold it with fake timers.
// A person dragging a colour picker moves through dozens of colours a
// second, and each one would be a map build; the panel above this waits
// until they stop and then builds once (specs/018-colours).

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Forget a call that is waiting. The panel does this when it goes. */
  cancel(): void
  /** Is a call waiting? */
  readonly pending: boolean
}

/**
 * `fn` runs once, `delay` after the last call, with the last call's
 * arguments. A call while one is waiting replaces it; `cancel` drops it.
 * `delay` is in milliseconds, as `setTimeout` takes it.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest: A | null = null
  const debounced = (...args: A): void => {
    latest = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const called = latest as A
      latest = null
      fn(...called)
    }, delay)
  }
  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    latest = null
  }
  Object.defineProperty(debounced, 'pending', { get: () => timer !== null })
  return debounced as Debounced<A>
}
