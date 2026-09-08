# Research: Typed engine client

Phase 0. Each section is a decision, what forced it, and what was measured
rather than assumed. Everything here was checked against the engine at
v0.2.0 and the tree on 2026-09-07.

## 1. The engine's description is already a file, and it is byte-stable

`python -m schematic.serve --schema` does not build a document: it reads
`schematic/protocol/v1.json` from the installed package and prints it with
a two-space indent and a trailing newline (`serve.py`, the `--schema`
branch). Run three times, the output hashed identically
(`33b19cbb…`). There is no timestamp, no path and no dictionary whose
order could vary, because Python preserves the file's key order through
`json.loads` and `json.dumps`.

**Decision**: commit the command's output verbatim as
`vendor/protocol.schema.json`. Do not re-sort, re-indent or normalise it.
Anything the app does to those bytes is a second thing that can differ
between machines, and there is nothing to gain: the source is already
canonical.

**Consequence**: the drift check is a byte comparison, not a semantic
diff, which is the strictest form and the easiest to explain in a failure
message.

## 2. Generating the types: by hand, not with a library

`json-schema-to-typescript` 16.0.0 is MIT and would work. It was rejected
on two grounds, one of which is disqualifying.

**Disqualifying: it makes the output depend on a formatter's version.**
The library runs Prettier over what it emits, and declares
`prettier: ^3.9.6` as its own dependency. FR-003 and SC-006 require the
same schema to produce the same file on every machine; with the library,
the file also depends on whichever Prettier the tree resolves that week.
That is a reproducibility hazard introduced for no benefit.

**Secondary: eight transitive dependencies for one 15 KB file.** The
library brings `lodash`, `js-yaml`, `minimist`, `prettier`, `tinyglobby`,
`@apidevtools/json-schema-ref-parser` and two type packages. A2-00 has
just finished proving that a dependency's whole tree is a liability worth
counting, for licensing as well as for supply chain.

**What the emitter has to handle is a closed set.** Every keyword that
appears anywhere in the schema's `$defs`, `methods` and `notifications`
was enumerated:

| Keyword                                                                  | Uses       | Emitter's job                                                                         |
| ------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------- |
| `type`                                                                   | 77         | the seven primitives, plus two unions: `["integer","string"]` and `["string","null"]` |
| `$ref`                                                                   | 24         | always `#/$defs/Name`; becomes the name                                               |
| `properties`, `required`, `additionalProperties`                         | 20, 20, 21 | an interface; `additionalProperties` is `false` everywhere it appears                 |
| `items`                                                                  | 4          | an array                                                                              |
| `oneOf`                                                                  | 1          | `NoParams` only: null or an empty object                                              |
| `enum`                                                                   | 3          | a union of string literals                                                            |
| `const`                                                                  | 2          | a literal type                                                                        |
| `description`                                                            | 26         | a doc comment                                                                         |
| `minimum`, `maximum`, `exclusiveMinimum`, `pattern`, `format`, `default` | 33         | ignored: they constrain values, not shapes                                            |

No `allOf`, no `anyOf`, no `not`, no conditional subschemas, no tuple
`items`, no recursion. Sixteen keywords in all, ten that shape a type and
six that constrain values and are read only to be ignored. An emitter over
that set is short and has no dependency, and it fails loudly on a
seventeenth rather than emitting something plausible.

**Decision**: write the emitter. Make it refuse an unrecognised keyword
with the keyword's name and its path, so a future engine change that
outgrows it stops the build instead of silently producing a wrong type.

**Alternatives considered**: `quicktype` (heavier still, and its output
shape is further from what is wanted); hand-writing the types themselves
(rejected: it is exactly the drift the feature exists to prevent).

## 3. Where the pattern-constrained strings stop

`FeedKey`, `Token` and `ServiceDate` are strings with patterns. A template
literal type could express part of `ServiceDate`'s shape and none of the
other two.

**Decision**: they are `string`, with the pattern in the doc comment.
Encoding a pattern in a type promises a check the compiler will not
perform on a value that came from a file or a person, and the engine
refuses a bad value with a sentence written for a person, which is a
better failure than a cast.

## 4. The divergence this feature expected does not exist

The plan for this feature assumed one place where the client would have to
tighten the schema: `map.build`'s service day, which the engine refuses the
request without, because it will not choose a day whose choice would depend
on the day the request was made (ADR-023, and the `ServiceDate` definition
says so).

**Measured, not assumed**: `MapBuildParams` lists `["key", "date"]` as
required. The engine's description already says what the engine enforces.
The first generated module had `date` required without anything being
asked of it.

**Consequence**: the client tightens nothing and relaxes nothing. It is a
projection of the description with no exception anywhere, which is a
simpler thing to describe, to test and to trust than the mapped type this
research originally proposed. FR-007 says so, and FR-008 needs no carve-out.

**Worth recording** because the premise was written down before it was
checked, and the check took one command. The design was better for being
wrong: an exception that does not exist cannot drift from the schema
later.

## 5. Calling a method that takes no parameters

`engine.info` and `engine.shutdown` take `NoParams`, which the schema
defines as null or an empty object. Making a caller write
`request('engine.info', null)` is noise.

**Decision**: the client's signature takes the parameters as a rest tuple
whose shape depends on the method, so a method with no parameters is
called with none and every other method must pass them. One conditional
type, no overloads, and the compiler still refuses a missing parameter
object where one is required.

## 6. Progress routing, and the ordering trap A1-01 left behind

The bridge's `onProgress` and `onLog` are global: every notification for
every request, each already re-keyed from the engine's integer id to the
token the preload minted. A request's answer arrives as a separate
`engine:settled` event on the same ordered channel, deliberately, because
Electron does not order an invoke's reply against events
(`specs/004-sidecar-supervisor/research.md`, and the rule in the private
`rules/main.md`).

**Decision**: the client subscribes to each global stream once and fans
out by token to per-request listeners. A request's listeners are released
when its promise settles, which is after its last notification by the
bridge's own ordering. The client must not release them earlier, and must
not add a channel of its own; the ordering is already correct one layer
down, and the way to keep it correct is to change nothing about it.

**Watch**: a listener added after a request settles is never called. That
is correct and is tested, because the alternative, holding the
subscription open, is a leak.

## 7. What a contract test can actually prove without Docker

`engine.info` and `engine.shutdown` are pure protocol and run anywhere the
engine is installed. `graph.build` and `map.build` run the layout tools and
need a downloaded feed; neither is available on a machine without Docker,
and neither belongs in a test that must finish in seconds.

**Decision**: call the first two for real. Prove the second two at their
refusals: an unregistered feed key for `graph.build`, and `map.build`
without a date. A refusal exercises the parameter names, the schema's
`additionalProperties: false`, the error code and the `{kind, detail,
hint}` shape, which is what the types actually claim. The spec says this
plainly (FR-015, SC-003) rather than implying the methods are run.

**What this does not cover**: that a successful `graph.build` result
matches `GraphBuildResult`. That needs the layout tools and belongs with
A3-01, which runs one for a project.

## 8. Continuous integration cannot run any of this yet

`.github/workflows/vendor.yml`'s python job carries a literal placeholder:
"The engine pin lands with A1-02; until then this job needs a path." The
pin exists now, so the job can name the repository and the tag. It still
cannot succeed, because the engine's `main` and its tags are not pushed to
GitHub; that is the maintainer's action and it is outside this feature.

**Decision**: wire the job to the pin, and say in the plan and in the
issue that it goes green when the tag is published. Wiring it removes the
placeholder A0-06 has been open on, but does not close that issue: A0-06
also wants the job green on darwin-x64 and win-x64, and the matrix carries
only darwin-arm64 today.
