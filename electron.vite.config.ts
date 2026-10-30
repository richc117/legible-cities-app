import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { figuiGuard } from './scripts/figui-guard'
import { buildCommit, releaseLabel } from './scripts/release.mjs'

// The renderer is never loaded from the dev server's own URL: the main
// process proxies it through app://local so the origin is the same in
// development and in a packaged build (spec FR-009, research.md section 1).
// The HMR client therefore has to be told where its socket lives, because it
// derives the host from import.meta.url of /@vite/client, which under the
// proxy is app://local (research.md section 2). strictPort keeps the URL
// electron-vite exports in step with this configuration.
const DEV_PORT = 5173

// The version the app reports (issue 558): a release tag's own, so a
// candidate says `1.0.0-rc.2`, and anything else package.json's with the
// commit, `1.0.0+abc1234`. build.yml names the ref built in
// LEGIBLE_RELEASE_REF; a tag for another version than package.json's
// throws here and fails the build. The main process reads it as
// __RELEASE_LABEL__, in place of app.getVersion(), which stays X.Y.Z.
const RELEASE_LABEL = releaseLabel(
  (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version,
  process.env.LEGIBLE_RELEASE_REF,
  buildCommit(process.env, resolve('.')),
)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __RELEASE_LABEL__: JSON.stringify(RELEASE_LABEL) },
    build: {
      rollupOptions: {
        // Two entries: the app, and the capture on its own, which the
        // end-to-end harness (tests/e2e/capture-harness.cjs) loads into a
        // bare Electron so the real window and debugger are exercised
        // without a test hook in the app itself.
        input: {
          index: resolve('src/main/index.ts'),
          capture: resolve('src/main/capture-window.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    // The guard refuses FigUI3's PolyForm-licensed half (ADR-026).
    plugins: [figuiGuard(), react()],
    server: {
      host: 'localhost',
      port: DEV_PORT,
      strictPort: true,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        clientPort: DEV_PORT,
      },
    },
  },
})
