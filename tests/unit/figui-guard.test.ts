// The build refuses FigUI3's PolyForm-licensed half, passes everything
// else, and keeps the core script's side effects so the custom elements
// are registered in the production bundle.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGE, figuiGuard, isCoreScript, refuses } from '../../scripts/figui-guard'

const root = resolve(__dirname, '../..')

const context = { resolve: async (source: string) => ({ id: `/node_modules/${source}` }) }

describe('figuiGuard', () => {
  it('refuses the editor and lab bundles in every spelling', () => {
    for (const id of [
      '@rogieking/figui3/fig-editor.js',
      '@rogieking/figui3/fig-editor.css',
      '@rogieking/figui3/fig-lab.js',
      '@rogieking/figui3/dist/fig-editor.js',
      '@rogieking/figui3/src/fig-lab.css',
      '/abs/node_modules/@rogieking/figui3/dist/fig-editor.js',
    ]) {
      expect(refuses(id), id).toBe(true)
      expect(() => figuiGuard().resolveId.call(context, id)).toThrow(MESSAGE)
      expect(() => figuiGuard().load(id)).toThrow(MESSAGE)
    }
  })
  it('is registered for the renderer, and the kit is a build-time dependency', () => {
    // Registered: the plugin only guards a build it is part of.
    const config = readFileSync(resolve(root, 'electron.vite.config.ts'), 'utf8')
    const renderer = config.slice(config.indexOf('renderer:'))
    expect(renderer).toMatch(/plugins:\s*\[figuiGuard\(\)/)
    // Build-time: the renderer bundle inlines the kit, and the packager
    // copies every production dependency whole, PolyForm half included.
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@rogieking/figui3']).toBeUndefined()
    expect(pkg.devDependencies?.['@rogieking/figui3']).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('passes everything else untouched', () => {
    for (const id of [
      '@rogieking/figui3/fig.css',
      '@rogieking/figui3',
      'react',
      './styles/figui-adapter.css',
    ]) {
      expect(refuses(id), id).toBe(false)
      expect(isCoreScript(id), id).toBe(false)
      expect(figuiGuard().resolveId.call(context, id)).toBeNull()
    }
  })
  it('keeps the core script as a side effect wherever it resolves', async () => {
    for (const id of [
      '@rogieking/figui3/fig.js',
      '@rogieking/figui3/dist/fig.js',
      '/x/node_modules/@rogieking/figui3/src/fig.js',
    ]) {
      expect(isCoreScript(id), id).toBe(true)
      await expect(figuiGuard().resolveId.call(context, id)).resolves.toEqual({
        id: `/node_modules/${id}`,
        moduleSideEffects: true,
      })
    }
    const unresolved = { resolve: async () => null }
    await expect(
      figuiGuard().resolveId.call(unresolved, '@rogieking/figui3/fig.js'),
    ).resolves.toBeNull()
  })
})
