# ADR-026: The design system's icons, select control and mark

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

`docs/DESIGN.md` was written on 2026-09-07 from two research passes over
primary sources. It settled the colour tiers, the two type tracks, the
grid, and FigUI3's MIT core as the control kit, and left three choices to
the maintainer because each ran against a stated preference or a licence.

The maintainer wanted to keep Esri's Calcite UI icons without the Calcite
framework. The package that carries only the SVGs, `@esri/calcite-ui-icons`
(4.5.0), is licensed under Esri's Master License Agreement: "redistribute
and use this code without modification, provided you adhere to the terms
of the MLA". The current agreement (E204, revised 1 August 2025), Article
B.1(k), forbids combining any Esri offering "in a manner that would subject
any Esri Offering to open-source or open-database license terms (e.g.
GPL)". This application is GPL-3.0-or-later. Whether unmodified SVG files
carrying their own notice inside such an app fall under the GPL's
aggregate exception is a legal judgement the research could not settle,
and the engine's animation page already ships four of these icons on that
reading.

FigUI3 has been split-licensed since 8.9.24: the core is MIT, the editor
and lab bundles are PolyForm Shield 1.0.0, which is not GPL-compatible. The
`<fig-select>` element lives in the editor bundle. The library has a single
author and released eight versions in the three days before this record.

The interface needs an app icon and an empty-state glyph, and the design
document proposes deriving both from the vocabulary of Beck's 1933
Underground diagram, whose image and lettering Transport for London treats
as its own.

## Options

**Icons.** Keep Calcite and ask Esri's licensing contact for written
confirmation: keeps the hand the maintainer prefers, at the cost of a
dependency on an answer that may not come, and of shipping files under an
agreement that names the GPL as a forbidden outcome until it does. Move to
Phosphor (`@phosphor-icons/core` 2.1.1, MIT): drawn on a 16-unit grid like
Calcite, six weights as separate files so a light weight at 16px comes
closest to Calcite's thin geometric hand; filled paths rather than
strokes, so weight is chosen per file rather than tuned with CSS. Tabler
(MIT) and Lucide (ISC) are 24-grid sets with 2px strokes, heavier at 16px
even with the stroke reduced. Remix Icon was ruled out: its January 2026
licence names permissive hosts only and warns of incompatibility with
copyleft.

**Select.** Pin FigUI3 at 8.9.23, the last release where the editor bundle
was MIT, to keep `<fig-select>`: freezes a daily-churning library at an old
release for one control. Or style the native `<select>` with the tokens:
loses nothing the app needs, keeps the pin on the current core.

**Mark.** Follow the design document's section 10: a 45-degree join with a
hollow interchange diamond, drawn by hand, in the brand's text colour on
the sepia ground and in the accent on warm-dark. Or commission a separate
brief. Reproducing any part of the diagram, the roundel or the Johnston
lettering was never on the table.

## Decision

The maintainer chose Phosphor over Calcite, the light weight at 16px and
the regular at 24px, vendored as plain SVG files with the MIT notice; the
native `<select>` styled with the tokens rather than an old pin of FigUI3;
and the mark as the design document draws it. The same reasoning applies
to the four Calcite icons inside the engine's animation page, which
becomes an issue on the engine.

## Consequences

`THIRD_PARTY_NOTICES.md` gains Phosphor (MIT) and FigUI3 core (MIT, with
the `@ungap/custom-elements-builtin` it vendors, ISC), and drops the
Calcite UI icons row once the engine page no longer ships them. A2-00
implements the icon set and the styled select; the engine issue swaps the
page's four icons, after which the view switcher the app embeds changes
hand slightly and the notices on both repositories are aligned.

What this costs: Phosphor's filled paths cannot be thinned with CSS, so
every icon is chosen from a weight folder and the two sizes are tokens,
never scaled between; a glyph the set lacks is drawn by hand to its grid
rather than borrowed from another set. The native `<select>` renders its
popup in the platform's own style, which the tokens do not reach; the
design document accepts that as the platform showing through. The mark is
an allusion and stays one: if a later brief wants a different identity, it
is a new record.

What to watch: FigUI3's licence has narrowed once and may again; the pin
and the CI grep that refuses the editor bundle are what protect the app,
and every upgrade re-reads the LICENSE file. Esri may clarify the
agreement; if it does, this record still stands, since the choice also
rests on a hand the app can ship without asking.
