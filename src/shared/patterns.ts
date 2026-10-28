// Pieces of regular expressions more than one module builds patterns from.

/**
 * One separator in a path, as source for a regular expression: either
 * slash, or either one percent-encoded as a file URL writes it. A known
 * folder's pattern accepts all four (`src/main/paths-in-text.ts`), and so
 * do the scans that find where a path ends (`src/shared/engine.ts`), where a
 * cut falls (`src/main/ipc-shape.ts`) and where a home is written
 * (`src/main/diagnostics-text.ts`).
 */
export const SEP = String.raw`(?:[\\/]|%2[Ff]|%5[Cc])`

/** A text as a regular expression that matches it exactly, every special character escaped. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
