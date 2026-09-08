# Data model: the layout run

Phase 1. What a run is while it happens, and what survives it.

## What survives: two fields the record already declares

`ProjectRecord` has carried `layout: string | null` and `date: string | null`
since the project feature, both `null` and both waiting for this one.

| Field      | Becomes                                          | Written                            |
| ---------- | ------------------------------------------------ | ---------------------------------- |
| `layout`   | the layout identifier, 64 hexadecimal characters | when a run completes               |
| `date`     | the service day, `YYYY-MM-DD`                    | at the first run, then never again |
| `modified` | the run's completion time                        | with the other two                 |

All three are written in one atomic replacement of the record, or none is.
A cancelled or failed run writes nothing at all.

## The layout identifier

The engine returns the four stage graphs' paths and no identity of its own.
The app derives one:

> the SHA-256 of the four files' bytes, concatenated in the engine's own
> stage order, with each file's length written in before its bytes so that
> two different splits cannot collide.

Properties this gives, each of which the feature needs:

- **Two projects on one feed record the same identifier**, because they were drawn from the same four files. That is true and worth saying, rather than a collision to be hidden.
- **A changed layout produces a different identifier**, so a project can tell that what it was drawn from is not what is there now.
- **It is reproducible on any machine** from the same layout, which is what a determinism test compares.
- **It carries no path**, so it is safe in a record, in a log and on a screen.

What it deliberately is not: a timestamp, a counter, or anything derived
from where the files sit. When the engine grows its own hashed cache (E04),
its hash replaces this one and this paragraph is deleted.

## The stage sequence

The engine reports a stage when that stage finishes. The app draws a line
before anything has finished, so it declares the sequence it expects:

| #   | Stage        | Reported by                                 |
| --- | ------------ | ------------------------------------------- |
| 1   | `gtfs2graph` | the layout call, then again by the map call |
| 2   | `topo`       | the same                                    |
| 3   | `loom`       | the same                                    |
| 4   | `octi`       | the same                                    |
| 5   | `schedule`   | the map call                                |
| 6   | `render`     | the map call                                |
| 7   | `animate`    | the map call                                |
| 8   | `write`      | the map call                                |

This mirrors the engine's pipeline at protocol 1 and is therefore a coupling
the app cannot avoid and must not hide: a gated test lays a project out
against the real engine and asserts the reported names are exactly these, in
this order, so a pipeline that changes shape fails a test rather than
drawing a wrong picture.

A report for a stage already finished is ignored, which is how the map
call's repeat of the first four is handled.

## The run

One run per project at a time. It exists only while it happens; nothing
about it is stored.

| Field     | Shape                                                              | Notes                                                                                                                                                 |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`   | `idle` \| `running` \| `done` \| `failed` \| `cancelled`           | what the screen draws                                                                                                                                 |
| `stages`  | the eight above, each `pending` \| `running` \| `done` \| `failed` | fed straight to the progress component                                                                                                                |
| `message` | the engine's sentence for the stage that last finished             | the engine's words, except where its sentence is a path: the write stage reports the folder it wrote into, and that is replaced by what the stage did |
| `error`   | the engine's error, when there is one                              | `hint` on screen, with any path taken out of it at the boundary; `detail` keeps the whole of it                                                       |
| `changed` | whether the layout differs from the one the project stored         | reported after the run, not before                                                                                                                    |

### The progress rule

The engine says "this stage finished, and here is what it produced". The
progress component draws a running stage and its sentence. Mapping one to
the other, exactly:

- a report for stage _n_ marks _n_ **done** and takes its sentence;
- stage _n+1_ becomes **running**, with no sentence of its own until it finishes;
- the sentence on screen therefore always describes the last completed stage, and the component's "current" stage is the one being waited for.

Getting this backwards would attribute a finished stage's numbers to the
stage now running, which is why it is written down rather than left to
whoever wires it.

## What the app never sends

The project's `mode` and `agency` are not sent. Protocol 1's parameters are
closed and carry neither; the engine takes the mode from its own registry.
The fields stay in the record, unused, until the engine keys its cache by
them (E04).
