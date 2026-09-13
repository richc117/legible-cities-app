// One log file that stays near its cap: `<name>.log`, and the file it was
// before its last rotation, `<name>.old.log`. Nothing else is ever removed,
// and nothing here opens a connection of any kind (A6-03,
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
// A log that cannot be opened or written is not a reason to stop the app,
// or to throw into whoever logged: from the first such failure the lines go
// to standard error, and standard error is told once why. A rotation that
// cannot rename the file - Windows refuses while another program has it
// open - is not that failure: the file is reopened and appended to, and the
// rename is tried again at the next crossing of the cap.

import { constants } from 'node:fs'
import { open, rename as renameFile, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { redactUrls } from './redact'

/** The cap on one log file, in bytes: 5 MB. */
export const LOG_CAP = 5 * 1024 * 1024

/**
 * The longest anything waits for a log: a quit closing the files, a copy
 * flushing them first. A disk that does not answer costs lines, never the
 * quit or the button.
 */
export const LOG_WAIT_MS = 2_000

/**
 * Append, create, and on POSIX never through a symbolic link where the file
 * should be: a link planted in the log folder would otherwise have the app
 * append to whatever it names. Windows has no such flag and gets zero.
 */
const OPEN_FLAGS =
  constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)

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
   * it is `mirrored`; the sentences saying why always go.
   */
  fallback?: (line: string) => void
  /** The clock the timestamps are read from, for a line that brings none. */
  now?: () => Date
  /** The rename a rotation makes; injected so a refusal can be tested. */
  rename?: (from: string, to: string) => Promise<void>
}

export interface LogFile {
  /** `<folder>/<name>.log`. */
  readonly path: string
  /** `<folder>/<name>.old.log`. */
  readonly oldPath: string
  /** Queue one line, its URLs redacted, stamped `at` or now. Never throws, never waits. */
  write(line: string, at?: Date): void
  /**
   * Resolves once every line queued before the call has reached the file
   * (or the fallback). Lines queued afterwards are not waited for, so a
   * steady stream of them cannot hold it open.
   */
  flush(): Promise<void>
  /** Take no more lines, write what is queued, and close the file; later lines go to the fallback. */
  close(): Promise<void>
}

const noop = (): void => undefined

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
 * Wait for `work` or for `ms`, whichever comes first; never rejects. For
 * the waits on a log, which must not hold up a quit or a button.
 */
export async function within(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([work.then(noop, noop), timeout])
  } finally {
    clearTimeout(timer)
  }
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
  const rename = options.rename ?? renameFile
  const path = join(folder, `${name}.log`)
  const oldPath = join(folder, `${name}.old.log`)

  let queue: string[] = []
  let handle: FileHandle | null = null
  /** Bytes counted against the cap: the file's size, or what was written since a refused rename. */
  let bytes = 0
  let failed = false
  let closed = false
  let renameWarned = false
  /** The writer in progress, if any. */
  let writing: Promise<void> | null = null
  /** Lines ever queued, and lines ever settled: written, or handed on after a failure. */
  let queued = 0
  let settled = 0
  let waiters: { upTo: number; resolve: () => void }[] = []

  const settle = (count: number): void => {
    settled += count
    const ready = waiters.filter((w) => w.upTo <= settled || failed)
    if (ready.length === 0) return
    waiters = waiters.filter((w) => !ready.includes(w))
    for (const w of ready) w.resolve()
  }

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
    if (h !== null) h.close().catch(noop)
    settle(pending.length)
  }

  const ensureOpen = async (): Promise<FileHandle> => {
    if (handle !== null) return handle
    const opened = await open(path, OPEN_FLAGS, 0o644)
    try {
      bytes = (await opened.stat()).size
    } catch (error) {
      await opened.close().catch(noop)
      throw error
    }
    handle = opened
    return opened
  }

  /**
   * `<name>.log` becomes `<name>.old.log`, replacing it, and the next write
   * starts afresh. A refused rename leaves the file where it is: it is
   * reopened and appended to, and counted from zero, so the rename is tried
   * again once another cap's worth has been written rather than before
   * every line. Only a failure to open or write stops the file.
   */
  const rotate = async (): Promise<void> => {
    const h = handle
    handle = null
    if (h !== null) await h.close()
    try {
      await rename(path, oldPath)
    } catch (error) {
      // Someone moved the file away while it was open: there is nothing to
      // rotate, and the next write makes a new one.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (!renameWarned) {
          renameWarned = true
          fallback(
            `[log] warning: ${name}.log could not be rotated (${reason(error)}); it is appended to until it can be`,
          )
        }
        await ensureOpen()
      }
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
          // nothing counted takes at least one line whatever its size, or a
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
          settle(chunk.length)
        }
      } catch (error) {
        const pending = [...lines.slice(index), ...queue]
        queue = []
        fail(error, pending)
        return
      }
    }
  }

  const kick = (): void => {
    writing ??= drain().finally(() => {
      writing = null
      // A line queued after the last loop looked, and before `writing` was
      // cleared, would otherwise wait for the next write.
      if (queue.length > 0 && !failed) kick()
    })
  }

  const write = (line: string, at?: Date): void => {
    // Every line, whoever wrote it: a feed's URL can carry a key, and a log
    // file outlives the moment a person would have noticed (src/main/redact.ts).
    const stamped = `${(at ?? now()).toISOString()} ${redactUrls(line)}`
    if (failed || closed) {
      if (options.mirrored !== true) fallback(stamped)
      return
    }
    queue.push(stamped)
    queued += 1
    kick()
  }

  const flush = (): Promise<void> => {
    const upTo = queued
    if (settled >= upTo || failed) return Promise.resolve()
    return new Promise((resolve) => waiters.push({ upTo, resolve }))
  }

  const close = async (): Promise<void> => {
    if (closed) return
    // Closed first, so nothing joins the queue while it is written out.
    closed = true
    await flush()
    const h = handle
    handle = null
    if (h !== null) await h.close().catch(noop)
  }

  return { path, oldPath, write, flush, close }
}
