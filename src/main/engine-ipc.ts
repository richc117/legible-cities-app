// The engine bridge's main side: four handlers over the supervisor (the
// fourth, the Library's "Try again", issue 562) and four events to the
// window. The page addresses a request by a token it
// minted; this layer maps it to the id the engine saw and back, so a
// notification reaches the page with the page's own id. A request's answer
// travels as an event too, on the same channel as its progress and log
// lines and after them, because an invoke reply is not ordered against
// events and the page must never see a result before the last progress.
// Contract: specs/004-sidecar-supervisor/contracts/bridge.md.
//
// **The two notifications are redacted on the way out** (A5.5-13). The
// engine prints a feed's URL as it was given - key in the query and all -
// when a download goes wrong, and every other way that text is kept has
// been redacted since A6-03: `log.ts` and `log-file.ts` redact it into
// `engine.log`, and `jobs-ipc.ts` redacts it again into the clipboard. What
// crossed to the page was raw. So `job/log`'s line and `job/progress`'s
// message are redacted here, and from here the screen, the runs' own
// `LogBuffer`s and every copy made from them carry the same bytes, with no
// second implementation anywhere - certainly not in the renderer, which
// cannot import `redact.ts` at all.
//
// The log line was invisible while the jobs inspector merely held lines for
// a copy, and stopped being invisible when cell 02 began drawing them. The
// progress message never was: it is the sentence beside the progress line
// on every run and on the Library's feed add, so a key in a feed's URL was
// on the screen, in a screenshot and in a screen share. `readableMessage`
// in `layoutRun.ts` replaces a message that looks like a path, which is a
// different hazard and catches none of this.
//
// **The other way a secret reached the page was the error**, and issue
// 207 closed it in `ipc-shape.ts`: a settled request carries the engine's
// error through `toShape`, and until engine v0.10.1 a failed download's
// error named the whole URL in its message, hint and detail
// (`serve.classify`).
// `jsonrpc.ts`'s `withoutPaths` on the hint could never have caught it -
// its pattern needs whitespace or `(` before the slash, and a URL's `//`
// follows a colon. `toShape` and `badCall` now put all three fields through
// the same `redactUrls`, so the progress message, the log line and the
// error are the three doors, each redacted in the main process. The engine
// state the page also reads is the fourth: a reason can quote the engine's
// last stderr lines, so `Sidecar.setState` redacts it.
//
// It costs the ordinary sentence nothing: `redactUrls` returns any text
// without a `?`, `#`, `@` or `%` in it untouched, so "topo: 3 nodes, 2
// edges", "matched 114/114 stops" and "downloaded 4,096 of 65,536 bytes"
// are byte-identical, and a path - which has none of those four either - is
// left for `readableMessage` and `withoutPaths` to deal with as before.
// Only text that already carries a secret changes. `redactUrls` is stable
// under a second pass, so the clipboard's own redaction still changes
// nothing.
//
// The error door takes paths out as well, since issue 419: `toShape` and
// `badCall` are handed the folders the main process knows (`roots`, from
// `index.ts`), and every path under one of them leaves all three fields as
// "a file". The progress message and the log line are not given that
// treatment; they keep the two guards described above.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type EngineAccepted, type EngineSettled } from '../shared/api'
import { REQUEST_FOR_NO_PROJECT, REQUEST_UNCHECKED } from '../shared/activity'
import { ERROR_CODES, type EngineState, type JobLog, type JobProgress } from '../shared/engine'
import { isLayoutId } from '../shared/layout'
import type { Method } from '../shared/protocol'
import { inTime, LAPSED } from './deadline'
import { badCall, guardedHandle, TOKEN, toShape, type PathRoots } from './ipc-shape'
import { ProjectActivity, projectNamedBy } from './projectActivity'
import { redactUrls } from './redact'
import { isObject, messageOf } from '../shared/errors'
import { FOLDERS_TIMEOUT_MS } from './settings'
import type { Notification } from './sidecar'

/** What the handlers need from the supervisor; a test hands in a fake. */
export interface EngineSource {
  readonly state: EngineState
  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: number; result: Promise<unknown> }
  cancel(id: number): void
  onState(listener: (state: EngineState) => void): () => void
  onNotification(listener: (n: Notification) => void): () => void
  /** Start a down engine again (`Sidecar.retry`): null when it started, else why not. */
  retry(): string | null
}

export type Send = (channel: string, payload: unknown) => void

/** A refusal before the engine sees a request: null lets it through, a sentence stops it. */
export type Guard = (
  method: string,
  params: Record<string, unknown> | undefined,
) => Promise<string | null>

/**
 * What the bridge asks the project store before a request may write a
 * project's folder (issue 505): `ProjectStore.recordGone`, or a test's fake.
 */
export interface RecordLookup {
  recordGone(id: string): Promise<boolean>
}

/** A request the supervisor would not send; why is in the log. */
export const NOT_SENT = 'The request could not be sent to the engine.'

const LEVELS = new Set(['debug', 'info', 'warning', 'error'])

/**
 * The engine methods the interface calls (issue 429). A page's request naming
 * any other is answered with the bridge's bad-call shape before the guard is
 * asked: `export.plan` and `export.encode` are the main process's own (the
 * export takes the plan, drives the capture and encodes into a folder it
 * judged), and `engine.shutdown` belongs to the supervisor. Adding a method
 * here is a decision, which is the point.
 */
export const PAGE_METHODS = [
  'engine.info',
  'graph.build',
  'map.build',
  'style.presets',
  'export.presets',
  'export.storyboards',
  'feeds.service',
  'feeds.list',
  'feeds.add',
  'feeds.remove',
  'feeds.inspect',
  'render.stage',
] as const satisfies readonly Method[]

const PAGE_METHOD_SET: ReadonlySet<string> = new Set(PAGE_METHODS)

export function registerEngineHandlers(
  ipcMain: IpcMain,
  engine: EngineSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
  send: Send,
  log: (message: string) => void,
  guard: Guard = async () => null,
  /**
   * The folders a path in an error can start with, for the door (issue 419).
   * Required: a bridge that named none would be a quieter door.
   */
  roots: PathRoots,
  /**
   * Which projects have a request in flight that writes their folder, for
   * the exporter and the store to consult (issue 491). Required, so a wiring
   * that dropped it would be a type error and not a rule held by nothing.
   */
  activity: ProjectActivity,
  /**
   * Whether a project still has a record, for a request that writes its
   * folder (issue 505). Required, as `activity` is.
   */
  records: RecordLookup,
  /**
   * Why nothing may write under the engine's home right now, or null: the
   * reset's own check (`resetInProgress` in `index.ts`), asked before a
   * person's retry starts the engine (issue 562), since an engine started
   * while the home's folders are being removed would write into them.
   * Required, as `activity` is.
   */
  resetting: () => string | null,
  /** How long that lookup may take; a test shortens it. */
  lookupMs: number = FOLDERS_TIMEOUT_MS,
): () => void {
  const idOf = new Map<string, number>()
  const tokenOf = new Map<number, string>()
  // Tokens a person cancelled while the guard was still thinking, when there
  // was no engine id to cancel yet. The cancel is held, not dropped: once the
  // guard has let the request through and the supervisor has numbered it, the
  // engine is sent the request and then the cancel, and answers as it would
  // to a cancel that came a moment later (issue 351).
  const cancelledEarly = new Set<string>()

  const handle = guardedHandle(ipcMain, isTopFrame)

  handle(CHANNELS.engineState, async () => engine.state)

  handle(CHANNELS.engineRequest, async (_event, token, method, params): Promise<EngineAccepted> => {
    if (typeof token !== 'string' || !TOKEN.test(token))
      return badCall('a request needs an id', roots)
    if (typeof method !== 'string' || method === '')
      return badCall('a request needs a method name', roots)
    if (!PAGE_METHOD_SET.has(method)) return badCall('the engine has no such method', roots)
    if (params !== undefined && !isObject(params))
      return badCall('parameters must be an object', roots)
    if (idOf.has(token)) return badCall('a request with this id is already running', roots)
    // The token is taken before the guard's await, so a second invoke with
    // the same token during it is refused rather than reaching the engine
    // twice with one map entry between them.
    idOf.set(token, 0)
    // The project this request writes into, marked from here to the end of
    // the request however it ends (issue 491): before the guard's await, so
    // a deletion confirmed while the guard thinks is already refused.
    const named = projectNamedBy(method, params as Record<string, unknown> | undefined)
    // Not into a folder whose deletion has begun, the removal walking it, nor
    // one whose export is running, capturing the page (issue 505).
    const stopped = named === null ? null : activity.requestRefusal(named)
    if (stopped !== null) {
      idOf.delete(token)
      return badCall(stopped, roots)
    }
    // Marked in the same turn as the check above and before any await, so an
    // export or a deletion that starts while the lookup or the guard thinks
    // meets the mark (`projectActivity.ts`, "Mark first, then ask").
    const release = named === null ? () => {} : activity.beginRequest(named)
    let refused: string | null
    try {
      // Not for a project that has no record (issue 505): a run whose
      // project was deleted under it would make `out/<id>` again. A lookup
      // the disk did not answer in time is a refusal; nothing has been sent.
      const gone = named === null ? false : await inTime(records.recordGone(named), lookupMs)
      const lookup = gone === LAPSED ? REQUEST_UNCHECKED : gone ? REQUEST_FOR_NO_PROJECT : null
      // The gate: what may be asked of the registry on a person's behalf is
      // decided here, with what the main process knows (the paths its own
      // chooser answered, the feeds its projects name), never on the page.
      // Asked after the lookup and whatever it answered, so the guard's own
      // last look at the reset comes after every await, and its sentence
      // wins: a reset that has removed `projects/` is said as the reset, not
      // as a deletion. Asking it for a gone project costs nothing: for a
      // map.build the registry's gate answers null and spends nothing.
      refused = (await guard(method, params as Record<string, unknown> | undefined)) ?? lookup
    } catch (error) {
      // A guard or a lookup that fails answers nothing, so neither the held
      // token nor a cancel made meanwhile may outlive the request; the
      // page's invoke rejects as it always did.
      idOf.delete(token)
      cancelledEarly.delete(token)
      release()
      throw error
    }
    if (refused !== null) {
      idOf.delete(token)
      cancelledEarly.delete(token)
      release()
      return badCall(refused, roots)
    }
    // No request has a deadline of its own: the supervisor's inactivity
    // bound is the only limit, a removal's included (issue 351). A person
    // stops a removal by cancelling it, which `engineCancel` below sends on.
    let sent: { id: number; result: Promise<unknown> }
    try {
      sent = engine.request(method, params as Record<string, unknown> | undefined)
    } catch (error) {
      // The supervisor may refuse what it was handed before sending anything:
      // the token is freed and the page is answered in the bridge's own
      // shape, not with a thrown message.
      idOf.delete(token)
      cancelledEarly.delete(token)
      release()
      // The thrown message goes to the log and not to the page: it is
      // whatever the supervisor threw, and a refusal is shown as it is.
      const what = messageOf(error)
      log(`refused ${method} before sending it: ${what}`)
      return badCall(NOT_SENT, roots)
    }
    const { id, result } = sent
    if (id !== 0) {
      idOf.set(token, id)
      tokenOf.set(id, token)
      // A cancel pressed while the guard was thinking reaches the request now.
      if (cancelledEarly.delete(token)) engine.cancel(id)
    } else {
      idOf.delete(token)
      cancelledEarly.delete(token)
    }
    // Settle on the event channel, after every notification for the id.
    result.then(
      (value) => {
        const settled: EngineSettled = { id: token, ok: true, result: value }
        send(CHANNELS.engineSettled, settled)
      },
      (error: unknown) => {
        // A bound gave up on this request: the engine may still be writing
        // into the project's folder, so the project stays held, before the
        // request's own mark is released below.
        if (named !== null && (error as { code?: unknown } | null)?.code === ERROR_CODES.inactive)
          activity.abandon(named)
        const settled: EngineSettled = { id: token, ok: false, error: toShape(error, roots) }
        send(CHANNELS.engineSettled, settled)
      },
    )
    void result
      .finally(() => {
        idOf.delete(token)
        tokenOf.delete(id)
        release()
      })
      .catch(() => {})
    return { accepted: true }
  })

  handle(CHANNELS.engineCancel, async (_event, token) => {
    if (typeof token !== 'string') return
    const id = idOf.get(token)
    if (id === undefined) return
    // 0 is the token held through the guard's await: no engine id yet.
    if (id === 0) cancelledEarly.add(token)
    else engine.cancel(id)
  })

  // The Library's "Try again" (issue 562): from the top frame only, as every
  // channel here, and nothing crosses inward. Null when the engine is
  // starting again, else the sentence the line under the buttons says.
  handle(CHANNELS.engineRetry, async (): Promise<string | null> => {
    const refused = resetting()
    if (refused !== null) return refused
    const why = engine.retry()
    if (why !== null) log(`refused a retry: ${why}`)
    return why
  })

  const offState = engine.onState((state) => send(CHANNELS.engineStateChanged, state))
  const offNotifications = engine.onNotification(({ method, params }) => {
    if (!isObject(params) || typeof params.id !== 'number') return
    const token = tokenOf.get(params.id)
    if (token === undefined) return
    if (
      method === 'job/progress' &&
      typeof params.stage === 'string' &&
      typeof params.fraction === 'number' &&
      typeof params.message === 'string'
    ) {
      // Redacted here too, and this is the one a person actually sees: the
      // sentence beside the progress line on every run. See the note at
      // the top of this file.
      const progress: JobProgress = {
        id: token,
        stage: params.stage,
        fraction: params.fraction,
        message: redactUrls(params.message),
        // The layout a stage's report is of (engine v0.14.0, issue 382), so
        // cell 01 can draw the stage before the run ends. Only an id in the
        // engine's shape crosses; anything else is left behind and the
        // report goes on without it, as one from an older engine does.
        ...(isLayoutId(params.layout) ? { layout: params.layout } : {}),
      }
      send(CHANNELS.engineProgress, progress)
    } else if (
      method === 'job/log' &&
      typeof params.level === 'string' &&
      LEVELS.has(params.level) &&
      typeof params.line === 'string'
    ) {
      // Redacted here, at the one door the engine's log lines come through
      // on their way to the page: see the note at the top of this file.
      const line: JobLog = {
        id: token,
        level: params.level as JobLog['level'],
        line: redactUrls(params.line),
      }
      send(CHANNELS.engineLog, line)
    } else {
      log(`dropped a ${method} notification of an unexpected shape`)
    }
  })
  return () => {
    offState()
    offNotifications()
  }
}
