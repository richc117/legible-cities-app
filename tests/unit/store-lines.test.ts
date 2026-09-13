// The end-to-end suite's reading of the app's logs (issue 93): the lines a
// failed wait for a record appends, and the ones the teardown prints.

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logFolders, logLines, RETRY_LINES, STORE_LINES } from '../support/store-lines'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legible-cities-store-lines-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('logLines', () => {
  it('reads the rotated file first, and keeps only matching lines stamped since the launch', async () => {
    await writeFile(
      join(dir, 'main.old.log'),
      '2026-09-12T10:00:00.000Z [projects] warning: projects/a: write failed (EPERM, 8 attempts)\n',
    )
    await writeFile(
      join(dir, 'main.log'),
      [
        '2026-09-12T11:00:00.000Z [config] home somewhere',
        '2026-09-12T11:00:01.000Z [projects] warning: projects/b: saved after 3 attempts (EBUSY)',
        '2026-09-12T11:00:02.000Z [settings] warning: settings: write failed (EXDEV, 1 attempt)',
        '2026-09-12T11:00:03.000Z [settings] folder chosen',
        "2026-09-12T11:00:04.000Z [settings] warning: could not make the log folder: EACCES: permission denied, mkdir 'somewhere'",
        "2026-09-12T11:00:05.000Z [engine] write failed (see 'somewhere'), saved after 2 attempts",
        '',
      ].join('\n'),
    )
    expect(logLines(dir, STORE_LINES)).toHaveLength(3)
    expect(logLines(dir, STORE_LINES, new Date('2026-09-12T11:00:00.000Z'))).toEqual([
      '2026-09-12T11:00:01.000Z [projects] warning: projects/b: saved after 3 attempts (EBUSY)',
      '2026-09-12T11:00:02.000Z [settings] warning: settings: write failed (EXDEV, 1 attempt)',
    ])
    expect(logLines(dir, RETRY_LINES)[0]).toContain('projects/a: write failed (EPERM, 8 attempts)')
    expect(logLines(dir, RETRY_LINES)).toHaveLength(3)
  })

  it.skipIf(process.platform === 'win32')(
    'never follows a link planted under a log file’s name',
    async () => {
      const away = await mkdtemp(join(tmpdir(), 'legible-cities-store-lines-away-'))
      try {
        await writeFile(
          join(away, 'secret.log'),
          '2026-09-12T11:00:00.000Z [projects] warning: projects/z: write failed (EPERM, 8 attempts)\n',
        )
        await symlink(join(away, 'secret.log'), join(dir, 'main.log'))
        expect(logLines(dir, RETRY_LINES)).toEqual([])
      } finally {
        await rm(away, { recursive: true, force: true })
      }
    },
  )

  it('answers nothing for a folder that is not there', () => {
    expect(logLines(join(dir, 'nope'), STORE_LINES)).toEqual([])
  })
})

describe('logFolders', () => {
  it.skipIf(process.platform === 'win32')(
    'finds a profile’s logs within three levels, and never through a link',
    async () => {
      await mkdir(join(dir, 'profile', 'logs'), { recursive: true })
      await mkdir(join(dir, 'a', 'b', 'c', 'logs'), { recursive: true })
      const elsewhere = await mkdtemp(join(tmpdir(), 'legible-cities-store-lines-away-'))
      await mkdir(join(elsewhere, 'logs'))
      await symlink(elsewhere, join(dir, 'linked'))
      try {
        expect(logFolders(dir)).toEqual([join(dir, 'profile', 'logs')])
      } finally {
        await rm(elsewhere, { recursive: true, force: true })
      }
    },
  )
})
