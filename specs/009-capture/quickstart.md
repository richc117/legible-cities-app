# Quickstart: the capture

```
npm run build                                   # both main entries
npx vitest run tests/unit/capture.test.ts       # the order, without Electron
npx playwright test tests/e2e/capture.spec.ts   # the real window; the Los Angeles page too, with a checkout
LEGIBLE_CRASH_TEST=1 npx vitest run tests/unit/capture-crash.test.ts   # once, after an Electron upgrade
```

From the main process, once the app is ready:

```ts
import { capture } from './capture-window'

const result = await capture(
  {
    url: 'app://local/projects/<id>/<key>.html?present=1&view=map&labels=1&clock=1&theme=dark',
    width: 540, height: 960, scale: 2, fps: 30, settle: 1200,
    beats: [{ secs: 2, view: 'map', at: 8 * 3600, speed: 120, tween: 0 }],
  },
  { frames: '/absolute/path/frames', signal, onProgress: (done, total) => {} },
)
```

The frames directory is yours when the promise resolves; it is gone when
it rejects. Never open DevTools on the capture window.
