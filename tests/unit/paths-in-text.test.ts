// Paths taken out of an error's sentences by the folders the main process
// knows (issue 419): the pure rule over hints the engine writes, and the
// lookups that find each folder's other forms without the door ever waiting.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { homePattern } from '../../src/main/diagnostics-text'
import { knownRoots, withoutKnownPaths, type RootSources } from '../../src/main/paths-in-text'
import { QUOTED_CHAR, STARTS_ANEW } from '../../src/shared/engine'

// Every path below is assembled from pieces at run time, so no literal path
// of a user's shape is committed: bin/preflight refuses one, and the commit
// hook runs it.
const macHome = ['', 'Users', 'jane'].join('/')
const macEngineHome = [macHome, 'Library', 'Application Support', 'Legible Cities', 'engine'].join(
  '/',
)
const winHome = ['C:', 'Users', 'Jane Doe'].join('\\')
const winEngineHome = [winHome, 'AppData', 'Roaming', 'Legible Cities', 'engine'].join('\\')
/** As Python's `repr` writes a Windows path inside an `OSError`: every backslash doubled. */
const doubled = (path: string): string => path.replace(/\\/g, '\\\\')

describe('withoutKnownPaths', () => {
  it('takes a file under an engine home whose path has a space out of a hint, whole', () => {
    const roots = [macHome, macEngineHome]
    expect(
      withoutKnownPaths(`Permission denied: ${macEngineHome}/data/feeds/bart.zip`, roots, 'darwin'),
    ).toBe('Permission denied: a file')
    // Known, so it ends where the path does and the words after it stay.
    expect(
      withoutKnownPaths(`could not open ${macEngineHome}/data/x.zip for reading`, roots, 'darwin'),
    ).toBe('could not open a file for reading')
  })

  it('takes the same path out from inside the quotes Python prints an OSError with', () => {
    const said = `[Errno 2] No such file or directory: '${macEngineHome}/out/abc/bart.html'`
    expect(withoutKnownPaths(said, [macEngineHome], 'darwin')).toBe(
      "[Errno 2] No such file or directory: 'a file'",
    )
    const detail = `FileNotFoundError: ${said} (serve.py:412)`
    expect(withoutKnownPaths(detail, [macEngineHome], 'darwin')).toBe(
      "FileNotFoundError: [Errno 2] No such file or directory: 'a file' (serve.py:412)",
    )
  })

  it('takes out a Windows path under a user folder with a space, inside and outside quotes', () => {
    const roots = [winHome, winEngineHome]
    for (const [said, left] of [
      // The home itself, last in the sentence: nothing after the space says
      // the path goes on, so only the folder known whole takes it out.
      [`Access is denied: ${winHome}`, 'Access is denied: a file'],
      [`Access is denied: ${winHome}\\Desktop\\My Maps\\x.zip`, 'Access is denied: a file'],
      [`Access is denied: ${winEngineHome}\\data\\feeds\\bart.zip`, 'Access is denied: a file'],
      [
        `PermissionError: [WinError 5] Access is denied: '${doubled(winEngineHome)}\\\\data' (feeds.py:12)`,
        "PermissionError: [WinError 5] Access is denied: 'a file' (feeds.py:12)",
      ],
      [`open "${winHome}\\Documents\\x.zip" failed`, 'open "a file" failed'],
      // The other separator, and the case Windows ignores.
      [`at ${winHome.replace(/\\/g, '/')}/x.zip, twice`, 'at a file, twice'],
      [`at ${winHome.toLowerCase()}\\x.zip`, 'at a file'],
    ]) {
      const out = withoutKnownPaths(said, roots, 'win32')
      expect(out, said).toBe(left)
      expect(out, said).not.toMatch(/Jane|Doe|Users|AppData/i)
    }
  })

  it('takes out the home in the 8.3 short form a temporary folder is written in', () => {
    const short = ['C:', 'Users', 'JANEDO~1'].join('\\')
    expect(
      withoutKnownPaths(
        `in ${short}\\AppData\\Local\\Temp\\x for reading`,
        [winHome, short],
        'win32',
      ),
    ).toBe('in a file for reading')
  })

  it('takes out a known folder written percent-encoded, as in a file URL', () => {
    expect(
      withoutKnownPaths(`see file://${encodeURI(macEngineHome)}/x.html`, [macEngineHome], 'darwin'),
    ).toBe('see file://a file')
  })

  it('keeps the backstop for a path under no known folder with no space', () => {
    const roots = [macEngineHome]
    expect(withoutKnownPaths('could not open /var/x/y.zip: denied', roots, 'darwin')).toBe(
      'could not open a file: denied',
    )
    expect(withoutKnownPaths('FeedError: /x/y has no stops.txt', roots, 'darwin')).toBe(
      'FeedError: a file has no stops.txt',
    )
  })

  it('leaves a web address to the URL redaction, a host’s path that names a known folder included', () => {
    const roots = [macEngineHome, ['', 'srv', 'legible'].join('/')]
    for (const said of [
      'https://feeds.example.org/gtfs.zip?api_key=s3cret could not be fetched: HTTP Error 403: Forbidden',
      'fetched https://maps.example.org/srv/legible/feed.zip',
    ])
      expect(withoutKnownPaths(said, roots, 'linux')).toBe(said)
  })

  it('returns a sentence with no path in it whole', () => {
    const said = 'matched 114/114 stops on line A/C/E for LA / Metro; date is required: …'
    expect(withoutKnownPaths(said, [macHome, macEngineHome, winHome], 'win32')).toBe(said)
  })

  it('does not take a drive or a top-level folder for a known one', () => {
    expect(withoutKnownPaths('Error C: bad, data ok', ['C:\\', '/data'], 'win32')).toBe(
      'Error C: bad, data ok',
    )
  })

  it('takes a quoted path after a bare one as a path of its own', () => {
    const said = `moved ${macEngineHome}/a.zip '${macEngineHome}/b c.zip' back`
    expect(withoutKnownPaths(said, [macEngineHome], 'darwin')).toBe("moved a file 'a file' back")
  })

  it('changes nothing on a second pass', () => {
    const said = `Permission denied: ${winEngineHome}\\x.zip, and '${doubled(winHome)}'`
    const once = withoutKnownPaths(said, [winHome, winEngineHome], 'win32')
    expect(withoutKnownPaths(once, [winHome, winEngineHome], 'win32')).toBe(once)
  })
})

// The work is linear because every scan for the rest of a path, and for a
// quoted path's closing quote, ends where the next known folder could
// begin. That holds only while every form a folder's pattern can start on
// is a word that starts anew (`STARTS_ANEW`) and a quote before it ends a
// quoted path (`QUOTED_CHAR`); a form missing from either lets each folder
// in a line walk to the end of it.
describe('where a known folder can start', () => {
  const resources = ['', 'Applications', 'Legible Cities.app', 'Contents', 'Resources'].join('/')
  const encoded = (path: string, separator: string): string =>
    path
      .split(/[\\/]/)
      .map((part) => encodeURIComponent(part))
      .join(separator)
  const forms: [string, string, string][] = [
    [resources, 'darwin', resources],
    [resources, 'darwin', resources.replace(/\//g, '\\')],
    [resources, 'darwin', `/${resources}`],
    [resources, 'darwin', `\\${resources.replace(/\//g, '\\')}`],
    [resources, 'darwin', encoded(resources, '%2F')],
    [resources, 'darwin', encoded(resources, '%5C')],
    [resources, 'darwin', encoded(resources, '%2f')],
    [winHome, 'win32', winHome],
    [winHome, 'win32', winHome.replace(/\\/g, '/')],
    [winHome, 'win32', winHome.toLowerCase()],
    [winHome, 'win32', `C:${encoded(winHome.slice(2), '%5C')}`],
    [winHome, 'win32', encoded(winHome, '%5C')],
    [winHome, 'win32', ['C:', 'Users', 'JANEDO~1'].join('\\')],
    [winHome, 'win32', `\\\\?\\${winHome}`],
  ]
  const startsAnew = new RegExp(`^${STARTS_ANEW}`)
  const quotedChar = new RegExp(`^${QUOTED_CHAR}`)

  for (const [root, platform, form] of forms) {
    it(`is a word that starts anew, and ends a quoted path: ${form}`, () => {
      // A real form: the folder's own pattern matches it, from its first
      // character or, after a doubled separator, its second.
      const match = homePattern(root, platform)!.exec(form)
      expect(match, 'the folder’s pattern matches this form').not.toBeNull()
      const from = form.slice(match!.index)
      for (const word of [form, from]) {
        expect(startsAnew.test(word), word).toBe(true)
        for (const quote of ["'", '"']) expect(quotedChar.test(`${quote}${word}`), word).toBe(false)
      }
    })
  }

  it('makes a line full of them cost linear time', () => {
    // A line of the resources folder percent-encoded, bare and quoted: before
    // `%2F` ended a scan, each occurrence walked to the end of the line, and
    // eight times the line took about sixty-four times as long.
    for (const unit of [` ${encoded(resources, '%2F')}`, ` '${encoded(resources, '%2F')}`]) {
      const time = (bytes: number): number => {
        const line = unit.repeat(Math.ceil(bytes / unit.length))
        withoutKnownPaths(line, [resources], 'darwin')
        let least = Infinity
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now()
          withoutKnownPaths(line, [resources], 'darwin')
          least = Math.min(least, performance.now() - started)
        }
        return least
      }
      const small = time(32 * 1024)
      const large = time(8 * 32 * 1024)
      // Linear gives about 8 and quadratic about 64; both sides scale with
      // the machine's load, so the ratio does not.
      expect(large / small, unit).toBeLessThan(20)
    }
  }, 180_000)
})

describe('knownRoots', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A promise this test settles when it chooses, or never. */
  function deferred<T>(): {
    promise: Promise<T>
    resolve: (v: T) => void
    reject: (e: unknown) => void
  } {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  const MS = 2_000
  const engine = ['', 'srv', 'jane', 'engine'].join('/')
  const realEngine = ['', 'Volumes', 'Data', 'engine'].join('/')

  function harness(overrides: Partial<RootSources> = {}) {
    const asked: string[] = []
    const answers = new Map<string, ReturnType<typeof deferred<string>>>()
    let exportFolder = ['', 'srv', 'jane', 'Exports'].join('/')
    const homes = deferred<readonly string[]>()
    const roots = knownRoots({
      roots: () => [engine, exportFolder],
      realpath: (path) => {
        asked.push(path)
        const answer = deferred<string>()
        answers.set(path, answer)
        return answer.promise
      },
      homes: () => homes.promise,
      ms: MS,
      ...overrides,
    })
    return {
      roots,
      asked,
      answer: (path: string) => answers.get(path)!,
      homes,
      moveExport: (to: string) => {
        exportFolder = to
      },
    }
  }

  it('asks the disk nothing until the first error, then answers the folders as named at once', () => {
    vi.useFakeTimers()
    const h = harness()
    // The export folder is on the desktop by default, which macOS keeps
    // behind a privacy prompt: nothing is looked up at launch.
    expect(h.asked, 'nothing asked at launch').toEqual([])
    expect(h.roots()).toEqual([engine, ['', 'srv', 'jane', 'Exports'].join('/')])
    expect(h.asked, 'each folder asked once, at the first error').toEqual([
      engine,
      ['', 'srv', 'jane', 'Exports'].join('/'),
    ])
  })

  it('adds a folder’s real path and the home’s other forms once they answer in time', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.roots()
    h.answer(engine).resolve(realEngine)
    const short = ['C:', 'Users', 'JANEDO~1'].join('\\')
    h.homes.resolve([winHome, short])
    await vi.advanceTimersByTimeAsync(10)
    expect(h.roots()).toEqual(expect.arrayContaining([engine, realEngine, winHome, short]))
  })

  it('asks for the export folder at every call, so the one in force is the one used', async () => {
    vi.useFakeTimers()
    const h = harness()
    expect(h.roots(), 'the first error').toContain(['', 'srv', 'jane', 'Exports'].join('/'))
    const moved = ['', 'srv', 'jane', 'Elsewhere'].join('/')
    h.moveExport(moved)
    const now = h.roots()
    expect(now).toContain(moved)
    expect(now).not.toContain(['', 'srv', 'jane', 'Exports'].join('/'))
    expect(h.asked).toContain(moved)
  })

  it('abandons a lookup that lapses: the folder as named, the late answer ignored, never asked again', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.roots()
    await vi.advanceTimersByTimeAsync(MS + 1)
    h.answer(engine).resolve(realEngine)
    await vi.advanceTimersByTimeAsync(10)
    h.roots()
    h.roots()
    expect(h.roots()).not.toContain(realEngine)
    expect(
      h.asked.filter((path) => path === engine),
      'one question, however many errors',
    ).toHaveLength(1)
  })

  it('asks again at the next call about a folder whose lookup failed in time', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.roots()
    h.answer(engine).reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await vi.advanceTimersByTimeAsync(10)
    expect(h.roots()).toContain(engine)
    expect(h.asked.filter((path) => path === engine)).toHaveLength(2)
  })

  it('keeps the folders when the home lookup fails, or a lookup throws', async () => {
    vi.useFakeTimers()
    const h = harness({
      homes: () => Promise.reject(new Error('the home folder did not answer in time')),
      realpath: () => {
        throw new Error('no disk')
      },
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(h.roots()).toEqual([engine, ['', 'srv', 'jane', 'Exports'].join('/')])
  })
})
