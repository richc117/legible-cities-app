// Types for the part of release.mjs that TypeScript imports: the version the
// app reports, which electron.vite.config.ts reads at build time. The unit
// test loads the whole script with its own interface
// (tests/unit/release.test.ts), so nothing else is declared here.

export function releaseLabel(
  pkgVersion: string,
  ref: string | null | undefined,
  commit?: string | null,
): string

export function buildCommit(env: Record<string, string | undefined>, cwd: string): string | null
