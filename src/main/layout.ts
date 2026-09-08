// The one value about a layout that the app derives rather than the engine.
//
// Protocol 1 answers a layout request with the four stage graphs' paths and
// no identity of its own, so the app makes one from their contents: two
// projects drawn from the same layout record the same value, a changed
// layout records a different one, and the value carries no path, so it is
// safe in a record, in a log and on a screen. When the engine grows its own
// hashed cache (engine issue E04) its hash replaces this.
//
// The paths came from the engine by way of the page, so none of them is
// trusted: each must lie under the engine's own home, exactly as the
// project origin checks before it opens anything. That is what stops this
// being a way to hash any file on the machine.
//
// Contract: specs/007-layout-run/contracts/bridge.md.

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, sep } from 'node:path'
import { GRAPH_STAGES } from '../shared/layout'

export interface LayoutDeps {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isFile(): boolean }>
  readFile(path: string): Promise<Buffer>
}

const REAL: LayoutDeps = { realpath, stat, readFile }

/** A sentence for a person; never a path, because a refusal is shown. */
class LayoutRefused extends Error {}

const refuse = (message: string): never => {
  throw new LayoutRefused(message)
}

/**
 * The layout's identifier: the SHA-256 over each stage graph's byte length
 * and then its bytes, in the engine's own stage order. The length goes in
 * so that two different splits of the same bytes cannot collide.
 */
export async function layoutIdentity(
  paths: readonly string[],
  engineHome: string,
  deps: LayoutDeps = REAL,
): Promise<string> {
  if (!Array.isArray(paths) || paths.length !== GRAPH_STAGES.length) {
    refuse(
      `A layout is ${GRAPH_STAGES.length} stage graphs; the engine named ${Array.isArray(paths) ? paths.length : 0}.`,
    )
  }

  let home: string
  try {
    home = await deps.realpath(engineHome)
  } catch {
    return refuse('The engine home does not exist, so no layout can be read from it.')
  }

  const hash = createHash('sha256')
  for (let i = 0; i < paths.length; i++) {
    const stage = GRAPH_STAGES[i]
    const path = paths[i]
    if (typeof path !== 'string' || path === '' || !isAbsolute(path)) {
      refuse(`The engine's answer for the ${stage} stage is not a path the app can read.`)
    }
    let real: string
    try {
      real = await deps.realpath(path)
    } catch {
      return refuse(`The ${stage} stage's graph is not where the engine said it was.`)
    }
    if (real !== home && !real.startsWith(home + sep)) {
      refuse(`The ${stage} stage's graph is outside the engine's home, so it was not read.`)
    }
    // Node's own errors carry the path they failed on, and this rejection
    // is shown to a person, so every failure here becomes a sentence.
    let info: { isFile(): boolean }
    try {
      info = await deps.stat(real)
    } catch {
      return refuse(`The ${stage} stage's graph could not be read.`)
    }
    if (!info.isFile()) {
      refuse(`The ${stage} stage's graph is not a file.`)
    }
    let bytes: Buffer
    try {
      bytes = await deps.readFile(real)
    } catch {
      return refuse(`The ${stage} stage's graph could not be read.`)
    }
    hash.update(`${stage}:${bytes.length}:`)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

export { LayoutRefused }
