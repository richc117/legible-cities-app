// The kit's button as a native one, for a jsdom test that hands focus
// (ADR-059). jsdom does not delegate focus into a shadow root, so
// `focus()` on a `<fig-button>` never reaches its inner button and a
// hand-back onto one cannot be seen there. A test that only presses leaves
// the kit real: jsdom carries a click through the shadow root as a browser
// does. A test about what the kit itself does with focus is a browser test
// (`*.browser.test.tsx`), with the kit real.
//
// `vi.mock` is hoisted to the top of the file that calls it, so it cannot
// sit here; a test passes this factory to it:
//
//   vi.mock('../../src/renderer/src/kit/Button', kitButtonStub)

import { createElement, forwardRef } from 'react'

export const kitButtonStub = (): { default: unknown } => ({
  default: forwardRef<HTMLButtonElement, Record<string, unknown>>(function Button(props, ref) {
    // The kit's own looks are not a native button's attributes.
    const rest = { ...props }
    for (const look of ['variant', 'icon', 'size', 'children']) delete rest[look]
    return createElement('button', { ref, type: 'button', ...rest }, props.children as never)
  }),
})
