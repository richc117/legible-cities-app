# Contract: the viewer

## The frame

```html
<iframe
  sandbox="allow-scripts"
  src="app://local/projects/<id>/<feed>.html?present=1&controls=1&theme=<theme>"
  title="…"
></iframe>
```

`allow-scripts` and nothing else, ever. Adding `allow-same-origin` beside it
restores the page's origin and reopens everything ADR-028 closed; a frame
holding both can even remove its own sandbox attribute. A test asserts the
attribute's exact value, and the renderer's rules name the forbidden flag.

The theme rides on the address. Nothing restyles the page from outside.

## Driving it

The interface asks; the privileged process reaches in. The bridge gains one
object:

```ts
interface ViewerApi {
  /** Hold the frame showing this project. Answers false if it is not there. */
  attach(projectId: string): Promise<boolean>
  /** Let it go: the project was closed, or the viewer replaced. */
  release(): Promise<void>
  /** One of the page's own methods, with its arguments. */
  call<M extends ViewerMethod>(method: M, ...args: ViewerArgs<M>): Promise<unknown>
}
```

The methods, which are the page's and not the app's:

| Method       | Arguments                             | Answers                           |
| ------------ | ------------------------------------- | --------------------------------- |
| `showView`   | a view's name, optionally a duration  | nothing                           |
| `setLabels`  | on or off                             | nothing                           |
| `setRoutes`  | the lines to keep, or nothing for all | nothing                           |
| `seek`       | a time in seconds                     | nothing                           |
| `setSpeed`   | a multiplier                          | nothing                           |
| `setPlaying` | on or off                             | nothing                           |
| `hasGeo`     | none                                  | whether the project has geography |
| `bounds`     | none                                  | the first and last second         |
| `state`      | none                                  | what the page is showing          |

Anything else is refused before a character is injected. The list is the
app's copy of the page's, and a test against the real page asserts the page
still has every one of them.

## What the privileged process guarantees

- It injects into a frame it is holding, never one found by address at the moment of use, and never the interface's own frame. A held frame that has gone is a refusal, not a fallback.
- What is held is the **frame**, not the document in it. A page may navigate itself, which is allowed and which the sandbox follows: every document loaded there is opaque-origin, so the boundary does not move. The app would then be driving a different document in the same frame, which is why the page is asked what it is showing rather than assumed.
- It builds the injected text itself: a fixed dispatcher, the method's name checked against the list, and the arguments as data. Nothing a caller sends becomes code.
- It answers with what the page returned, as data. A page that throws becomes a sentence.
- It holds one frame at a time, for one window.

## What the page can do, and what it cannot

It can run its own scripts, draw, animate and respond to its own controls.
It can send a message outward, which nothing listens for.

It cannot read the interface's document or any object the interface holds;
cannot read or call the bridge; cannot navigate the window by assigning its
address, replacing it, targeting a link at it, or opening a window; and
cannot open a window at all, because the window refuses.

## The policy generated pages are served with

Written fresh, not the interface's. The interface's forbids being framed,
which would block the viewer outright.

| Directive         | Value             | Why                                                                    |
| ----------------- | ----------------- | ---------------------------------------------------------------------- |
| `default-src`     | `'none'`          | the page is one file and asks for nothing                              |
| `script-src`      | `'unsafe-inline'` | it is deliberately self-contained; this is a second line, not the line |
| `style-src`       | `'unsafe-inline'` | the same                                                               |
| `img-src`         | `data:`           | the page's icons are inline                                            |
| `frame-ancestors` | `'self'`          | the interface may frame it; nothing else may                           |

`'self'` inside the frame matches nothing, because the frame's origin is
opaque. That is harmless while the page is one file, and it is the thing to
remember the day the engine emits a sibling asset.
