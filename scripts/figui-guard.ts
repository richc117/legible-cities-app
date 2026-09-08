// A Vite plugin with two jobs around FigUI3, both about what the npm
// package does not do for us. It refuses the editor and lab bundles at
// build time: the package ships both halves and only the core is MIT
// (ADR-026), so the line is what the app imports, and the resolver is the
// earliest point a build can hold it. And it keeps the core script's side
// effects: the package's `sideEffects` list names `./fig.js` while its
// export resolves to `./dist/fig.js`, so Rollup would otherwise treat the
// script that registers the custom elements as removable and drop it from
// the production bundle. Registered for the renderer in
// electron.vite.config.ts; tests/unit/figui-guard.test.ts exercises both.

const FORBIDDEN = /figui3\/(?:dist\/|src\/)?fig-(?:editor|lab)(?:\.|$)/
const CORE_SCRIPT = /figui3\/(?:dist\/|src\/)?fig\.js$/

export const MESSAGE =
  "FigUI3's editor and lab bundles are PolyForm Shield licensed and cannot ship in this GPL app; import only fig.css and fig.js (ADR-026)."

export function refuses(id: string): boolean {
  return FORBIDDEN.test(id)
}

export function isCoreScript(id: string): boolean {
  return CORE_SCRIPT.test(id)
}

/** The part of Rollup's plugin context the guard uses. */
export interface ResolveContext {
  resolve(
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ): Promise<{ id: string } | null>
}

export type Resolved = { id: string; moduleSideEffects: true } | null

export function figuiGuard(): {
  name: string
  enforce: 'pre'
  resolveId(this: ResolveContext, id: string, importer?: string): Resolved | Promise<Resolved>
  load(id: string): null
} {
  return {
    name: 'figui-guard',
    enforce: 'pre',
    resolveId(this: ResolveContext, id: string, importer?: string): Resolved | Promise<Resolved> {
      if (refuses(id)) throw new Error(`${MESSAGE} Refused import: ${id}`)
      if (!isCoreScript(id)) return null
      return this.resolve(id, importer, { skipSelf: true }).then((resolved) =>
        resolved === null ? null : { id: resolved.id, moduleSideEffects: true },
      )
    },
    // The same line at load, where ids are resolved paths: a relative
    // import from inside the package reaches here under its full name.
    load(id: string): null {
      if (refuses(id)) throw new Error(`${MESSAGE} Refused module: ${id}`)
      return null
    },
  }
}
