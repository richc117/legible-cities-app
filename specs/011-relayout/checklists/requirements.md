# Specification quality checklist: re-layout

- [x] The user stories are prioritised and each is independently testable.
- [x] Every functional requirement is testable; every success criterion is measurable.
- [x] No [NEEDS CLARIFICATION] markers remain. One question was answered from A2-02's scope rather than left: the app passes neither mode nor agency to `graph.build` until a person can choose them, so the registry entry's apply and two projects on one feed name one layout.
- [x] Read against the constitution at 1.2.0: principle III holds as written now (renders and exports read the stored layout and never re-run the layout stages); principle II (the id is the engine's).
- [x] The engine is pinned at v0.5.0, the first tag that stores layouts by their inputs; the types are regenerated.
- [ ] The maintainer reads ADR-033 and the real-engine run's answer (the same id twice) in the pull request.
