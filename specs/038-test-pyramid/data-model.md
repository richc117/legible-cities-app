# Data model: The test pyramid

There is no persisted data. These are the shapes the tests and workflows exchange.

## Decision of the `e2e` job (Part 1)

| Field | Meaning |
|---|---|
| `event` | `pull_request` or `push` |
| `changed` | the paths `git diff --name-only <base>...<head>` lists (pull requests only) |
| `docsOnly` | true when every path in `changed` matches the R3 list; always false on `push` |
| `ran` | `!docsOnly` |

The job's log prints all four. A pull request with no changed paths (an empty diff) is **not** documentation only: the suite runs.

## Conformance row (Part 2, outline)

| Field | Meaning |
|---|---|
| `method` | one of the 15 in `vendor/protocol.schema.json` |
| `params` | the request's params, as JSON text so non-doubles can be sent |
| `expect` | `{ result: <shape> }` or `{ error: { code, kind, sentence } }` |

It is read by the stand-in's test in `ci` and by a real-engine suite in `determinism.yml`. Issue 473's `stand-in-params.test.ts` table is its first form.

## Mutation entry (Part 3, outline)

| Field | Meaning |
|---|---|
| `file` | the source file mutated |
| `find` / `replace` | an exact text change |
| `test` | the test file and title that must go red |

It lives beside the test it belongs to. The format is fixed when Part 2 has settled.
