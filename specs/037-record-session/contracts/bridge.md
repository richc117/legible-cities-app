# Contract: the projects bridge after part 1

## The ordering property (FR-008)

For one renderer frame, `projects:*` invokes are applied by main in the order they were sent:
- a `get` answers with every write sent before it;
- a write's answer is the record with that write and every earlier one applied.

Held by `tests/e2e/record-order.spec.ts` under load. Every `projects:*` handler in `src/main/ipc.ts` reaches the store's queue with no `await` before it; a unit test reads the handlers' source for that, as a guard of a rule about the source.

## Changed calls

| Call | Before | After |
|---|---|---|
| `projects.get(id)` | answered outside the queue | queued behind writes already in main |
| `projects.completeLayout(id, done)` | `done`: date, layout, made, built, service, stations?, tuning? | the same, plus `sent: SentSet`; `drawn` from `sent` |
| `projects.completeRebuild(id, done)` | date, stations? | `sent: SentSet`, stations? |
| `projects.completeColors(id, palette, stations)` | palette, stations | the same, plus `sent` |
| `projects.completeOrder(id, order, stations)` | order, stations | the same, plus `sent` |
| `projects.completeStyle(id, style, stations)` | style, stations | the same, plus `sent` |
| `projects.completeLines(id, lines, stations)` | lines, stations | the same, plus `sent` |

- Each `sent` is validated in main. A refusal is the existing sentence for the field it names, and nothing is written.
- Every answer carries `revision`.

## Unchanged

All other `projects:*` calls keep their arguments and answers, and gain `revision` in the record they answer with.
