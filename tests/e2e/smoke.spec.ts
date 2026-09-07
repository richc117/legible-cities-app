// The one end-to-end check: launch the built app, find the window, read the
// Library, prove the origin, quit, and see the process end. Runs on the
// three runners; on Linux under xvfb-run (research.md section 3).

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, test } from '@playwright/test'

const repoRoot = resolve(__dirname, '../..')

test('opens to an empty Library on the app://local origin, and quits', async () => {
  // A fresh engine home, so the test never touches the developer's data,
  // with one project page to serve.
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-e2e-'))
  mkdirSync(join(home, 'out', 'p1'), { recursive: true })
  writeFileSync(join(home, 'out', 'p1', 'index.html'), '<!doctype html><title>p1</title>')
  // A file outside the project, and a symbolic link to it from inside: the
  // handler must refuse the link. Symlink creation can be refused on a
  // locked-down Windows account, in which case that one probe is skipped.
  writeFileSync(join(home, 'secret.txt'), 'outside')
  let linked = true
  try {
    symlinkSync(join(home, 'secret.txt'), join(home, 'out', 'p1', 'link.txt'), 'file')
  } catch {
    linked = false
  }

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, SCHEMATIC_HOME: home },
    timeout: 30_000,
  })
  // Taken now: the application object is disposed by close().
  const child = app.process()
  try {
    const window = await app.firstWindow()
    // Two titles: the page's, which toHaveTitle reads, and the window's,
    // which is the contract (FR-003) and which the main process owns.
    await expect(window).toHaveTitle('Legible Cities')
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Legible Cities')
    await expect(window.getByRole('heading', { level: 1 })).toHaveText('Library')
    await expect(window.getByRole('status')).toContainText(/no projects/i)

    // The origin, and the refusals, from inside the page (User Story 2).
    expect(
      await window.evaluate(
        () => (globalThis as unknown as { location: { origin: string } }).location.origin,
      ),
    ).toBe('app://local')
    const probe = (path: string): Promise<{ status: number; body: string; type: string | null }> =>
      window.evaluate(async (p) => {
        const r = await fetch(p)
        return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }
      }, path)

    const ok = await probe('/projects/p1/index.html')
    expect(ok.status).toBe(200)
    expect(ok.type).toMatch(/^text\/html/)

    // A dot-dot the browser normalises away never reaches the project: 404.
    const normalised = await probe('/projects/p1/%2e%2e/%2e%2e/x')
    expect(normalised.status).toBe(404)
    expect(normalised.body).not.toContain('/')
    // Escapes that survive normalisation are refused by the handler: 403.
    for (const path of ['/projects/p1/..%2fsecret.txt', '/projects/p1/..%5csecret.txt']) {
      const escape = await probe(path)
      expect(escape.status, path).toBe(403)
      expect(escape.body).not.toContain('/')
    }
    if (linked) {
      const viaLink = await probe('/projects/p1/link.txt')
      expect(viaLink.status).toBe(403)
      expect(viaLink.body).not.toContain('outside')
    }
    const missing = await probe('/projects/nope/a.html')
    expect(missing.status).toBe(404)
    expect(missing.body).not.toContain('/')
    const listing = await probe('/projects/p1/')
    expect(listing.status).toBe(404)

    // A second launch while the first runs must exit on its own and leave
    // the first with its one window (FR-035, the single-instance lock).
    const second = spawn(electronPath as unknown as string, ['.'], {
      cwd: repoRoot,
      env: { ...process.env, SCHEMATIC_HOME: home },
      stdio: 'ignore',
    })
    const secondExit = await new Promise<number | null>((done) => {
      const timer = setTimeout(() => {
        second.kill()
        done(null)
      }, 15_000)
      second.once('exit', (code) => {
        clearTimeout(timer)
        done(code)
      })
    })
    expect(secondExit, 'the second instance exits by itself').not.toBeNull()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

    // Nothing in the renderer reaches Node.
    expect(await window.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
      'undefined',
    )
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
})
