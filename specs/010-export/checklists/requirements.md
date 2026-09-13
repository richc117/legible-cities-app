# Specification quality checklist: the export

- [x] The user stories are prioritised and each is independently testable.
- [x] Every functional requirement is testable; every success criterion is measurable.
- [x] No [NEEDS CLARIFICATION] markers remain. Two were answered from the issue and the plan rather than left: the export folder is a configuration key with a desktop default (the issue says "the chosen export folder"; Settings own the choice later), and the frames live under the engine home rather than the system's temp folder (ADR-016's rule, as written).
- [x] Read against the constitution at 1.2.0: principle II holds (the plan, the file name and the sidecar are the engine's); principle III is measured by the reel test; principle V holds (no path reaches the page).
- [x] The engine is asked for nothing beyond v0.3.0; the pin moved and the types were regenerated.
- [ ] The maintainer reads the reel test's figures in the pull request: the two exports' timings, the file's size, whether the two files were byte-identical, and the largest channel difference.
