# ADR-044: The interface's palette is the app's own

- **Status:** Accepted
- **Date:** 2026-09-19
- **Supersedes:** ADR-026, in part (the mark only)
- **Superseded by:** none

## Context

A design session on 2026-09-19 rebuilt the design system around a new
application icon and a set of brand art, and the maintainer settled what
the new identity is: parchment as the day ground and the icon's own dark
as the night ground, replacing the grounds warm-dark and sepia have had
since the first commit; four brand lines - vermilion, cobalt, saffron and
jade - carried by the icon, the lockup, the progress line and the header
rules; cobalt as the accent and the focus ring; and a new icon in place of
the 45-degree mark ADR-026 chose. The theme identifiers do not move: a
bare `:root` is still warm-dark and `data-theme="sepia"` is still the
light theme, and only the names a person reads become Night and Parchment.
None of that has reached the code, and this record is written before any
of it does.

Getting it into the code runs into one obstacle. Six of the tokens the
retheme moves - `--bg`, `--bg-soft`, `--text`, `--muted`, `--border` and
`--focus` - live in `src/renderer/src/styles/tokens.css`, which is not a
file this repository authors. It is a verbatim copy of the two theme
blocks in the engine's animation page, and `tests/unit/tokens.test.ts`
fails whenever the copy drifts from the page in the checkout named by
`LEGIBLE_ENGINE_CHECKOUT`. Editing those six values in the app alone fails
that test by design, and that is the point of it: ADR-026 and
`docs/DESIGN.md` section 3.1 both state that the brand six are shared with
the engine's page and that everything below them is the app's.

What the retheme forced was a re-reading of how much of that sharing is
still real. Four things are true of the code as it stands.

`tokens.css` never reaches the map. `Viewer.tsx` gives the frame the
address `app://local/projects/<id>/?present=1&controls=1&theme=<theme>`,
and the engine's generated page carries its own inline copy of both theme
blocks and picks one from that query. The frame is `sandbox="allow-scripts"`
on an opaque origin (ADR-028), so no stylesheet of the app's crosses into
it. The copy is the app's chrome palette and nothing else.

Half of it is dead. `--link-hover` and all five `--map-*` tokens have no
reference anywhere outside `tokens.css` itself. They are there because the
copy is verbatim, not because anything reads them.

A4-03 separated the two themes as choices but not as values. A project's
map theme is written to its record and a person's interface theme is a
separate setting, and neither follows the other - yet both still resolve
to the same two palettes, because the app's copy is the engine's.

And `theme.css` already wins wherever the two files name the same token.
It is imported after `tokens.css` and repeats the same two selectors, so
the cascade prefers it, and `tests/unit/contrast.test.ts` resolves a token
by spreading `theme.css` over `tokens.css` for the same reason.

Against that, rethemeing the engine first is not a one-file change. The
palette is written out three times there - the animation page, `PALETTES`
in `src/schematic/export.py`, and the public site's stylesheet - with a
test asserting all three agree, because, as its comment puts it, "a dark
map on a light ground is the kind of mistake that only shows up after it
is posted". A change there is a release, a tag, a pin bump here and a
fresh copy, and it repaints every map in the published gallery and the
ground of every reel already exported.

## Options

**A. Retheme the engine first.** Move the two theme blocks in the engine's
page, the export's palette and the site's stylesheet together, tag a
release, bump the pin in `vendor/pins.json` and copy the new blocks here.
It buys one palette across the app, the map and the site again, and keeps
`tokens.css` meaning exactly what it says. It costs a cross-repository
release landing on a release candidate that is published and passing its
acceptance gate; it changes the appearance of every map the engine has
ever drawn, including the ones on the site and the reels already exported;
and it cannot deliver the retheme as it was settled, which holds the
engine's `--map-*` and `--train-halo` at their present values. Under A the
page's own furniture would go parchment while the map inside it stayed the
old cream - one document disagreeing with itself.

**B. Decouple the interface from the engine's six.** Leave `tokens.css` as
the engine's copy, drift test and all, and let `theme.css` declare the
interface's own ground and ink. It buys a retheme confined to one
repository and one stylesheet: the engine, the pin, the published
candidate, the gallery, every existing export, the determinism gate and
the acceptance run are untouched, and the drift test goes on watching the
engine's page, so a change there still cannot pass unnoticed. It costs the
claim that the brand six are shared, which `docs/DESIGN.md` makes in two
places, and it leaves `tokens.css` a file the app imports and reads
nothing from. It also means the two grounds stop matching: a person with
the interface in Parchment beside a map in Sepia will see two creams.

## Decision

We took B. The interface's palette is the app's own, declared in
`theme.css`; `tokens.css` stays a verbatim, drift-tested copy of the
engine's page, so that a retheme on the engine's side is still caught, and
stops being the source of the app's chrome. This is the honest shape of
what A3-02 and A4-03 had already built: the viewer has been unable to read
the app's stylesheets since its frame was given an opaque origin, and the
map's theme and the interface's have been independent choices since A4-03
- all that was still joined was the values, by a copy. Recorded with it,
as the identity the retheme establishes: the four brand lines are identity
and never a state, which makes the design document's first principle "the
map is the engine's; the lines are the brand's; neither is a state";
cobalt is `--accent` and `--focus`; and the new icon replaces the
45-degree mark everywhere it appears, including the in-app `mark` glyph.
That last supersedes the third of ADR-026's three decisions and leaves the
other two - Phosphor as the icon set, the native `<select>` styled with
the tokens - standing.

## Consequences

The retheme becomes a change to `theme.css`, the token contract under
`specs/005-design-system-foundations/contracts/`, the figures in
`tests/unit/contrast.test.ts` and the design document, and it stops there.
Nothing about the engine, the pin, the map or the export moves. The values
themselves are not in this record: they land in
`specs/005-design-system-foundations/contracts/tokens.md`, which is where
every token's value and its asserted contrast already live.

Two creams. In Parchment beside a map in Sepia the interface's ground
(`#f5e6c8`) and the map's (`#f7efe1`) differ by a little, where today they
are one colour. That is the price, and it is paid on the project screen,
which is where a person spends their time. A4-03 already allowed a Night
interface beside a Sepia map, so a mismatch was reachable before; what
changes is that it becomes reachable in every combination.

`tokens.css` becomes a stylesheet the app imports and reads nothing from,
holding the engine page's six plus six more that nothing here consumes.
Whether it stays in the import list or becomes a fixture only
`tests/unit/tokens.test.ts` reads is left to the token change; either way
the drift test stays, because its value was never that the app used those
values.

`docs/DESIGN.md` loses "Only the brand six are shared with the engine's
page" from section 3.1 and the "six brand colours per theme are the
source" clause from principle 4. Both are replaced rather than struck out:
the document has to say where the interface's palette comes from instead,
and that the engine's page keeps its own.

The retheme blocks `v0.1.0`. The published release candidate's acceptance
run is therefore spent, and the documents that quote the app's own words
and colours - `docs/acceptance.md`, `docs/acceptance-stranger.md` and the
screen-reader walkthrough in `docs/accessibility.md` - have to be re-read
against the new screens before that gate is run again.

Two smaller things settled alongside. The brand art is committed at
`assets/brand/`, taking the copies without the C2PA provenance metadata:
it is roughly 55% of every icon file's bytes and would want an allowlist
entry to get past the secret scanners. And the banner art's fifth,
magenta line stays in the art and gets no `--line-*` token of its own; the
banners are illustration, and the four lines remain the identity.

What to watch: whether the two grounds diverging ever reads as a fault
rather than a choice. If it does, rethemeing the engine is available as
its own issue and its own record, judged on the map's merits rather than
as the tail of a rebrand - and this record is the one it would supersede.
