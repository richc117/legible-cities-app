// The application scheme, registered before the app is ready and exactly
// once per process. Its own module because two entry points need it: the
// app (src/main/index.ts) and the capture harness the end-to-end tests
// launch (tests/e2e/capture-harness.cjs), which loads the capture entry
// without the rest of the app.

import { protocol } from 'electron'

/** A standard, secure origin that supports fetch and streamed bodies (specs/001, research.md section 1). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}
