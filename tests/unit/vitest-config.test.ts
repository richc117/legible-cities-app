// The browser project's dependency settings (issue 654). CI always starts
// with an empty Vite cache, so nothing there would notice `force` going; the
// JSX runtime's going CI would notice, and this names why it is there.

import { describe, expect, it } from 'vitest'
import config from '../../vitest.config'

type Project = { test?: { name?: string }; optimizeDeps?: { force?: boolean; include?: string[] } }

const projects = (config.test?.projects ?? []) as Project[]
const browser = projects.find((project) => project.test?.name === 'browser')

describe('vitest.config.ts, the browser project', () => {
  it('is found by its name', () => {
    expect(browser).toBeDefined()
  })
  it('bundles its dependencies on every start, so a cache from an earlier run cannot make it reload mid-run', () => {
    // Without `force`, a browser test importing a package the kept cache
    // lacks bundles it late and the page reloads under every browser file.
    expect(browser?.optimizeDeps?.force).toBe(true)
  })
  it('lists the JSX runtime the scan cannot see', () => {
    // No file imports it, the transform adds it, and found late it fails
    // every browser file even on an empty cache.
    expect(browser?.optimizeDeps?.include).toContain('react/jsx-dev-runtime')
  })
})
