import type { Theme } from '../../shared/project/types'
import type { ViewerMethod } from '../../shared/viewer'
import { asDispatchedTheme } from './themeMemory'
import { asDispatched, asSought, type Remembered } from './transportState'
import type { ViewerCall } from './viewerRestore'

// The loop that sends a restore (`restoreCalls`) to a page that has just
// loaded, with no React, window or bridge in it so the part that matters is
// tested without them: **what each call carries is decided when it is sent,
// not when the list was composed.**
//
// The list is composed once and sent over up to seven awaited round trips,
// and the interface is live throughout: a Pause, a new speed or a theme
// pressed during it writes its memory and sends its own call, and a list
// whose arguments were fixed before the press would then overwrite it from
// behind. Each call is therefore handed the memory as it stands at its own
// moment - the speed and the pause from cell 03's (`asDispatched`), a seek
// a person made since the page being left was read (`asSought`, issue 660),
// the theme from the project's (`asDispatchedTheme`) - and the loop stops the
// moment the navigation it belongs to has been replaced or the screen has
// gone, because the page it was for is no longer the page on screen.

/** Everything the loop reads at the moment of each call, and the one thing it does. */
export interface GiveBack {
  /** False once the navigation this restore belongs to has been replaced or the screen has gone. */
  alive: () => boolean
  /** What the app has told this project's page about its speed and pause, now. */
  remembered: () => Remembered
  /** Where a person moved the clock since the page being left was read, now, or null (`soughtSince`). */
  sought: () => number | null
  /** The project's theme, now. */
  theme: () => Theme
  /** One call to the page, in the shape `window.api.viewer.call` takes. */
  send: (method: ViewerMethod, args: unknown[]) => Promise<unknown>
}

/**
 * Send a restore's calls in order. A call the page refuses is not an error
 * and does not stop the rest: the page may lack a method, or be between
 * documents, and what follows is still owed to it.
 */
export async function giveBack(calls: ViewerCall[], now: GiveBack): Promise<void> {
  for (const { method, args } of calls) {
    if (!now.alive()) return
    const sending = asDispatchedTheme(
      method,
      asSought(method, asDispatched(method, args, now.remembered()), now.sought()),
      now.theme(),
    )
    try {
      await now.send(method, sending)
    } catch {
      // Refused, or the bridge threw before it could ask: the next call is still owed.
    }
  }
}
