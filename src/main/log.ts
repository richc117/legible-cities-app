// One logger for the main process. Lines go to stderr as "[tag] message"
// until the app has somewhere better to put them; A6-03 sends them to two
// files by replacing the sink, without touching a call site
// (specs/023-logs-and-diagnostics). No Electron import, so pure modules and
// tests can use it.

/** A line as it was logged, and the tag it was logged under. */
export type Sink = (line: string, tag: string) => void

/** The tag the engine's own lines, and the supervisor's about it, are logged under. */
export const ENGINE_TAG = 'engine'

export const toStderr: Sink = (line) => {
  try {
    process.stderr.write(line + '\n')
  } catch {
    // Nowhere left to say it.
  }
}

let sink: Sink = toStderr

export function setSink(next: Sink): void {
  sink = next
}

/** Hand a line to the sink; a sink that throws costs that line, never the caller (FR-008). */
function emit(tag: string, line: string): void {
  try {
    sink(line, tag)
  } catch {
    // The line is lost; the request that logged it is not.
  }
}

export const log = {
  info(tag: string, message: string): void {
    emit(tag, `[${tag}] ${message}`)
  },
  warn(tag: string, message: string): void {
    emit(tag, `[${tag}] warning: ${message}`)
  },
  error(tag: string, message: string): void {
    emit(tag, `[${tag}] error: ${message}`)
  },
}

/** Lines under the engine's tag to one sink, every other line to the other. */
export function byTag(main: Sink, engine: Sink): Sink {
  return (line, tag) => (tag === ENGINE_TAG ? engine : main)(line, tag)
}

/**
 * A sink that holds lines until there is somewhere to put them. The log
 * files open once the app knows its paths, and the first lines of a launch
 * that goes wrong before then are the ones most worth having. Bounded, and
 * it keeps the newest: a launch that never gets that far must not grow
 * without limit.
 */
export function holdingSink(limit: number): { sink: Sink; release(into: Sink): void } {
  const held: [string, string][] = []
  let dropped = 0
  return {
    sink: (line, tag) => {
      held.push([line, tag])
      if (held.length > limit) {
        held.shift()
        dropped += 1
      }
    },
    release: (into) => {
      if (dropped > 0) into(`[log] warning: ${dropped} early line(s) were not kept`, 'log')
      for (const [line, tag] of held.splice(0)) into(line, tag)
      dropped = 0
    },
  }
}
