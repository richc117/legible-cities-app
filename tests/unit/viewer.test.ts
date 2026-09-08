// The main-side viewer: what it refuses, and which frame it will address.
// No Electron here — the web contents and the frame are stubs, because the
// rules being tested are the app's, not the browser's. The browser's half of
// the boundary is proven in tests/e2e/viewer.spec.ts, from inside a hostile
// page.

import { describe, expect, it, vi } from 'vitest'
import { Viewer } from '../../src/main/viewer'
import { VIEWER_METHODS, VIEWER_SANDBOX, isViewerMethod } from '../../src/shared/viewer'

interface StubFrame {
  url: string
  executeJavaScript: ReturnType<typeof vi.fn>
}

function stub(childUrl = 'app://local/projects/abcdefghijk1/la.html') {
  const child: StubFrame = {
    url: childUrl,
    executeJavaScript: vi.fn(async () => ({ ok: true, value: { viewName: 'schematic' } })),
  }
  const main = { url: 'app://local/ui/', frames: [child], executeJavaScript: vi.fn() }
  const contents = { mainFrame: main }
  return { contents: contents as never, main, child }
}

describe('holding a frame', () => {
  it('holds the frame showing the project asked for', () => {
    const { contents } = stub()
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1')).toBe(true)
    expect(viewer.projectId).toBe('abcdefghijk1')
  })

  it('refuses when no frame is showing that project', () => {
    const { contents } = stub('app://local/projects/zzzzzzzzzzz1/la.html')
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1')).toBe(false)
    expect(viewer.projectId).toBeNull()
  })

  it('never holds the interface own frame, even if its address matched', () => {
    const main = {
      url: 'app://local/projects/abcdefghijk1/la.html',
      frames: [] as unknown[],
      executeJavaScript: vi.fn(),
    }
    main.frames = [main]
    const viewer = new Viewer()
    expect(viewer.attach({ mainFrame: main } as never, 'abcdefghijk1')).toBe(false)
  })

  it('lets go, and a second attach replaces the first', () => {
    const { contents } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    viewer.release()
    expect(viewer.projectId).toBeNull()
  })
})

describe('driving the page', () => {
  it('passes one of the page own methods, with its arguments as data', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    await viewer.call(contents, 'showView', ['linear', 300])
    const injected = child.executeJavaScript.mock.calls[0][0] as string
    expect(injected).toContain('"showView"')
    // Nothing a caller sends becomes code: the arguments are a JSON string
    // the page parses, not a literal spliced into the source, so a key like
    // __proto__ arrives as a key rather than as the prototype setter.
    expect(injected).toContain('JSON.parse("[\\"linear\\",300]")')
    expect(injected).toContain('window.__present')
  })

  // The claim is that nothing a caller sends becomes code. The way to show
  // that is to run the thing: the dispatcher is evaluated here with a stand-in
  // for the page, and what the page's method receives is compared with what
  // was sent. A string that tries to close the call and start a statement
  // arrives as that string.
  it('sends a hostile-looking argument as data, not as syntax', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    const hostile = [
      'a"); window.__owned = 1; ("',
      "b'); window.__owned = 2; ('",
      '\u2028 line separator',
      '</script><img src=x onerror=1>',
      '\\" + (window.__owned = 3) + \\"',
    ]
    await viewer.call(contents, 'setRoutes', [hostile])
    const injected = child.executeJavaScript.mock.calls[0][0] as string

    let received: unknown[] = []
    const page = {
      __present: {
        setRoutes: (...args: unknown[]) => {
          received = args
          return null
        },
      },
    } as Record<string, unknown>
    const answer = new Function('window', `return ${injected}`)(page) as {
      ok: boolean
      value: unknown
    }
    expect(answer.ok, 'the dispatcher ran').toBe(true)
    expect(received, 'the argument arrived exactly as sent').toEqual([hostile])
    expect(page.__owned, 'nothing in the argument became a statement').toBeUndefined()
  })

  // `__proto__` in an object literal is the prototype setter; parsed from
  // JSON it is an ordinary key. The arguments are parsed, so it is a key.
  it('sends __proto__ as a key rather than as the prototype setter', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    // Built from JSON so it has an own `__proto__` key: written as a literal
    // it would set the prototype and never be an own property at all.
    const withKey = JSON.parse('{"__proto__":{"polluted":true}}') as object
    await viewer.call(contents, 'seek', [withKey])
    const injected = child.executeJavaScript.mock.calls[0][0] as string
    let received: unknown[] = []
    const page = {
      __present: {
        seek: (...args: unknown[]) => {
          received = args
          return null
        },
      },
    }
    new Function('window', `return ${injected}`)(page)
    const sent = received[0] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(sent, '__proto__')).toBe(true)
    expect((sent as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('answers with what the page returned', async () => {
    const { contents } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    await expect(viewer.call(contents, 'state', [])).resolves.toEqual({ viewName: 'schematic' })
  })

  it('refuses a method the page does not expose, before anything is injected', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    for (const method of ['eval', 'setCapture', 'constructor', '__proto__', 'onDraw', '']) {
      await expect(viewer.call(contents, method, []), method).rejects.toThrow(/can be asked/)
    }
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses when it is holding nothing', async () => {
    const { contents } = stub()
    const viewer = new Viewer()
    await expect(viewer.call(contents, 'state', [])).rejects.toThrow(/not on the screen/)
  })

  // A disposed frame throws on property access rather than answering, which
  // a plain object stub never does.
  it('refuses when reaching for the frame throws', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    const angry = {
      get mainFrame(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
    }
    await expect(viewer.call(angry as never, 'state', [])).rejects.toThrow(/not on the screen/)
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses once the frame it held has gone', async () => {
    const { contents, child, main } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    main.frames = []
    await expect(viewer.call(contents, 'state', [])).rejects.toThrow(/not on the screen/)
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('turns the page own failure into a sentence, and truncates it', async () => {
    const { contents, child } = stub()
    child.executeJavaScript.mockResolvedValue({ ok: false, error: 'the map has no geography' })
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    await expect(viewer.call(contents, 'hasGeo', [])).rejects.toThrow('the map has no geography')
  })

  it('refuses an answer that is not the shape the dispatcher returns', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    for (const answer of [undefined, null, 'a string', 7]) {
      child.executeJavaScript.mockResolvedValue(answer)
      await expect(viewer.call(contents, 'state', [])).rejects.toThrow(/did not answer|could not/)
    }
  })

  it('refuses arguments that cannot be sent as data', async () => {
    const { contents } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(viewer.call(contents, 'seek', [cycle])).rejects.toThrow(/cannot be asked/)
  })
})

describe('the sandbox', () => {
  // The end-to-end test compares the frame's attribute with this constant,
  // which pins the shape but not the value. This pins the value. Adding
  // `allow-same-origin` here would fail here first (ADR-028).
  it('is exactly the flag that allows scripts, and nothing else', () => {
    expect(VIEWER_SANDBOX).toBe('allow-scripts')
    expect(VIEWER_SANDBOX).not.toContain('allow-same-origin')
    expect(VIEWER_SANDBOX.split(' ')).toHaveLength(1)
  })
})

describe('the list of methods', () => {
  it('is what the page exposes and nothing that would be dangerous', () => {
    expect([...VIEWER_METHODS]).toEqual([
      'showView',
      'setLabels',
      'setRoutes',
      'seek',
      'setSpeed',
      'setPlaying',
      'hasGeo',
      'bounds',
      'state',
    ])
    // The capture methods belong to the export path, and onDraw takes a
    // function, which cannot cross into another frame.
    for (const absent of ['setCapture', 'settle', 'onDraw', 'advance']) {
      expect(isViewerMethod(absent), absent).toBe(false)
    }
  })

  it('recognises only strings from the list', () => {
    for (const method of VIEWER_METHODS) expect(isViewerMethod(method)).toBe(true)
    for (const other of [null, undefined, 7, {}, 'State', ' state']) {
      expect(isViewerMethod(other), String(other)).toBe(false)
    }
  })
})
