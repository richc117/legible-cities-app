# Contract: generating the types

## The command

```
npm run typegen
```

Requires an engine checkout, named by `LEGIBLE_ENGINE_CHECKOUT` in
`.env.local` or the environment, with the engine installed in its virtual
environment. It:

1. runs `python -m schematic.serve --schema` in that checkout;
2. writes the output verbatim to `vendor/protocol.schema.json`;
3. writes its SHA-256 to `vendor/pins.json` at `engine.schema_sha256`;
4. writes `src/shared/protocol.ts` from the description.

It writes all three or none. With no checkout it stops with the sentence
saying which key to set, and changes nothing.

## Guarantees

- **Verbatim.** The description is the engine's bytes. Nothing re-sorts,
  re-indents or normalises it; the engine already prints a canonical file.
- **Reproducible.** The same description produces the same
  `src/shared/protocol.ts` on any machine, with no timestamp, path,
  username or version of a formatter in it. The header names the pinned
  tag, which is data from the pin, not from the machine.
- **Total or loud.** A keyword the emitter does not know stops it, naming
  the keyword and its path in the description. It never emits `unknown`
  or `any` to get past something it did not understand.

## Emitted shape

Per `contracts/../data-model.md`. In brief: one export per definition, a
`Methods` interface of `{ params, result }` per method, a `Notifications`
interface, `Method` and `NotificationName` as their keys, and `PROTOCOL`
as the description's protocol number.

## The two checks

| Check           | Needs an engine | Fails when                                                                                                                            |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Fingerprint     | no              | `vendor/protocol.schema.json`'s hash differs from `engine.schema_sha256` in the pin. Runs everywhere, including CI.                   |
| Drift           | yes             | the engine in the checkout prints a description differing from the committed copy. Skips, saying so, with no checkout.                |
| Reproducibility | no              | regenerating `src/shared/protocol.ts` from the committed description differs from the committed file, byte for byte. Runs everywhere. |

Each failure names `npm run typegen` as the fix. The drift check also
prints the first differing line, because "the schema changed" without
saying how is a message that sends someone to a diff tool.

## Why the generated file is committed

The machines that build the app have no engine and no Python. Generating
at build time would make the build depend on a checkout that CI does not
have. Committing the output makes the build hermetic and makes a change to
the boundary visible in a diff, which is where a reviewer will see it.
