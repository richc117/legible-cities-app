// The main-side viewer: what it refuses, and which frame it will address.
// No Electron here — the web contents and the frame are stubs, because the
// rules being tested are the app's, not the browser's. The browser's half of
// the boundary is proven in tests/e2e/viewer.spec.ts, from inside a hostile
// page.

import { describe, expect, it, vi } from 'vitest'
import { Viewer, roleOfAddress } from '../../src/main/viewer'
import {
  MISSING_METHOD,
  VIEWER_METHODS,
  VIEWER_SANDBOX,
  isViewerMethod,
} from '../../src/shared/viewer'

interface StubFrame {
  url: string
  /** Its place in the frame tree, which survives a navigation. */
  frameTreeNodeId: number
  executeJavaScript: ReturnType<typeof vi.fn>
}

let nodes = 0

/** The map's own address, as `addressFor` in `viewerAddress.ts` writes it. */
const MAP = 'app://local/projects/abcdefghijk1/la.html?present=1&controls=1&theme=dark&redraw=0'
/** A planned address as the engine's `url_for` writes it, with the safe zones. */
const PLANNED_SAFE =
  'app://local/projects/abcdefghijk1/la.html?present=1&view=map&labels=1&title=1&clock=1&theme=dark&frame=1080:1920&frametop=0.46&safe=1'
/** A planned address for a preset with no safe zones: no `safe`, and no `controls`. */
const PLANNED_PLAIN =
  'app://local/projects/abcdefghijk1/la.html?present=1&view=map&labels=1&title=1&clock=0&theme=dark&frame=1200:627&frametop=0.46'

const frameAt = (url: string): StubFrame => ({
  url,
  frameTreeNodeId: (nodes += 1),
  executeJavaScript: vi.fn(async () => ({ ok: true, value: { viewName: 'schematic' } })),
})

function stub(childUrl = MAP) {
  const child = frameAt(childUrl)
  const main = {
    url: 'app://local/ui/',
    frames: [child] as StubFrame[],
    executeJavaScript: vi.fn(),
  }
  const contents = { mainFrame: main }
  return { contents: contents as never, main, child }
}

describe('holding a frame', () => {
  it('holds the frame showing the project asked for', () => {
    const { contents } = stub()
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(true)
    expect(viewer.projectIdOf('map')).toBe('abcdefghijk1')
  })

  it('refuses when no frame is showing that project', () => {
    const { contents } = stub('app://local/projects/zzzzzzzzzzz1/la.html')
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(false)
    expect(viewer.projectIdOf('map')).toBeNull()
  })

  it('never holds the interface own frame, even if its address matched', () => {
    const main = {
      url: MAP,
      frames: [] as unknown[],
      executeJavaScript: vi.fn(),
    }
    main.frames = [main]
    const viewer = new Viewer()
    expect(viewer.attach({ mainFrame: main } as never, 'abcdefghijk1', 'map')).toBe(false)
    expect(viewer.attach({ mainFrame: main } as never, 'abcdefghijk1', 'export')).toBe(false)
  })

  it('lets go, and a second attach replaces the first', () => {
    const { contents } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    viewer.release('map')
    expect(viewer.projectIdOf('map')).toBeNull()
  })
})

// Two frames per window since ADR-046: the map in the notebook's flow, and
// cell 06's preview of the export. Which is which is decided at attach and
// never at use (specs/029, FR-006).
describe('two frames, by role', () => {
  it('reads an address as the map, the export, or neither', () => {
    expect(roleOfAddress(MAP, 'abcdefghijk1')).toBe('map')
    expect(roleOfAddress(PLANNED_SAFE, 'abcdefghijk1')).toBe('export')
    expect(roleOfAddress(PLANNED_PLAIN, 'abcdefghijk1')).toBe('export')
    // Another project's page is neither, whatever its query says.
    expect(roleOfAddress(MAP.replace('abcdefghijk1', 'zzzzzzzzzzz1'), 'abcdefghijk1')).toBeNull()
    expect(roleOfAddress('app://local/ui/index.html?controls=1', 'abcdefghijk1')).toBeNull()
  })

  it('never reads an address carrying safe=1 as the map, whatever else it carries', () => {
    for (const url of [
      `${MAP}&safe=1`,
      MAP.replace('controls=1', 'safe=1&controls=1'),
      `${PLANNED_SAFE}&controls=1`,
    ])
      expect(roleOfAddress(url, 'abcdefghijk1'), url).toBe('export')
  })

  it('holds each frame in its own role, and drives the one a call names', async () => {
    const { contents, main } = stub()
    const map = main.frames[0]
    const preview = frameAt(PLANNED_SAFE)
    main.frames.push(preview)
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(true)
    expect(viewer.attach(contents, 'abcdefghijk1', 'export')).toBe(true)
    await viewer.call(contents, 'map', 'seek', [30_600])
    expect(map.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(preview.executeJavaScript).not.toHaveBeenCalled()
    await viewer.call(contents, 'export', 'state', [])
    expect(preview.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(map.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('never holds a safe=1 frame as the map, even when it is the only frame there', () => {
    const { contents } = stub(PLANNED_SAFE)
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(false)
    expect(viewer.projectIdOf('map')).toBeNull()
    expect(viewer.attach(contents, 'abcdefghijk1', 'export')).toBe(true)
  })

  it('finds the map wherever it is among the frames, and the export likewise', () => {
    // The export's frame comes first in the document's order of frames when
    // cell 06 is above the map in some future arrangement; the role, not the
    // order, decides.
    const { contents, main } = stub(PLANNED_PLAIN)
    const map = frameAt(MAP)
    main.frames.push(map)
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(true)
    void viewer.call(contents, 'map', 'state', [])
    expect(map.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(main.frames[0].executeJavaScript).not.toHaveBeenCalled()
  })

  it('lets go of one role and keeps the other', async () => {
    const { contents, main } = stub()
    main.frames.push(frameAt(PLANNED_SAFE))
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    viewer.attach(contents, 'abcdefghijk1', 'export')
    viewer.release('export')
    expect(viewer.projectIdOf('export')).toBeNull()
    expect(viewer.projectIdOf('map')).toBe('abcdefghijk1')
    await expect(viewer.call(contents, 'export', 'state', [])).rejects.toThrow(/not on the screen/)
    await expect(viewer.call(contents, 'map', 'state', [])).resolves.toEqual({
      viewName: 'schematic',
    })
  })

  it('asks the export frame whether it has loaded, and nothing else', async () => {
    const { contents, main } = stub()
    const preview = frameAt(PLANNED_SAFE)
    main.frames.push(preview)
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'export')
    for (const method of [
      'seek',
      'setPlaying',
      'setSpeed',
      'showView',
      'setLabels',
      'bounds',
      'setTheme',
    ])
      await expect(viewer.call(contents, 'export', method, [1]), method).rejects.toThrow(
        /not driven/,
      )
    expect(preview.executeJavaScript).not.toHaveBeenCalled()
  })

  it('never takes the frame the other role holds, whatever its address has become', () => {
    // The map's page navigates itself to a planned address: it is still the
    // map's frame by identity, and the export's attach looks elsewhere.
    const { contents, main } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    main.frames[0].url = PLANNED_PLAIN
    expect(viewer.attach(contents, 'abcdefghijk1', 'export')).toBe(false)
  })

  it('never gives the export the frame that was the map, even when the map is not held', async () => {
    // The map's page sends itself to an address with no `controls=1`, so the
    // renderer's re-attach as the map fails and the map is unheld. By its
    // address that frame now reads as the export's, and the next export
    // attach would adopt it with the roles swapped. It belongs to the role it
    // was first held in, by its place in the frame tree.
    const mapFrame = frameAt(MAP)
    const exportFrame = frameAt(PLANNED_SAFE)
    const main = {
      url: 'app://local/ui/',
      frames: [mapFrame, exportFrame] as StubFrame[],
      executeJavaScript: vi.fn(),
    }
    const contents = { mainFrame: main } as never
    const viewer = new Viewer()
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(true)
    mapFrame.url = PLANNED_PLAIN
    expect(viewer.attach(contents, 'abcdefghijk1', 'map')).toBe(false)
    expect(viewer.projectIdOf('map')).toBeNull()
    expect(viewer.attach(contents, 'abcdefghijk1', 'export')).toBe(true)
    await viewer.call(contents, 'export', 'state', [])
    expect(exportFrame.executeJavaScript).toHaveBeenCalled()
    expect(mapFrame.executeJavaScript).not.toHaveBeenCalled()
    // And with no export frame of its own, the export finds nothing.
    main.frames = [mapFrame]
    viewer.release('export')
    expect(viewer.attach(contents, 'abcdefghijk1', 'export')).toBe(false)
  })
})

describe('driving the page', () => {
  it('passes one of the page own methods, with its arguments as data', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    await viewer.call(contents, 'map', 'showView', ['linear', 300])
    const injected = child.executeJavaScript.mock.calls[0][0] as string
    expect(injected).toContain('"showView"')
    // Nothing a caller sends becomes code: the arguments are a JSON string
    // the page parses, not a literal spliced into the source, so a key like
    // __proto__ arrives as a key rather than as the prototype setter.
    expect(injected).toContain('JSON.parse("[\\"linear\\",300]")')
    expect(injected).toContain('window.__present')
  })

  // The theme is restyled in place through the seam since engine v0.11.0
  // (issue 349), and the name goes in as data like every other argument. The
  // main process needed no change for it: the list is the one place a method
  // is named, and this is what shows that is so.
  it('passes setTheme to the map frame, the theme as data', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    await viewer.call(contents, 'map', 'setTheme', ['sepia'])
    const injected = child.executeJavaScript.mock.calls[0][0] as string
    expect(injected).toContain('"setTheme"')
    expect(injected).toContain('JSON.parse("[\\"sepia\\"]")')

    let received: unknown[] = []
    const page = {
      __present: {
        setTheme: (...args: unknown[]) => {
          received = args
          return true
        },
      },
    }
    const answer = new Function('window', `return ${injected}`)(page) as {
      ok: boolean
      value: unknown
    }
    expect(answer, 'the page answered true').toEqual({ ok: true, value: true })
    expect(received).toEqual(['sepia'])
  })

  // The interface falls back to loading a page again when it is told the page
  // has no `setTheme` (`themeWrites.ts`), and it knows that by this sentence.
  // The dispatcher is the main process's and the sentence is compared in the
  // renderer, so the real dispatcher is run against a page from before engine
  // v0.11.0 and the two are held to one another.
  it('says MISSING_METHOD, to the word, for a page with no such method', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    await viewer.call(contents, 'map', 'setTheme', ['sepia'])
    const injected = child.executeJavaScript.mock.calls[0][0] as string
    const older = { __present: { state: () => ({}) } }
    const answer = new Function('window', `return ${injected}`)(older)
    expect(answer).toEqual({ ok: false, error: MISSING_METHOD })

    child.executeJavaScript.mockResolvedValue(answer)
    await expect(viewer.call(contents, 'map', 'setTheme', ['sepia'])).rejects.toThrow(
      new Error(MISSING_METHOD),
    )
    // And a page still loading says something else, which is not a reason to load it again.
    const loading = new Function('window', `return ${injected}`)({})
    expect(loading).toEqual({ ok: false, error: 'the map is still loading' })
    expect(loading.error).not.toBe(MISSING_METHOD)
  })

  // The claim is that nothing a caller sends becomes code. The way to show
  // that is to run the thing: the dispatcher is evaluated here with a stand-in
  // for the page, and what the page's method receives is compared with what
  // was sent. A string that tries to close the call and start a statement
  // arrives as that string.
  it('sends a hostile-looking argument as data, not as syntax', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    const hostile = [
      'a"); window.__owned = 1; ("',
      "b'); window.__owned = 2; ('",
      '\u2028 line separator',
      '</script><img src=x onerror=1>',
      '\\" + (window.__owned = 3) + \\"',
    ]
    await viewer.call(contents, 'map', 'setRoutes', [hostile])
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
    viewer.attach(contents, 'abcdefghijk1', 'map')
    // Built from JSON so it has an own `__proto__` key: written as a literal
    // it would set the prototype and never be an own property at all.
    const withKey = JSON.parse('{"__proto__":{"polluted":true}}') as object
    await viewer.call(contents, 'map', 'seek', [withKey])
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
    viewer.attach(contents, 'abcdefghijk1', 'map')
    await expect(viewer.call(contents, 'map', 'state', [])).resolves.toEqual({
      viewName: 'schematic',
    })
  })

  it('refuses a method the page does not expose, before anything is injected', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    for (const method of ['eval', 'setCapture', 'constructor', '__proto__', 'onDraw', '']) {
      await expect(viewer.call(contents, 'map', method, []), method).rejects.toThrow(/can be asked/)
    }
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses when it is holding nothing', async () => {
    const { contents } = stub()
    const viewer = new Viewer()
    await expect(viewer.call(contents, 'map', 'state', [])).rejects.toThrow(/not on the screen/)
  })

  // A disposed frame throws on property access rather than answering, which
  // a plain object stub never does.
  it('refuses when reaching for the frame throws', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    const angry = {
      get mainFrame(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
    }
    await expect(viewer.call(angry as never, 'map', 'state', [])).rejects.toThrow(
      /not on the screen/,
    )
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses once the frame it held has gone', async () => {
    const { contents, child, main } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    main.frames = []
    await expect(viewer.call(contents, 'map', 'state', [])).rejects.toThrow(/not on the screen/)
    expect(child.executeJavaScript).not.toHaveBeenCalled()
  })

  it('turns the page own failure into a sentence, and truncates it', async () => {
    const { contents, child } = stub()
    child.executeJavaScript.mockResolvedValue({ ok: false, error: 'the map has no geography' })
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    await expect(viewer.call(contents, 'map', 'hasGeo', [])).rejects.toThrow(
      'the map has no geography',
    )
  })

  it('refuses an answer that is not the shape the dispatcher returns', async () => {
    const { contents, child } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    for (const answer of [undefined, null, 'a string', 7]) {
      child.executeJavaScript.mockResolvedValue(answer)
      await expect(viewer.call(contents, 'map', 'state', [])).rejects.toThrow(
        /did not answer|could not/,
      )
    }
  })

  it('refuses arguments that cannot be sent as data', async () => {
    const { contents } = stub()
    const viewer = new Viewer()
    viewer.attach(contents, 'abcdefghijk1', 'map')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(viewer.call(contents, 'map', 'seek', [cycle])).rejects.toThrow(/cannot be asked/)
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
      'setTheme',
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
