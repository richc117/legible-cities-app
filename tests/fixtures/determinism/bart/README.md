# The determinism fixture: BART

What `tests/e2e/determinism.spec.ts` exports twice (A5-04), laid out as the
`data/` folder of an engine home, so the test copies `data/` into a
temporary home and nothing else. This README is not copied.

| File                                                | Bytes                  | What it is                                                                                                               |
| --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `data/feeds/bart.zip`                               | 892,312                | BART's GTFS feed, byte for byte as downloaded; sha256 `affdc4d70cac01f71e54f049c754ba36824a885edcdef2ef8b024820c9e93080` |
| `data/graphs/bart/10611c86…3d7c/00_gtfs2graph.json` | 666,154                | LOOM's line graph of the feed                                                                                            |
| `…/01_topo.json`, `02_loom.json`, `03_octi.json`    | 94,046, 94,064, 53,993 | The three layout stages                                                                                                  |
| `…/.meta.json`                                      | 494                    | The layout's inputs, and when it was made                                                                                |

The layout's id is
`10611c86e3241ebae5fbdf73bff41c1a46dca207262dd6a257c709c3741d3f7c`.

## Where it came from

- **The feed** was downloaded from BART's published URL,
  `https://www.bart.gov/dev/schedules/google_transit.zip` (the engine's
  registry entry for `bart`), on 29 August 2026. Its calendar runs from
  10 August 2026 to 10 January 2027.
- **The stage graphs** were made from it on 29 August 2026 by the engine's
  LOOM stages through its Docker backend, the only backend the engine had
  then, and adopted as an addressed layout, unchanged, by engine 0.4.0 on
  11 September 2026: that is what `"migrated": true` and `made` in the meta
  record. The meta carries no path.
- **The id is the pinned engine's**, not just a folder name: at engine
  `v0.8.2` (the tag in `vendor/pins.json`) the layout the engine addresses
  for `bart` with a project's inputs - mode `all`, every operator, no LOOM
  commit told - is this one. `tests/unit/determinism-real.test.ts` asks the
  engine for it with `graph.build` and checks the answer is this id, found
  rather than made, whenever an interpreter with the engine is named.

The normalised copy of the feed is not committed: the engine writes it into
the temporary home from the zip when it first reads the tables.

When the pin moves, run that test against the new engine. If a new engine
addresses the layout differently, the fixture has to be replaced with the
layout it names, and this file with it.

## Licence

The feed is BART's data, not this project's, and it is not under the GPL. It
is redistributed under BART's
[Developer License Agreement](https://www.bart.gov/schedules/developers/developer-license-agreement),
read on 12 September 2026, which grants "non-exclusive, limited and
revocable rights to use, reproduce, and redistribute BART Data" on these
terms: BART's trademarks and copyrighted materials may not be used in
association with the data; the data is provided as is, with no warranty,
and BART is not liable for its use; BART may alter or stop providing it;
BART keeps title to it; and BART may modify or revoke the agreement at any
time. The stage graphs are derived from the same data and are offered on
the same terms. This fixture exists only to test the app, and nothing in it
suggests BART endorses the project. Should BART revoke the agreement, the fixture
has to be replaced with another feed; the copies already in the
repository's history cannot be withdrawn from it.
