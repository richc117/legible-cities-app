// The rotating log file (A6-03): a line stamped and appended, a file that
// never passes its cap, never more than two files per log, the last line
// before a close on disk, and a folder that cannot be written costing the
// file and never the caller.

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOG_CAP, openLogFile } from '../../src/main/log-file'

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
