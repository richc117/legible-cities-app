// The paths the app's own dialogs answered. The page never chooses one: a
// path reaches the main process only if a dialog the main process opened
// handed it out, and each is good for one use. A2-01 built this for the
// feeds' zip; A1-04 uses it for the two folders in Settings, with an
// instance per purpose so a zip's path can never become a folder setting
// or the other way round.

export class PickedPaths {
  readonly #paths = new Set<string>()

  remember(path: string): void {
    this.#paths.add(path)
  }

  has(path: string): boolean {
    return this.#paths.has(path)
  }

  /** Spend the path: true when it was remembered, and now is not. */
  take(path: string): boolean {
    return this.#paths.delete(path)
  }
}
