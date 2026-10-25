# Quickstart: proving Part 1 works

## FR-001, the four shapes

```
npx vitest run tests/unit/stand-in-shapes.test.ts
```

The four new checks pass. Remove one field from the stand-in's `engine.info` answer in `tests/fake-engine/schematic/serve.py`, and its check goes red.

## FR-002, the real suites

Locally, with the engine at the pin:

```
LEGIBLE_ENGINE_PYTHON=../lc-engine-current/.venv/bin/python LEGIBLE_DETERMINISM_TEST=1 \
  npx vitest run tests/unit/*-real.test.ts
```

All seven run, with no skips and with no `LEGIBLE_ENGINE_CHECKOUT` set: each finds its stored layout, feed or page from the BART fixture. Then dispatch `determinism.yml` on the branch with `repeats: 1`. Each platform's log lists the seven files, passed.

## FR-003, the split

On the pull request that changes `ci.yml`:

1. The checks show `ci (<os>)` three times and `e2e (<os>)` twice.
2. The pull request touches `src/` and `ci.yml`, so `e2e (<os>)` runs the suite.

The documentation-only case cannot be shown on that pull request. The gate judges a pull request's whole diff, not its last commit, so a later commit there that changes only a `.md` file still runs the suite, which is the gate failing closed. It is shown on the first pull request after the merge whose every path is documentation:

3. `e2e (<os>)` passes in under two minutes with the "documentation only" notice, and lists each path with the rule it met.
4. After the merge, a push to `main` runs the suite on both platforms.
5. Branch protection lists the seven checks (`gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.contexts'`).

A documentation-only pull request is mergeable within 10 minutes of its push (SC-001).
