# Quickstart: proving part 1 (#489)

1. **The ordering property first.** `npm run build && npx playwright test tests/e2e/record-order.spec.ts`: passes 10 times in a row under load (`e2e-loop` with load, on macOS and Windows). If it fails, part 1 stops; see research.md R3.
2. **`drawn` from what was sent.** `npx vitest run tests/unit/projects-store.test.ts tests/unit/layout-run.test.ts`. The User Story 1 matrix passes: seven run kinds, each against each field written mid-run. Mutation: build `drawn` from the record again; the matrix goes red.
3. **R3-02's probe.** A layout whose `map.build` is held, with a day chosen meanwhile, then released: the record's `date` is the chosen day, and `drawn.date` is the run's day.
4. **No mechanism left.** `git grep -nE "writingFrom|#taken|#afterWrites|writtenAfter|RecordWrite" src/` prints nothing.
5. **The regression.** The end-to-end suites for 388, 399 and 407 (`tuning`, `inspect`, `layout`, `colours`, `order`, `style`) pass unchanged locally against the pinned engine, then 10 loaded loops per platform.
6. **No visible change but the truthful one.** In `npm run dev`, change the day while a layout runs. When the run ends, cell 03 says the map is not drawn for that day yet, and the rebuild the choice started draws it.
