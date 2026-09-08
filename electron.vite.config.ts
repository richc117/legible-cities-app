import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { figuiGuard } from './scripts/figui-guard'

// The renderer is never loaded from the dev server's own URL: the main
// process proxies it through app://local so the origin is the same in
// development and in a packaged build (spec FR-009, research.md section 1).
// The HMR client therefore has to be told where its socket lives, because it
// derives the host from import.meta.url of /@vite/client, which under the
// proxy is app://local (research.md section 2). strictPort keeps the URL
// electron-vite exports in step with this configuration.
const DEV_PORT = 5173

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
