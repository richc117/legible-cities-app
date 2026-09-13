// One log file that never grows past its cap: `<name>.log`, and the file it
// was before its last rotation, `<name>.old.log`. Nothing else is ever
// removed, and nothing here opens a connection of any kind (A6-03,
// specs/023-logs-and-diagnostics).
//
// No Electron import: the folder is handed in, so a test can point it
// anywhere. Every line is written in order by one writer that takes
// whatever has queued up since its last write as one chunk, so a burst of
// engine output costs a handful of writes rather than one per line, and the
// caller - the supervisor reading the engine's stderr - never waits for a
// disk. Lines logged before the file is open, or while it is being rotated,
// wait in the same queue.
//
// A log that cannot be written is not a reason to stop the app, or to
// throw into whoever logged: from the first failure the lines go to
// standard error, and standard error is told once why.

import { open, rename, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

/** The cap on one log file, in bytes: 5 MB. */
export const LOG_CAP = 5 * 1024 * 1024

export interface LogFileOptions {
  /** The cap in bytes; a write that would take the file past it rotates first. */
  cap?: number
  /**
   * The caller already mirrors every line to standard error (development
   * does), so a line the file could not take is not said there twice.
   */
  mirrored?: boolean
  /**
   * Where a line goes once the file has failed, or has been closed, unless
   * it is `mirrored`; the one sentence saying why always goes.
   */
  fallback?: (line: string) => void
  /** The clock the timestamps are read from. */
  now?: () => Date
}

export interface LogFile {
  /** `<folder>/<name>.log`. */
  readonly path: string
  /** `<folder>/<name>.old.log`. */
  readonly oldPath: string
  /** Queue one line. Never throws, never waits. */
  write(line: string): void
  /** Resolves once every line queued so far has reached the file (or the fallback). */
  flush(): Promise<void>
  /** Write what is queued and close the file; later lines go to the fallback. */
  close(): Promise<void>
}

const toStderr = (line: string): void => {
  try {
    process.stderr.write(line + '\n')
  } catch {
    // Nowhere left to say it.
  }
}

const reason = (error: unknown): string => {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    return code ?? error.message
  }
  return String(error)
}

/**
 * Open `<folder>/<name>.log` for appending. The folder must exist; the
 * caller makes it. Nothing is opened until the first line, so a log that is
 * never written leaves no file.
 */
export function openLogFile(folder: string, name: string, options: LogFileOptions = {}): LogFile {
  const cap = options.cap ?? LOG_CAP
  const fallback = options.fallback ?? toStderr
  const now = options.now ?? (() => new Date())
  const path = join(folder, `${name}.log`)
  const oldPath = join(folder, `${name}.old.log`)

  let queue: string[] = []
  let handle: FileHandle | null = null
  let bytes = 0
  let failed = false
  let closed = false
  /** The writer in progress, if any; every flush waits for it. */
  let writing: Promise<void> | null = null

  const fail = (error: unknown, pending: string[]): void => {
    if (!failed) {
      failed = true
      fallback(
        `[log] warning: ${name}.log could not be written (${reason(error)}); logging to standard error`,
      )
    }
    // A line already mirrored to standard error is not said there twice.
    if (options.mirrored !== true) for (const line of pending) fallback(line)
    const h = handle
    handle = null
    if (h !== null) h.close().catch(() => undefined)
  }

  const ensureOpen = async (): Promise<FileHandle> => {
    if (handle !== null) return handle
    const opened = await open(path, 'a')
    try {
      bytes = (await opened.stat()).size
    } catch (error) {
      await opened.close().catch(() => undefined)
      throw error
    }
    handle = opened
    return opened
  }

  /** `<name>.log` becomes `<name>.old.log`, replacing it, and the next write starts afresh. */
  const rotate = async (): Promise<void> => {
    const h = handle
    handle = null
    if (h !== null) await h.close()
    try {
      await rename(path, oldPath)
    } catch (error) {
      // Someone moved the file away while it was open: there is nothing to
      // rotate, and the next write makes a new one.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    bytes = 0
  }

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const lines = queue
      queue = []
      let index = 0
      try {
        await ensureOpen()
        while (index < lines.length) {
          // As many lines as fit under the cap, in one write. A file with
          // nothing in it takes at least one line whatever its size, or a
          // line longer than the cap would rotate forever.
          const chunk: string[] = []
          let size = 0
          while (index + chunk.length < lines.length) {
            const text = lines[index + chunk.length] + '\n'
            const length = Buffer.byteLength(text, 'utf8')
            if (bytes + size + length > cap && bytes + size > 0) break
            chunk.push(text)
            size += length
          }
          if (chunk.length === 0) {
            await rotate()
            await ensureOpen()
            continue
          }
          await (handle as FileHandle).write(chunk.join(''))
          bytes += size
          index += chunk.length
        }
      } catch (error) {
        fail(error, [...lines.slice(index), ...queue])
        queue = []
        return
      }
    }
  }

  const kick = (): Promise<void> => {
    writing ??= drain().finally(() => {
      writing = null
      // A line queued after the last loop looked, and before `writing` was
      // cleared, would otherwise wait for the next write.
      if (queue.length > 0 && !failed && !closed) void kick()
    })
    return writing
  }

  const write = (line: string): void => {
    const stamped = `${now().toISOString()} ${line}`
    if (failed || closed) {
      if (options.mirrored !== true) fallback(stamped)
      return
    }
    queue.push(stamped)
    void kick()
  }

  const flush = async (): Promise<void> => {
    while (writing !== null) await writing
  }

  const close = async (): Promise<void> => {
    if (closed) return
    await flush()
    closed = true
    const h = handle
    handle = null
    if (h !== null) await h.close().catch(() => undefined)
  }

  return { path, oldPath, write, flush, close }
}
