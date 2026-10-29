# Contract: the CI layers and the required checks

What `ci.yml` and `determinism.yml` promise after Part 1, and what branch protection requires. A change to any line here is a change to this contract.

## `ci.yml`

| Job | Platforms | Runs on | Steps | Required |
|---|---|---|---|---|
| `ci (<os>)` | ubuntu-22.04, macos-15, windows-latest | every pull request, every push to `main` | install, Electron binary, lint, typecheck, unit tests, build | yes, all three |
| `e2e (<os>)` | macos-15, windows-latest | every pull request, every push to `main` | decide (R3); if the change touches the app or the event is a push: install, Electron binary, build, `npm run test:e2e`, keep the failure evidence | yes, both |

- `e2e (<os>)` always reports. For a documentation-only pull request it passes in under two minutes with the notice "documentation only; the end-to-end suite did not run".
- The decision step prints the changed paths it judged and the rule that matched, so a skipped run can be audited from its log.
- Both jobs keep `timeout-minutes` (fast: 20; e2e: 60) and the per-ref `concurrency` #441 set.
- No job has a `paths:` or `paths-ignore:` filter.

## `determinism.yml`

Unchanged in its platforms, load option and timeout. Its `pull_request` paths name `tests/unit/*-real.test.ts` in place of `tests/unit/determinism-real.test.ts`, so a change to any of the eight (`conformance-real` among them since FR-007) runs it; its other triggers are unchanged. Its unit step becomes:

```
npx vitest run tests/unit/*-real.test.ts
```

It runs with `LEGIBLE_DETERMINISM_TEST=1` and the `LEGIBLE_ENGINE_PYTHON` it already exports. None of the eight suites skips there; a skip is a failure of this contract. It stays not required.

## Branch protection on `main`

Required status checks: `ci (ubuntu-22.04)`, `ci (macos-15)`, `ci (windows-latest)`, `e2e (macos-15)`, `e2e (windows-latest)`, `gitleaks`, `preflight`. Strict (up to date). `docs/repository-settings.md` lists the same, and is changed in the same pull request as `ci.yml`. The setting itself is changed by the maintainer's coordinator within the hour of that merge.
