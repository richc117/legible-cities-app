# Specification Quality Checklist: The layout run

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-08
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**This specification was written after the ground was checked, and the
ground moved.** The issue draft was written before the engine existed. Five
parallel readings of the engine, the app, the governance documents, the
feasibility and the interface, with their surprising claims adversarially
verified, found four things the draft assumes that are not true at the
pinned engine. Each is now an assumption in the specification with its
reason, rather than a requirement nobody could meet:

1. There is no hashed layout directory. The cache is flat and keyed by the
   feed alone, so two projects on one feed share a layout. The hashed cache
   is engine issue E04.
2. The map build re-runs any missing layout stage without being asked, so
   "nothing re-runs the layout implicitly" cannot be enforced by the app.
   The specification asks for detection instead, and says why.
3. No project has a service day and nothing can resolve one, because the
   method that would report a feed's service window is two unbuilt engine
   issues away.
4. Forcing a rebuild overwrites the first three stage files before the
   fourth runs. A cancelled re-layout therefore leaves a mixed set that the
   engine then reads as a valid cache. **This was verified by running it**,
   not inferred from the code.

**Two items are the maintainer's, not this specification's.** They are
stated in the Assumptions where they cannot be missed:

- **Re-layout is cut from this feature** because it cannot be made safe at
  the pinned engine. Shipping the issue's "Re-layout" button as drafted
  would be shipping a button that can quietly destroy a project's layout.
  The alternatives are to wait for E04 or to have the app copy the stage
  files aside and restore them, which is the app compensating for the
  engine inside the engine's own directory.
- **ADR-023 and the project feature's specification contradict each other**
  about when a project's service day is resolved: at creation, or at the
  first layout. Neither is implemented. This specification follows the
  later document and says so, but one of the two is wrong and a decision
  record should settle it.

**One requirement was corrected during planning rather than left to fail.**
An earlier draft asked the app to notice a changed layout when a project is
opened. The only way to ask the engine what the layout is would rebuild
whatever is missing, which is precisely what the feature exists to avoid
doing unasked. The check moved to the moment a run is made, and the stored
identifier is shown on the screen so a person can see it without anything
running.
