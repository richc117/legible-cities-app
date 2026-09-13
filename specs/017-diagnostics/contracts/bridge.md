# Contract: the bridge gains one method

## `api.clipboard.write(text)`

```ts
clipboard: {
  /** Put plain text on the system clipboard. Resolves when it is there. */
  write(text: string): Promise<void>
}
```

Channel `clipboard:write`. The main side refuses a caller that is not the
interface's top frame, anything that is not a string, and text whose
UTF-8 is longer than 64 KiB (bytes, not code units); it writes with Electron's own `clipboard.writeText` and
answers nothing. Nothing is read back: the page may put text on the
clipboard, never take it off, so a project page that somehow reached the
bridge could not read what a person had copied from elsewhere.

The page could not do this for itself. `navigator.clipboard.writeText`
is a permission in Chromium, and the app answers every permission request
and check with `false` (`src/main/index.ts`), deliberately: the viewer's
page shares the interface's session and must not be able to ask for
anything.

The only caller is the diagnostics panel's "Copy as text", which sends
what the panel shows: the project's name, the day, the figures, the
engine's caveat sentences and the issues score.
