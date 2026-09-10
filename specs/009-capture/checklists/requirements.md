# Specification quality checklist: the capture

- [x] The user stories are prioritised and each is independently testable.
- [x] Every functional requirement is testable; every success criterion is measurable.
- [x] No [NEEDS CLARIFICATION] markers remain. Three were answered from ADR-024 and the spike report rather than left: the session (a partition of its own, not a userData path, which is the same isolation inside one process), what is validated before a window exists, and that the settle waits with the clock already stopped.
- [x] Read against the constitution at 1.2.0: principle III is what this builds; principle I is untouched (nothing draws); the constraints on the contained page hold (no preload, its own session).
- [x] The engine is asked for nothing; the shape is its own.
- [ ] The maintainer reads the two negative checks in the pull request (the paint wait and the page's `cancelAnimationFrame` removed, each once) and the opt-in crash test's result.
