// The ordering property the record session rests on (spec 037, FR-008):
// for one renderer frame, the `projects:*` invokes are handled by the main
// process in the order they were sent, with the main process kept busy.
//
// Everything part 1 of the record session builds stands on this. A run reads
// its inputs with a `projects.get` sent after the writes a person made before
// the press, and that read sees them only if the bridge hands main the
// messages in the order the renderer sent them and each handler reaches the
// store's queue before it returns (`tests/unit/ipc.test.ts` holds the second
// half). Without it every write and every read would have to carry a
// sequence number of the renderer's (research.md, R3). It stays in the suite
// either way, as the guard of the property, so an Electron that stopped
// keeping the order would fail here by name rather than as a choice lost now
// and then.
//
// The load is the main process's own: a timer that spins the event loop for
// most of every few milliseconds, so the invokes pile up behind it and are
// handed over in batches, which is when an order would be lost if Electron
// did not keep one. `e2e-loop` with `load` adds busy processes beside it.
//
// The record's answers alone would not show the order of the reads, which
// the store's queue would hide since T003 put `get` in it, so the handlers
// are wrapped where Electron keeps them (`ipcMain`'s own map of invoke
// handlers, as `tests/support/hold-writes.ts` does, and for the same reason
// failing by name if a release moves it). The wrapper notes the message and
// calls the app's own handler in the same turn, so nothing about the timing
// the app sees changes.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { CHANNELS } from '../../src/shared/api'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** How long each spin of the main process lasts, and how many rounds of sends there are. */
const BUSY_MS = 15
const ROUNDS = 30
/** Calls sent in one synchronous burst, between two pauses of the renderer. */
const PER_ROUND = 6

/** The four calls the burst is made of, by the store method each reaches. */
const METHODS: Record<string, string> = {
  [CHANNELS.projectsGet]: 'get',
  [CHANNELS.projectsRename]: 'rename',
  [CHANNELS.projectsSetExport]: 'setExport',
  [CHANNELS.projectsSetTheme]: 'setTheme',
}

async function withApp(run: (page: Page, app: ElectronApplication) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-record-order-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(join(engineHome, 'fake-engine.json'), JSON.stringify({ version: PINNED_ENGINE }))
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_EXPORT_FOLDER: join(dir, 'exports'),
      LEGIBLE_USER_DATA: join(dir, 'profile'),
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => 'api' in window, undefined, { timeout: 20_000 })
    await run(page, app)
  } finally {
    // The spin stopped first, so the close is not held behind it; an app
    // that has already gone has no spin to stop.
    await app
      .evaluate(() => {
        const load = (globalThis as unknown as { recordOrderLoad?: { timer: NodeJS.Timeout } })
          .recordOrderLoad
        if (load !== undefined) clearInterval(load.timer)
      })
      .catch(() => undefined)
    await app.close()
  }
}

/**
 * Wrap the four handlers so each notes, in the turn it is handed a message,
 * which call it was and what it was given after the project's id. The app's
 * own handler is then called in that same turn with the same arguments.
 */
async function noteArrivals(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, methods) => {
    type Handler = (event: unknown, ...args: unknown[]) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })
      ._invokeHandlers
    const arrived: string[] = []
    ;(globalThis as unknown as { recordOrderArrived?: string[] }).recordOrderArrived = arrived
    for (const [channel, method] of Object.entries(methods)) {
      const own = handlers?.get(channel)
      if (handlers === undefined || own === undefined)
        throw new Error(`ipcMain keeps no handler for ${channel} where this test looks for one`)
      handlers.set(channel, (event, ...args) => {
        arrived.push(JSON.stringify([method, args.slice(1)]))
        return own(event, ...args)
      })
    }
  }, METHODS)
}

/** Start the main process's spin, and say how many spins it has made so far. */
async function startLoad(app: ElectronApplication): Promise<void> {
  await app.evaluate((_electron, busy) => {
    const load = { ticks: 0, timer: undefined as unknown as NodeJS.Timeout }
    load.timer = setInterval(() => {
      const end = Date.now() + busy
      while (Date.now() < end) {
        // spin: nothing else in the main process runs meanwhile
      }
      load.ticks += 1
    }, 1)
    ;(globalThis as unknown as { recordOrderLoad?: typeof load }).recordOrderLoad = load
  }, BUSY_MS)
}

const spins = (app: ElectronApplication): Promise<number> =>
  app.evaluate(
    () =>
      (globalThis as unknown as { recordOrderLoad?: { ticks: number } }).recordOrderLoad?.ticks ??
      0,
  )

const arrivals = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(
    () => (globalThis as unknown as { recordOrderArrived?: string[] }).recordOrderArrived ?? [],
  )

/** What one answer said about the three fields the burst writes. */
interface Seen {
  name: string
  tag: string | null
  theme: string
}

interface Burst {
  /** Each call as sent: its method and its arguments after the id, as main notes them. */
  sent: string[]
  /** The index of each call, in the order the renderer was answered. */
  answered: number[]
  /** What each call was answered with, by index. */
  seen: (Seen | null)[]
  /** What each call expects to see if every write sent before it, and itself, has landed. */
  expected: Seen[]
  /** Which calls are writes. */
  writes: boolean[]
  /** Any call that was refused, with its sentence. */
  refused: string[]
}

/**
 * From the renderer, interleave writes of increasing values with reads of
 * the record: a rename, a read, an export choice, a read, a theme, a read,
 * and again, in bursts sent synchronously with a short and varying pause
 * between them, none of them waiting for an answer before the next is sent.
 */
function burst(page: Page, id: string, name: string): Promise<Burst> {
  return page.evaluate(
    async ({ id, name, rounds, perRound }) => {
      type Answer = { name: string; theme: string; export: { options: { tag?: string } } }
      const projects = (
        window as unknown as {
          api: { projects: Record<string, (...args: unknown[]) => Promise<Answer>> }
        }
      ).api.projects
      const sent: string[] = []
      const answered: number[] = []
      const seen: (Seen | null)[] = []
      const expected: Seen[] = []
      const writes: boolean[] = []
      const refused: string[] = []
      const pending: Promise<void>[] = []
      const now: Seen = { name, tag: null, theme: 'warm-dark' }
      let n = 0
      let themes = 0
      const send = (method: string, args: unknown[], write: boolean): void => {
        const i = n++
        sent.push(JSON.stringify([method, args]))
        writes.push(write)
        expected.push({ ...now })
        seen.push(null)
        pending.push(
          projects[method](id, ...args).then(
            (answer) => {
              answered.push(i)
              seen[i] = {
                name: answer.name,
                tag: answer.export.options.tag ?? null,
                theme: answer.theme,
              }
            },
            (error: unknown) => {
              answered.push(i)
              refused.push(`${i} ${method}: ${error instanceof Error ? error.message : error}`)
            },
          ),
        )
      }
      for (let round = 0; round < rounds; round++) {
        for (let k = 0; k < perRound; k++) {
          const step = n % 6
          if (step === 0) {
            now.name = `Order ${n}`
            send('rename', [now.name], true)
          } else if (step === 2) {
            now.tag = `w${n}`
            send('setExport', [{ preset: 'instagram-reel', options: { tag: now.tag } }], true)
          } else if (step === 4) {
            now.theme = themes++ % 2 === 0 ? 'sepia' : 'warm-dark'
            send('setTheme', [now.theme], true)
          } else {
            send('get', [], false)
          }
        }
        // Between bursts the renderer lets go for a moment, of a length that
        // changes from round to round, so the bursts land at different
        // points of the main process's spin.
        await new Promise((resolve) => setTimeout(resolve, round % 4))
      }
      await Promise.all(pending)
      return { sent, answered, seen, expected, writes, refused }
    },
    { id, name, rounds: ROUNDS, perRound: PER_ROUND },
  )
}

/** A project of the test's own, made through the bridge, and its id. */
const create = (page: Page, name: string): Promise<string> =>
  page.evaluate(
    async (name) =>
      (
        await (
          window as unknown as {
            api: { projects: { create(input: unknown): Promise<{ id: string }> } }
          }
        ).api.projects.create({ name, feed: 'la-metro-rail' })
      ).id,
    name,
  )

/** Load the burst under the main process's spin, and check the spin ran throughout it. */
async function underLoad(page: Page, app: ElectronApplication): Promise<Burst> {
  const id = await create(page, 'Order')
  await noteArrivals(app)
  await startLoad(app)
  const before = await spins(app)
  const result = await burst(page, id, 'Order')
  const during = (await spins(app)) - before
  // A load that quietly stopped would make a run "under load" that was not.
  // A burst of this size takes well over a second of a spinning main, which
  // is dozens of spins; ten is the floor that says the spin was there.
  expect(during, 'the main process was spinning while the burst was handled').toBeGreaterThan(10)
  expect(result.refused, 'no call was refused').toEqual([])
  expect(result.sent, 'every call was sent').toHaveLength(ROUNDS * PER_ROUND)
  return result
}

test('invokes from one frame reach main in the order they were sent, under load', async () => {
  test.setTimeout(120_000)
  await withApp(async (page, app) => {
    const result = await underLoad(page, app)

    // The property itself: main was handed every call, reads and writes
    // alike, in exactly the order the renderer sent them.
    expect(await arrivals(app), 'main was handed the calls in the order they were sent').toEqual(
      result.sent,
    )

    // And what follows from it through the store's queue: the writes were
    // answered in the order they were sent, each with the record holding it
    // and every write before it.
    const writes = result.answered.filter((i) => result.writes[i])
    expect(writes, 'the writes were answered in the order they were sent').toEqual(
      [...writes].sort((a, b) => a - b),
    )
    for (let i = 0; i < result.sent.length; i++) {
      if (!result.writes[i]) continue
      expect(
        result.seen[i],
        `write ${i} (${result.sent[i]}) holds itself and every write before it`,
      ).toEqual(result.expected[i])
    }
  })
})

// The contract the record session gives a run (contracts/bridge.md): a read
// answers with every write sent before it, and the answers come back in the
// order the calls went. It rests on the property above and on `get` waiting
// in the store's queue behind the project's writes (T003).
test('a read answers with every write sent before it, and every answer comes back in send order, under load', async () => {
  test.setTimeout(120_000)
  await withApp(async (page, app) => {
    const result = await underLoad(page, app)
    expect(result.answered, 'every call was answered in the order it was sent').toEqual(
      result.sent.map((_call, i) => i),
    )
    for (let i = 0; i < result.sent.length; i++) {
      expect(
        result.seen[i],
        `call ${i} (${result.sent[i]}) sees every write sent before it`,
      ).toEqual(result.expected[i])
    }
  })
})
