// The rotating log file (A6-03): a line stamped and appended, a file that
// never passes its cap, never more than two files per log, the last line
// before a close on disk, and a folder that cannot be written costing the
// file and never the caller.

import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOG_CAP, LOG_WAIT_MS, openLogFile, within } from '../../src/main/log-file'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'legible-cities-log-file-'))
  roots.push(root)
  return root
}

const clock = (): Date => new Date('2026-09-12T10:00:00.000Z')

describe('a log file', () => {
  it('is capped at 5 MB', () => {
    expect(LOG_CAP).toBe(5 * 1024 * 1024)
  })

  it('appends each line with an ISO timestamp, after what was already there', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'main.log'), 'from before\n')
    const file = openLogFile(dir, 'main', { now: clock })
    file.write('[config] one')
    file.write('[config] two')
    await file.close()
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toBe(
      'from before\n2026-09-12T10:00:00.000Z [config] one\n2026-09-12T10:00:00.000Z [config] two\n',
    )
  })

  it('leaves no file behind when nothing was logged', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'engine')
    await file.close()
    expect(await readdir(dir)).toEqual([])
  })

  it('rotates before a line would take it past the cap, and keeps exactly two files', async () => {
    const dir = await folder()
    // Each stamped line is 24 bytes of timestamp and space, 9 of text and a newline: 34.
    const file = openLogFile(dir, 'main', { now: clock, cap: 100 })
    for (let i = 0; i < 20; i += 1) file.write(`line ${String(i).padStart(4, '0')}`)
    await file.close()
    expect((await readdir(dir)).sort()).toEqual(['main.log', 'main.old.log'])
    for (const name of ['main.log', 'main.old.log']) {
      expect((await stat(join(dir, name))).size).toBeLessThanOrEqual(100)
    }
    // Two lines to a file: the newest two in the file, the two before them in the old one.
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toContain('line 0019')
    expect(await readFile(join(dir, 'main.old.log'), 'utf8')).toContain('line 0017')
    expect(await readFile(join(dir, 'main.old.log'), 'utf8')).not.toContain('line 0015')
  })

  it('counts what an existing file already holds against the cap', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'engine.log'), 'x'.repeat(90) + '\n')
    const file = openLogFile(dir, 'engine', { now: clock, cap: 100 })
    file.write('a line that does not fit')
    await file.close()
    expect(await readFile(join(dir, 'engine.old.log'), 'utf8')).toBe('x'.repeat(90) + '\n')
    expect(await readFile(join(dir, 'engine.log'), 'utf8')).toContain('a line that does not fit')
  })

  it('takes a line longer than the cap on its own rather than rotating forever', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'main', { now: clock, cap: 10 })
    file.write('much longer than ten bytes')
    file.write('and another')
    await file.close()
    expect(await readFile(join(dir, 'main.old.log'), 'utf8')).toContain('much longer')
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toContain('and another')
  })

  it('writes a burst in order, and has every line on disk once flushed', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'engine', { now: clock })
    for (let i = 0; i < 5000; i += 1) file.write(`[engine] stderr: ${i}`)
    await file.flush()
    const lines = (await readFile(join(dir, 'engine.log'), 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(5000)
    expect(lines[0]).toMatch(/ \[engine\] stderr: 0$/)
    expect(lines[4999]).toMatch(/ \[engine\] stderr: 4999$/)
    await file.close()
  })

  it('has the last line written before close on disk, and sends later ones to the fallback', async () => {
    const dir = await folder()
    const later: string[] = []
    const file = openLogFile(dir, 'engine', { now: clock, fallback: (l) => later.push(l) })
    file.write('[engine] ended on request (quit)')
    await file.close()
    file.write('[engine] after the close')
    expect(await readFile(join(dir, 'engine.log'), 'utf8')).toContain('ended on request (quit)')
    expect(later).toEqual(['2026-09-12T10:00:00.000Z [engine] after the close'])
  })

  it('never throws for a folder that cannot be written, and says so once', async () => {
    const dir = await folder()
    // A file where the folder should be: opening anything beneath it fails
    // on every platform, whoever runs the test.
    const blocked = join(dir, 'not-a-folder')
    await writeFile(blocked, '')
    const said: string[] = []
    const file = openLogFile(blocked, 'main', { now: clock, fallback: (l) => said.push(l) })
    expect(() => file.write('[config] first')).not.toThrow()
    await file.flush()
    file.write('[config] second')
    await file.close()
    const warnings = said.filter((l) => l.startsWith('[log] warning'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/main\.log could not be written/)
    expect(said).toContain('2026-09-12T10:00:00.000Z [config] first')
    expect(said).toContain('2026-09-12T10:00:00.000Z [config] second')
  })

  it('does not repeat a line the caller already mirrors to standard error', async () => {
    const dir = await folder()
    const blocked = join(dir, 'not-a-folder')
    await writeFile(blocked, '')
    const said: string[] = []
    const file = openLogFile(blocked, 'main', {
      now: clock,
      mirrored: true,
      fallback: (l) => said.push(l),
    })
    file.write('[config] first')
    await file.flush()
    file.write('[config] second')
    expect(said).toHaveLength(1)
    expect(said[0]).toMatch(/^\[log\] warning/)
  })
})

describe('a line with a URL in it', () => {
  it('reaches the file with its secrets taken out, and the fallback likewise', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'engine', { now: clock })
    file.write(
      '[engine] stderr: FeedError: https://someone:pw@example.org/g.zip?key=k1 could not be fetched',
    )
    await file.close()
    const written = await readFile(join(dir, 'engine.log'), 'utf8')
    expect(written).not.toContain('k1')
    expect(written).not.toContain(':pw@')
    expect(written).toContain(
      'https://<redacted>@example.org/g.zip?key=<redacted> could not be fetched',
    )

    const blocked = join(dir, 'not-a-folder')
    await writeFile(blocked, '')
    const said: string[] = []
    const failing = openLogFile(blocked, 'main', { now: clock, fallback: (l) => said.push(l) })
    failing.write('[feeds] https://example.org/g.zip?key=k1')
    await failing.close()
    expect(said.join('\n')).not.toContain('k1')
  })
})

describe('a rotation that cannot rename', () => {
  it('keeps appending, says so once, and renames at the next crossing of the cap', async () => {
    const dir = await folder()
    const said: string[] = []
    let refusals = 2
    const file = openLogFile(dir, 'engine', {
      now: clock,
      cap: 100,
      fallback: (l) => said.push(l),
      // Windows refuses a rename while another program holds the file open.
      rename: async (from, to) => {
        if (refusals > 0) {
          refusals -= 1
          throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
        }
        const { rename } = await import('node:fs/promises')
        await rename(from, to)
      },
    })
    // A stamped line is 34 bytes: two fit under the cap, and the third
    // crosses it and is refused.
    for (let i = 0; i < 3; i += 1) file.write(`line ${String(i).padStart(4, '0')}`)
    await file.flush()
    expect(await readdir(dir)).toEqual(['engine.log'])
    expect(await readFile(join(dir, 'engine.log'), 'utf8')).toContain('line 0002')
    expect(said).toEqual([expect.stringMatching(/engine\.log could not be rotated \(EBUSY\)/)])
    // Not retried before every line: the next one is appended with no rename asked.
    file.write('line 0003')
    await file.flush()
    expect(refusals, 'the second refusal is still unspent').toBe(1)
    // The next crossing asks again (refused), and the one after renames.
    for (let i = 4; i < 12; i += 1) file.write(`line ${String(i).padStart(4, '0')}`)
    await file.close()
    expect((await readdir(dir)).sort()).toEqual(['engine.log', 'engine.old.log'])
    expect(said.filter((l) => /could not be written/.test(l))).toEqual([])
    expect(said, 'said once').toHaveLength(1)
    const all =
      (await readFile(join(dir, 'engine.old.log'), 'utf8')) +
      (await readFile(join(dir, 'engine.log'), 'utf8'))
    expect(all).toContain('line 0011')
  })
})

describe('waiting on a log', () => {
  it('flushes the lines queued before the call, whatever keeps arriving after', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'engine', { now: clock })
    file.write('[engine] before the flush')
    // A steady stderr: a line on every turn of the loop, for as long as the test runs.
    let streaming = true
    const stream = (): void => {
      if (!streaming) return
      file.write('[engine] stderr: loom is still talking')
      setImmediate(stream)
    }
    stream()
    const flushed = file.flush().then(() => 'flushed')
    const timedOut = new Promise((resolve) => setTimeout(() => resolve('timed out'), 1_000))
    expect(await Promise.race([flushed, timedOut])).toBe('flushed')
    streaming = false
    expect(await readFile(join(dir, 'engine.log'), 'utf8')).toContain('before the flush')
    await file.close()
  })

  it('closes with the lines queued before the close on disk, while more arrive', async () => {
    const dir = await folder()
    const later: string[] = []
    const file = openLogFile(dir, 'engine', { now: clock, fallback: (l) => later.push(l) })
    for (let i = 0; i < 1000; i += 1) file.write(`[engine] stderr: ${i}`)
    const closing = file.close()
    file.write('[engine] after the close began')
    await closing
    const lines = (await readFile(join(dir, 'engine.log'), 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(1000)
    expect(later).toEqual(['2026-09-12T10:00:00.000Z [engine] after the close began'])
  })

  it('gives up on work that never finishes after the time it is given, and never rejects', async () => {
    expect(LOG_WAIT_MS).toBe(2_000)
    const started = Date.now()
    await within(new Promise(() => undefined), 50)
    expect(Date.now() - started).toBeGreaterThanOrEqual(40)
    await expect(within(Promise.reject(new Error('disk gone')), 50)).resolves.toBeUndefined()
  })
})

describe('where the file is opened', () => {
  it('uses the time a held line was logged, not the time it was written', async () => {
    const dir = await folder()
    const file = openLogFile(dir, 'main', { now: clock })
    file.write('[config] early', new Date('2026-09-12T09:59:58.000Z'))
    await file.close()
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toBe(
      '2026-09-12T09:59:58.000Z [config] early\n',
    )
  })

  it.skipIf(process.platform === 'win32')(
    'refuses to append through a symbolic link planted where the file goes',
    async () => {
      const dir = await folder()
      const target = join(dir, 'elsewhere.txt')
      await writeFile(target, 'not a log\n')
      await symlink(target, join(dir, 'main.log'))
      const said: string[] = []
      const file = openLogFile(dir, 'main', { now: clock, fallback: (l) => said.push(l) })
      file.write('[config] one')
      await file.close()
      expect(await readFile(target, 'utf8')).toBe('not a log\n')
      expect(said[0]).toMatch(/main\.log could not be written/)
    },
  )
})
