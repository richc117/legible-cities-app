// What a quit says of itself, and what is left when it does not finish
// (issue 749, `src/main/quit-trail.ts`).
//
// A repeat of quit-guard.spec.ts once left the app running twenty seconds
// after it had accepted a quit and stopped its engine, with nothing in
// `main.log` to say where the quit had stopped. What is held here: the
// report's text, from stand-in windows - one destroyed, one whose web
// contents are gone, none at all, a capture still live; that a window half
// gone is asked nothing it cannot answer, and that a fact which throws costs
// its own line and no other; that the report is written once for each bound
// and never throws; that the timers are armed once, when the watch begins,
// and unref'd; that a line said after the log files have closed goes
// straight to the file, appended, stamped and never through a link; and,
// read from its text, that index.ts hands the one trail to the guard, the
// gate and the shutdown and says Electron's own events into it. The lines
// the guard, the gate and the shutdown say are in `quit-guard.test.ts` and
// `window-lifecycle.test.ts`. Each was watched failing under its mutation in
// `quit-trail.mutations.json`.

import { closeSync, constants, open as openFd, readFileSync, write as writeFd } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOG_WAIT_MS } from '../../src/main/log-file'
import {
  LATE_HELD,
  lateLog,
  QUIT_OVERDUE_MS,
  QUIT_TAG,
  QuitTrail,
  STEPS_KEPT,
  whatIsLeft,
  type LateLogDeps,
  type LeftFacts,
  type WindowLike,
} from '../../src/main/quit-trail'

/** A read no window half gone may be asked for: the test fails by the report saying so. */
const never = (what: string) => (): never => {
  throw new Error(`${what} was read`)
}

/** A window as Electron hands one over, each fact a test can move. */
function standIn(
  over: {
    destroyed?: boolean
    visible?: boolean
    contents?: 'live' | 'destroyed' | 'none'
    url?: string
    offscreen?: boolean
    crashed?: boolean
  } = {},
): WindowLike {
  // Electron throws from everything of a destroyed window but `isDestroyed`,
  // the `webContents` property included.
  if (over.destroyed === true)
    return Object.defineProperty(
      { isDestroyed: () => true, isVisible: never('isVisible of a destroyed window') },
      'webContents',
      { get: never('webContents of a destroyed window') },
    ) as WindowLike
  const window = { isDestroyed: () => false, isVisible: () => over.visible ?? true }
  const contents = over.contents ?? 'live'
  if (contents === 'none') return { ...window, webContents: null }
  // And from everything of destroyed web contents but theirs.
  const gone = contents === 'destroyed'
  return {
    ...window,
    webContents: {
      isDestroyed: () => gone,
      getURL: gone ? never('getURL of destroyed web contents') : () => over.url ?? 'about:blank',
      isOffscreen: gone
        ? never('isOffscreen of destroyed web contents')
        : () => over.offscreen ?? false,
      isCrashed: gone ? never('isCrashed of destroyed web contents') : () => over.crashed ?? false,
    },
  }
}

const INTERFACE = 'app://local/ui/'
const PROJECT_PAGE = 'app://local/projects/paris0000001/paris.html?strip=24'

/** The facts a report is made from, quiet unless a test says otherwise. */
const facts = (over: Partial<LeftFacts> = {}): LeftFacts => ({
  windows: () => [],
  appWindow: () => null,
  captures: () => 0,
  exports: () => ({ live: 0, running: 0 }),
  resources: () => [],
  ...over,
})

describe('what is left', () => {
  it('says each window: the app’s own, another of the interface’s, a capture’s and any other', () => {
    const own = standIn({ url: INTERFACE })
    const second = standIn({ url: `${INTERFACE}index.html`, visible: false })
    const capture = standIn({ url: PROJECT_PAGE, offscreen: true, visible: false })
    const other = standIn({ url: 'devtools://devtools/bundled/x.html', crashed: true })
    const lines = whatIsLeft(
      facts({ windows: () => [own, second, capture, other], appWindow: () => own }),
    )
    expect(lines.slice(0, 4)).toEqual([
      "window 1 of 4: the interface's, the app's own window; not destroyed; visible; web contents not destroyed, renderer running",
      "window 2 of 4: the interface's, but not the window the app holds; not destroyed; hidden; web contents not destroyed, renderer running",
      "window 3 of 4: a capture's; not destroyed; hidden; web contents not destroyed, renderer running",
      'window 4 of 4: of another kind; not destroyed; visible; web contents not destroyed, renderer crashed',
    ])
  })

  it('writes no address, whatever page a window holds', () => {
    const lines = whatIsLeft(
      facts({
        windows: () => [
          standIn({ url: `${INTERFACE}?token=secret` }),
          standIn({ url: PROJECT_PAGE, offscreen: true }),
          standIn({ url: 'https://agency.example/gtfs.zip?api_key=secret' }),
        ],
      }),
    ).join('\n')
    expect(lines).not.toMatch(/:\/\//)
    expect(lines).not.toMatch(/paris|secret|agency/)
  })

  it('asks a destroyed window nothing more than whether it is destroyed', () => {
    const gone = standIn({ destroyed: true })
    const held = standIn({ destroyed: true })
    const lines = whatIsLeft(facts({ windows: () => [gone, held], appWindow: () => held }))
    expect(lines.slice(0, 2)).toEqual([
      'window 1 of 2: not the window the app holds; destroyed',
      "window 2 of 2: the app's own window; destroyed",
    ])
  })

  it('asks web contents that are gone nothing more than whether they are destroyed', () => {
    const lines = whatIsLeft(
      facts({
        windows: () => [
          standIn({ contents: 'destroyed', visible: false }),
          standIn({ contents: 'none' }),
        ],
      }),
    )
    expect(lines.slice(0, 2)).toEqual([
      'window 1 of 2: of a kind that cannot be told without its web contents; not destroyed; hidden; web contents destroyed',
      'window 2 of 2: of a kind that cannot be told without its web contents; not destroyed; visible; web contents destroyed',
    ])
  })

  it('still calls the app’s own window the interface’s when its web contents are gone', () => {
    const own = standIn({ contents: 'destroyed' })
    expect(whatIsLeft(facts({ windows: () => [own], appWindow: () => own }))[0]).toBe(
      "window 1 of 1: the interface's, the app's own window; not destroyed; visible; web contents destroyed",
    )
  })

  it('says there is no window, and what else is quiet', () => {
    expect(whatIsLeft(facts())).toEqual([
      'windows: none',
      'captures still running: 0',
      'exports: 0 not yet unwound, 0 of them not yet asked to stop',
      "what Node's loop holds, by kind: nothing",
    ])
  })

  it('says a capture still live, and what the exporter says is running', () => {
    const lines = whatIsLeft(
      facts({
        windows: () => [standIn({ url: PROJECT_PAGE, offscreen: true, visible: false })],
        captures: () => 1,
        exports: () => ({ live: 2, running: 1 }),
      }),
    )
    expect(lines).toEqual([
      "window 1 of 1: a capture's; not destroyed; hidden; web contents not destroyed, renderer running",
      'captures still running: 1',
      'exports: 2 not yet unwound, 1 of them not yet asked to stop',
      "what Node's loop holds, by kind: nothing",
    ])
    expect(whatIsLeft(facts({ exports: () => null }))[2]).toBe('exports: no exporter yet')
  })

  it('counts what holds Node’s loop by kind, the most first', () => {
    const lines = whatIsLeft(
      facts({ resources: () => ['PipeWrap', 'Timeout', 'FSReqCallback', 'Timeout', 'Timeout'] }),
    )
    expect(lines.at(-1)).toBe(
      "what Node's loop holds, by kind: Timeout 3, FSReqCallback 1, PipeWrap 1",
    )
  })

  it('never throws: a fact that cannot be read costs its own line, and the others are still read', () => {
    const broke = never('a fact')
    const window = standIn({ url: INTERFACE })
    for (const fact of ['windows', 'appWindow', 'captures', 'exports', 'resources'] as const) {
      const lines = whatIsLeft(
        facts({
          windows: () => [window],
          captures: () => 3,
          resources: () => ['Timeout'],
          [fact]: broke,
        }),
      )
      const text = lines.join('\n')
      if (fact === 'windows') expect(text).toContain('windows: could not be read')
      // Without the app's window to compare with, the page still says whose it is.
      else
        expect(text).toContain(
          "window 1 of 1: the interface's, but not the window the app holds; not destroyed; visible",
        )
      expect(text).toContain(
        fact === 'captures'
          ? 'captures still running: could not be read'
          : 'captures still running: 3',
      )
      expect(text).toContain(
        fact === 'exports' ? 'exports: could not be read' : 'exports: 0 not yet unwound',
      )
      expect(text).toContain(
        fact === 'resources'
          ? "what Node's loop holds, by kind: could not be read"
          : "what Node's loop holds, by kind: Timeout 1",
      )
    }
  })

  it('never throws for a window whose every read throws, and still reads the next', () => {
    const broken = {
      isDestroyed: never('isDestroyed'),
      isVisible: never('isVisible'),
      webContents: null,
    }
    // Not destroyed, but nothing else of it answers.
    const half = Object.defineProperty(
      { isDestroyed: () => false, isVisible: never('isVisible') },
      'webContents',
      { get: never('webContents') },
    ) as WindowLike
    const lines = whatIsLeft(facts({ windows: () => [broken, half, standIn({ url: INTERFACE })] }))
    expect(lines.slice(0, 3)).toEqual([
      'window 1 of 3: could not be read',
      'window 2 of 3: of a kind that cannot be told without its web contents; not destroyed; could not be read; web contents could not be read',
      "window 3 of 3: the interface's, but not the window the app holds; not destroyed; visible; web contents not destroyed, renderer running",
    ])
  })
})

/** A trail over a clock, a log, a file and timers a test holds. */
function trail(over: { left?: () => readonly string[]; overdue?: readonly number[] } = {}) {
  const logged: string[] = []
  const filed: string[][] = []
  const clock = { now: 10_000 }
  const timers: { run: () => void; ms: number; unrefs: number }[] = []
  const made = new QuitTrail({
    log: (line) => logged.push(line),
    late: (lines) => filed.push([...lines]),
    left: over.left ?? (() => ['windows: none', 'captures still running: 0']),
    now: () => clock.now,
    timer: (run, ms) => {
      const timer = { run, ms, unrefs: 0 }
      timers.push(timer)
      return {
        unref: () => {
          timer.unrefs += 1
        },
      }
    },
    overdue: over.overdue,
  })
  return { trail: made, logged, filed, clock, timers }
}

describe('the trail', () => {
  it('logs each line as it is said, and nothing straight to the file while the log files are open', () => {
    const { trail: t, logged, filed } = trail()
    t.say('asking the engine to stop')
    t.say("the engine's stop ended (resolved)")
    expect(logged).toEqual(['asking the engine to stop', "the engine's stop ended (resolved)"])
    expect(filed).toEqual([])
  })

  it('writes a line straight to the file too, once the log files are closing', () => {
    const { trail: t, logged, filed } = trail()
    t.say('closing the log files')
    t.filesClosing()
    t.say('the log files are closed')
    t.say("the app's own quit is asked")
    // Still logged: standard error has it in development, as it has every line.
    expect(logged).toEqual([
      'closing the log files',
      'the log files are closed',
      "the app's own quit is asked",
    ])
    expect(filed).toEqual([['the log files are closed'], ["the app's own quit is asked"]])
  })

  it('waits five seconds, then fifteen: the quit’s own two waits and a second over, then three times that', () => {
    expect(LOG_WAIT_MS).toBe(2_000)
    expect([...QUIT_OVERDUE_MS]).toEqual([2 * LOG_WAIT_MS + 1_000, 15_000])
    expect([...QUIT_OVERDUE_MS]).toEqual([5_000, 15_000])
  })

  it('arms its timers when the watch begins and not before: one for each bound, each unref’d', () => {
    const { trail: t, timers } = trail()
    t.say('asking the engine to stop')
    expect(timers).toEqual([])
    t.watch()
    expect(timers.map((timer) => timer.ms)).toEqual([5_000, 15_000])
    expect(timers.map((timer) => timer.unrefs)).toEqual([1, 1])
  })

  it('arms them once, however often the watch is asked for', () => {
    const { trail: t, timers } = trail()
    t.watch()
    t.watch()
    t.watch()
    expect(timers).toHaveLength(2)
  })

  it('never holds the process: a real timer it arms has no hold on the loop', () => {
    const real: NodeJS.Timeout[] = []
    const t = new QuitTrail({
      log: () => undefined,
      late: () => undefined,
      left: () => [],
      now: () => 0,
      // As index.ts hands it: `setTimeout`, and nothing else.
      timer: (run, ms) => {
        const timer = setTimeout(run, ms)
        real.push(timer)
        return timer
      },
    })
    try {
      t.watch()
      expect(real).toHaveLength(2)
      expect(real.map((timer) => timer.hasRef())).toEqual([false, false])
    } finally {
      for (const timer of real) clearTimeout(timer)
    }
  })

  it('writes what is left when a bound passes, with how far the quit got, and says nothing is done about it', () => {
    const {
      trail: t,
      logged,
      clock,
      timers,
    } = trail({
      left: () => [
        "window 1 of 1: the interface's, the app's own window; not destroyed; visible; web contents not destroyed, renderer running",
        'captures still running: 0',
        'exports: 1 not yet unwound, 0 of them not yet asked to stop',
        "what Node's loop holds, by kind: FSReqCallback 2",
      ],
    })
    t.say('asking the engine to stop')
    clock.now += 2_200
    t.say("the engine's stop ended (resolved)")
    t.watch()
    clock.now += 3
    t.say("the app's own quit is asked")
    t.say("the window's close is let through, by the quit under way")
    logged.length = 0
    clock.now = 10_000 + 2_200 + 5_004
    timers[0].run()
    expect(logged).toEqual([
      'the quit has not finished: the process is still here 5 s after the quit was let go on to Electron (report 1 of 2). What is left:',
      "  window 1 of 1: the interface's, the app's own window; not destroyed; visible; web contents not destroyed, renderer running",
      '  captures still running: 0',
      '  exports: 1 not yet unwound, 0 of them not yet asked to stop',
      "  what Node's loop holds, by kind: FSReqCallback 2",
      "  the quit's steps so far, each with when it was said against that moment:",
      '    -2200 ms: asking the engine to stop',
      "    +0 ms: the engine's stop ended (resolved)",
      "    +3 ms: the app's own quit is asked",
      "    +3 ms: the window's close is let through, by the quit under way",
      '  nothing is done about it; one more report follows if the process is still here',
    ])
  })

  it('writes once for each bound: a timer that fires again writes nothing, and the second says it is the last', () => {
    const { trail: t, logged, clock, timers } = trail()
    t.watch()
    clock.now += 5_000
    timers[0].run()
    const first = logged.length
    expect(first).toBeGreaterThan(0)
    timers[0].run()
    expect(logged, 'the first bound, fired twice').toHaveLength(first)

    clock.now += 10_100
    timers[1].run()
    expect(logged[first]).toBe(
      'the quit has not finished: the process is still here 15.1 s after the quit was let go on to Electron (report 2 of 2). What is left:',
    )
    expect(logged.at(-1)).toBe('  nothing is done about it, and no further report follows')
    const second = logged.length
    timers[1].run()
    expect(logged, 'the second bound, fired twice').toHaveLength(second)
  })

  it('writes the report straight to the file, as one piece, once the log files are closing', () => {
    const { trail: t, logged, filed, clock, timers } = trail()
    t.watch()
    t.filesClosing()
    t.say('the log files are closed')
    filed.length = 0
    logged.length = 0
    clock.now += 5_000
    timers[0].run()
    expect(filed).toHaveLength(1)
    expect(filed[0]).toEqual(logged)
    expect(filed[0][0]).toMatch(/^the quit has not finished: the process is still here 5 s /)
    expect(filed[0]).toContain('    +0 ms: the log files are closed')
  })

  it('reports and does nothing else: it asks for no further timer and reads only what it is handed', () => {
    const left = vi.fn(() => ['windows: none'])
    const { trail: t, timers } = trail({ left })
    t.watch()
    expect(left, 'nothing is read until a bound passes').not.toHaveBeenCalled()
    timers[0].run()
    timers[1].run()
    expect(left).toHaveBeenCalledTimes(2)
    expect(timers, 'no timer armed by a report').toHaveLength(2)
  })

  it('keeps the newest steps for the report, and says how many it did not keep', () => {
    const { trail: t, logged, timers } = trail()
    for (let i = 0; i < STEPS_KEPT + 7; i += 1) t.say(`step ${i}`)
    t.watch()
    logged.length = 0
    timers[0].run()
    const text = logged.join('\n')
    expect(text).toContain('(7 earlier not kept)')
    expect(text).not.toContain(': step 6\n')
    expect(text).toContain(': step 7\n')
    expect(text).toContain(`: step ${STEPS_KEPT + 6}\n`)
  })

  it('never throws, whatever it is handed throws: the log, the file, the clock, the timers, the facts', () => {
    const broke = never('a dependency')
    const t = new QuitTrail({ log: broke, late: broke, left: broke, now: broke, timer: broke })
    expect(() => {
      t.say('asking the engine to stop')
      t.filesClosing()
      t.say('the log files are closed')
      t.watch()
    }).not.toThrow()

    // And a report whose every read throws is still written, as far as it can be.
    const { trail: reporting, logged, timers } = trail({ left: broke })
    reporting.say('asking the engine to stop')
    reporting.watch()
    logged.length = 0
    expect(() => timers[0].run()).not.toThrow()
    expect(logged[0]).toMatch(/^the quit has not finished: /)
    expect(logged[1]).toBe('  what is left could not be read')
    expect(logged).toContain('    +0 ms: asking the engine to stop')

    // A timer that cannot be armed costs its own report and not the other.
    const armed: number[] = []
    const half = new QuitTrail({
      log: () => undefined,
      late: () => undefined,
      left: () => [],
      now: () => 0,
      timer: (_run, ms) => {
        if (ms === 5_000) throw new Error('no timer')
        armed.push(ms)
        return { unref: () => undefined }
      },
    })
    expect(() => half.watch()).not.toThrow()
    expect(armed).toEqual([15_000])
  })
})

/** A late log over file calls a test answers when it chooses. */
function late() {
  const opens: {
    path: string
    flags: number
    mode: number
    done: (error: Error | null, fd: number) => void
  }[] = []
  const writes: { fd: number; text: string }[] = []
  const deps: LateLogDeps = {
    open: (path, flags, mode, done) => opens.push({ path, flags, mode, done }),
    write: (fd, text, done) => {
      writes.push({ fd, text })
      done(null)
    },
    now: () => new Date('2026-11-22T10:00:00.000Z'),
  }
  return { log: lateLog('/logs/main.log', QUIT_TAG, deps), opens, writes }
}

const roots: string[] = []
/**
 * The handles the tests on real files opened. A late log never closes its
 * own - the process it is written for is on its way out - so the tests do,
 * before the folder goes: Windows will not remove one that holds an open file.
 */
const handles: number[] = []

afterEach(async () => {
  for (const fd of handles.splice(0)) closeSync(fd)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'legible-cities-quit-trail-'))
  roots.push(root)
  return root
}

/**
 * The real file calls, a promise for the moment the first of each has
 * answered, and how many writes were asked for: no test here sleeps.
 */
function realFile() {
  let opened!: () => void
  let written!: () => void
  const whenOpened = new Promise<void>((resolve) => {
    opened = resolve
  })
  const whenWritten = new Promise<void>((resolve) => {
    written = resolve
  })
  const asked = { writes: 0 }
  const deps: LateLogDeps = {
    open: (path, flags, mode, done) =>
      openFd(path, flags, mode, (error, fd) => {
        if (error === null) handles.push(fd)
        done(error, fd)
        opened()
      }),
    write: (fd, text, done) => {
      asked.writes += 1
      writeFd(fd, text, (error) => {
        done(error)
        written()
      })
    },
    now: () => new Date('2026-11-22T10:00:00.000Z'),
  }
  return { deps, whenOpened, whenWritten, asked }
}

describe('the late log', () => {
  it('opens the file once, to append and create and never through a link, when it is asked to', () => {
    const { log, opens } = late()
    log.open()
    log.open()
    expect(opens).toHaveLength(1)
    expect(opens[0].path).toBe('/logs/main.log')
    expect(opens[0].mode).toBe(0o644)
    const { flags } = opens[0]
    expect(flags & constants.O_APPEND, 'appends').toBe(constants.O_APPEND)
    expect(flags & constants.O_CREAT, 'creates').toBe(constants.O_CREAT)
    expect(flags & constants.O_WRONLY, 'writes only').toBe(constants.O_WRONLY)
    expect(flags & constants.O_TRUNC, 'never truncates').toBe(0)
    if (constants.O_NOFOLLOW !== undefined)
      expect(flags & constants.O_NOFOLLOW, 'never through a link').toBe(constants.O_NOFOLLOW)
    opens[0].done(null, 7)
    log.open()
    expect(opens, 'and not again once it is open').toHaveLength(1)
  })

  it('writes a line at once when the file is open: stamped, tagged, one write for the lines it is handed', () => {
    const { log, opens, writes } = late()
    log.open()
    opens[0].done(null, 7)
    log.append(['the log files are closed'])
    log.append(['the quit has not finished: …', '  windows: none'])
    expect(writes).toEqual([
      { fd: 7, text: '2026-11-22T10:00:00.000Z [quit] the log files are closed\n' },
      {
        fd: 7,
        text:
          '2026-11-22T10:00:00.000Z [quit] the quit has not finished: …\n' +
          '2026-11-22T10:00:00.000Z [quit]   windows: none\n',
      },
    ])
  })

  it('opens the file for a line said before anyone asked, holds the line, and writes it when the file answers', () => {
    const { log, opens, writes } = late()
    log.append(['one'])
    log.append(['two'])
    expect(opens, 'one open, for both').toHaveLength(1)
    expect(writes).toEqual([])
    opens[0].done(null, 9)
    expect(writes).toEqual([
      { fd: 9, text: '2026-11-22T10:00:00.000Z [quit] one\n2026-11-22T10:00:00.000Z [quit] two\n' },
    ])
    log.append(['three'])
    expect(writes[1]).toEqual({ fd: 9, text: '2026-11-22T10:00:00.000Z [quit] three\n' })
  })

  it('holds no more than a bounded number of pieces while the file does not answer', () => {
    const { log, opens, writes } = late()
    for (let i = 0; i < LATE_HELD + 50; i += 1) log.append([`line ${i}`])
    opens[0].done(null, 3)
    expect(writes).toHaveLength(1)
    expect(writes[0].text.split('\n').filter((line) => line !== '')).toHaveLength(LATE_HELD)
    expect(writes[0].text).toContain(`line ${LATE_HELD - 1}\n`)
    expect(writes[0].text).not.toContain(`line ${LATE_HELD}\n`)
  })

  it('drops its lines when the file cannot be opened, and does not ask again', () => {
    const { log, opens, writes } = late()
    log.append(['one'])
    opens[0].done(Object.assign(new Error('a link'), { code: 'ELOOP' }), -1)
    log.append(['two'])
    log.open()
    expect(opens).toHaveLength(1)
    expect(writes).toEqual([])
  })

  it('redacts an address in a line, as every log line has it', () => {
    const { log, opens, writes } = late()
    log.open()
    opens[0].done(null, 7)
    log.append(['fetched https://agency.example/gtfs.zip?api_key=secret'])
    expect(writes[0].text).toBe(
      '2026-11-22T10:00:00.000Z [quit] fetched https://agency.example/gtfs.zip?api_key=<redacted>\n',
    )
  })

  it('never throws into the quit: not when the open throws, the write throws, or the clock does', () => {
    const broke = never('a file call')
    const clock = (): Date => new Date('2026-11-22T10:00:00.000Z')
    const noOpen = lateLog('/logs/main.log', QUIT_TAG, { open: broke, write: broke, now: clock })
    expect(() => {
      noOpen.open()
      noOpen.append(['one'])
    }).not.toThrow()

    let answer!: (error: Error | null, fd: number) => void
    const noWrite = lateLog('/logs/main.log', QUIT_TAG, {
      open: (_path, _flags, _mode, done) => {
        answer = done
      },
      write: broke,
      now: clock,
    })
    noWrite.append(['held'])
    expect(() => answer(null, 4)).not.toThrow()
    expect(() => noWrite.append(['at once'])).not.toThrow()

    const noClock = lateLog('/logs/main.log', QUIT_TAG, {
      open: () => undefined,
      write: broke,
      now: broke,
    })
    expect(() => noClock.append(['one'])).not.toThrow()
  })

  it('appends to the real file after what the log left there, and makes it where there is none', async () => {
    const dir = await folder()
    const path = join(dir, 'main.log')
    await writeFile(path, '2026-11-22T09:59:59.000Z [quit] closing the log files\n')
    const file = realFile()
    const log = lateLog(path, QUIT_TAG, file.deps)
    log.append(['the log files are closed'])
    await file.whenWritten
    expect(await readFile(path, 'utf8')).toBe(
      '2026-11-22T09:59:59.000Z [quit] closing the log files\n' +
        '2026-11-22T10:00:00.000Z [quit] the log files are closed\n',
    )

    const fresh = realFile()
    const made = join(dir, 'made.log')
    lateLog(made, QUIT_TAG, fresh.deps).append(['one'])
    await fresh.whenWritten
    expect(await readFile(made, 'utf8')).toBe('2026-11-22T10:00:00.000Z [quit] one\n')
  })

  it.skipIf(process.platform === 'win32')(
    'never writes through a link planted where the file should be',
    async () => {
      const dir = await folder()
      const target = join(dir, 'somebody-elses.txt')
      await writeFile(target, 'untouched\n')
      await symlink(target, join(dir, 'main.log'))
      const file = realFile()
      const log = lateLog(join(dir, 'main.log'), QUIT_TAG, file.deps)
      log.append(['the log files are closed'])
      await file.whenOpened
      // Refused at the open: the line that was held is not written, and no
      // later one is.
      log.append(['again'])
      expect(file.asked.writes, 'no write was asked of a link').toBe(0)
      expect(await readFile(target, 'utf8')).toBe('untouched\n')
    },
  )

  it('is the file module’s own open and write unless it is handed others', () => {
    // The defaults are Node's two calls with callbacks, read from the text:
    // a synchronous write here would let a disk that does not answer hold
    // the quit.
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'quit-trail.ts'), 'utf8')
    expect(source).toContain(
      "import { constants, open as openFile, write as writeFile } from 'node:fs'",
    )
    expect(source).not.toMatch(/\b(?:open|write|append|appendFile|close|mkdir)Sync\b/)
    expect(source).not.toMatch(/from 'electron'/)
  })
})

// `index.ts` imports Electron and cannot be run here, so what it does with
// the trail is read from its text, as `quit-guard.test.ts` reads what it does
// with the guard.
describe('the trail in index.ts', () => {
  const index = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'index.ts'), 'utf8')

  it('hands the one trail to the guard, the gate and the shutdown', () => {
    expect(index.match(/new QuitTrail\(/g), 'one trail').toHaveLength(1)
    expect(index).toContain('const quit = quitGate((line) => quitTrail.say(line))')
    // The guard's, last of what it is handed.
    expect(index).toMatch(
      /now: \(\) => performance\.now\(\),\n {2}say: \(line\) => quitTrail\.say\(line\),\n\}\)/,
    )
    // The shutdown's, with the watch.
    expect(index).toMatch(
      /error: \(message\) => log\.error\('engine', message\),\n(?:\s*\/\/[^\n]*\n)*\s*say: \(line\) => quitTrail\.say\(line\),\n\s*watch: \(\) => quitTrail\.watch\(\),/,
    )
    expect(index.match(/quitTrail\.watch\(\)/g), 'the watch begins in one place').toHaveLength(1)
  })

  it('logs under the quit’s tag, on a clock that cannot go back, with timers of Node’s own', () => {
    expect(index).toContain('  log: (line) => log.info(QUIT_TAG, line),')
    expect(index).toMatch(
      /resources: \(\) => process\.getActiveResourcesInfo\(\),\n\s*\}\),\n {2}now: \(\) => performance\.now\(\),\n {2}timer: \(run, ms\) => setTimeout\(run, ms\),\n\}\)/,
    )
  })

  it('reads what is left from Electron’s windows, the captures, the exporter and Node', () => {
    expect(index).toMatch(
      /whatIsLeft\(\{\s*windows: \(\) => BrowserWindow\.getAllWindows\(\),\s*appWindow: \(\) => mainWindow,\s*captures: \(\) => liveCaptures\(\),\s*exports: \(\) =>\s*exporter === null \? null : \{ live: exporter\.live, running: exporter\.running\(\)\.length \},\s*resources: \(\) => process\.getActiveResourcesInfo\(\),\s*\}\)/,
    )
  })

  it('sends the late lines to main.log itself, in the folder the log files are in', () => {
    const opened = index.indexOf('logFiles = { main, engine }')
    expect(opened).toBeGreaterThan(-1)
    expect(index.indexOf('lateQuitLog = lateLog(main.path, QUIT_TAG)', opened)).toBeGreaterThan(
      opened,
    )
    expect(index).toContain('  late: (lines) => lateQuitLog?.append(lines),')
  })

  it('says will-quit as it is entered, opens the late log, and turns to it before the files are closed', () => {
    const entered = index.indexOf("app.on('will-quit', (event) => {")
    const again = index.indexOf("quitTrail.say('will-quit again: let through", entered)
    const held = index.indexOf('quitTrail.say("will-quit: held while', entered)
    const lateOpened = index.indexOf('lateQuitLog?.open()', held)
    const waited = index.indexOf('void within(windowKept, LOG_WAIT_MS)', lateOpened)
    const place = index.indexOf("quitTrail.say(`the window's place: ${place}`)", waited)
    const closing = index.indexOf("quitTrail.say('closing the log files;", place)
    const turned = index.indexOf('quitTrail.filesClosing()', closing)
    const closed = index.indexOf('files.main.close()', turned)
    for (const at of [entered, again, held, lateOpened, waited, place, closing, turned, closed])
      expect(at).toBeGreaterThan(-1)
    expect(
      [entered, again, held, lateOpened, waited, place, closing, turned, closed],
      'in that order',
    ).toEqual(
      [entered, again, held, lateOpened, waited, place, closing, turned, closed].sort(
        (a, b) => a - b,
      ),
    )
    expect(index.match(/quitTrail\.filesClosing\(\)/g)).toHaveLength(1)
  })

  it('still ends will-quit by asking the guard to quit, whatever the trail said', () => {
    expect(index).toMatch(
      /\.finally\(\(\) => \{\n\s*if \(closed !== null\) quitTrail\.say\(`the log files \$\{closed\}`\)\n\s*quitGuard\.quit\(\)\n\s*\}\)/,
    )
    // The two bounded waits, as they were.
    expect(index).toContain('void within(windowKept, LOG_WAIT_MS)')
    expect(index).toContain('return within(closing, LOG_WAIT_MS)')
    expect(index).toContain(
      'const closing = Promise.all([files.main.close(), files.engine.close()])',
    )
  })

  it('says the window closed, every window gone, and Electron’s own quit', () => {
    expect(index).toMatch(
      /window\.on\('closed', \(\) => \{\n\s*quitTrail\.say\(\n?\s*mainWindow === window \? 'the window is closed' : 'a window the app no longer held is closed',?\n?\s*\)\n\s*if \(mainWindow !== window\) return/,
    )
    expect(index).toMatch(
      /app\.on\('window-all-closed', \(\) => \{\n(?:\s*\/\/[^\n]*\n)*\s*quitTrail\.say\(\n\s*quit\.quitting\n\s*\? 'window-all-closed, with a quit under way: Electron is not quitting'\n\s*: 'window-all-closed',\n\s*\)\n\s*if \(process\.platform !== 'darwin'\) quitGuard\.quit\(\)/,
    )
    expect(index).toContain(
      "app.on('quit', () => quitTrail.say('quit: Electron is ending the process'))",
    )
  })

  it('says a window reported unresponsive, and a renderer gone, only during a quit', () => {
    expect(index).toMatch(
      /window\.on\('unresponsive', \(\) => \{\n\s*if \(quit\.quitting\) quitTrail\.say\('the window is reported unresponsive'\)\n\s*\}\)/,
    )
    expect(index).toMatch(
      /window\.webContents\.on\('render-process-gone', \(_event, details\) => \{\n\s*if \(quit\.quitting\) quitTrail\.say\(`the window's renderer is gone \(\$\{details\.reason\}\)`\)\n\s*\}\)/,
    )
  })
})
