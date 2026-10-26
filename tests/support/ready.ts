// How long a test may wait for the engine's status to say "ready" after a
// launch, computed from the supervisor's own bounds and not written out
// (issue 529).
//
// A first start that misses the handshake is not a failed start: the
// supervisor ends that engine, waits the first restart delay and starts
// another, which then has the whole handshake again. A wait that is shorter
// than that is a wait that cannot see a restart through, and it fails with
// the engine "starting (attempt 2)" on screen. So the deadline is the
// handshake, the back-off, a second handshake, and a margin for the window
// to open and the page to render the status. A change to `handshakeMs` or
// to the restart delays moves this with it.

import { DEFAULT_BOUNDS } from '../../src/main/sidecar'

/** What a launch's window needs before the status can say anything, beyond the engine's own time. */
export const WINDOW_MARGIN_MS = 10_000

export const READY_DEADLINE_MS =
  DEFAULT_BOUNDS.handshakeMs +
  DEFAULT_BOUNDS.restartDelaysMs[0] +
  DEFAULT_BOUNDS.handshakeMs +
  WINDOW_MARGIN_MS
