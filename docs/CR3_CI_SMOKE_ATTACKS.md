# BurnBrake — Code Review ×3 (CR3) Attack Log — CI smoke

**Pass:** third hostile review. CR1 and CR2 catalogs are not re-opened except to leave their P2s open.
**PR:** https://github.com/yellowgram/burnbrake/pull/6 (`cursor/ci-smoke-workflow-9fac`)
**Head reviewed:** `8632c81265d61ca4cf6821c4ea2c872bbfad3af8`
**Date:** 2026-09-27
**Scope:** workflow triggers and checkout defaults, the test glob versus files on disk, token scope. This file is the only addition from this pass.
**Stance:** double-run and zombie jobs, credential persistence on the runner this file actually selects, silent skipped suites, secret and write elevation.
**Outcome:** No P0. No P1. Two new P2 limits, left open. **Verdict: APPROVE.** Workflow file not changed.

Actions run [36289919857](https://github.com/yellowgram/burnbrake/actions/runs/36289919857) on `8632c81` (`pull_request`) concluded **success**. Runner: **Hosted Compute Agent**, image **ubuntu-24.04** (`runs-on: ubuntu-latest`). Node **v22.23.2**. Tests **74 pass / 0 fail**. Token log: `Contents: read`, `Metadata: read`. `persist-credentials: true`.

Polar stays dark. Soft-WTP stays off. Exhaust contract was not edited.

Still open, not re-counted: CR1 unpinned `@v4` actions, no path filters, no `timeout-minutes`. CR2 demo adjacency, runner cache write, `tsc` include limited to `src/`.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | This file persists a write token onto a reused runner, or a step can raise `GITHUB_TOKEN` to write. |
| **P1** | A newer commit shows green because an older job finished, or a suite the tree already has does not run while CI stays green. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 2 | 0 | 2 |

---

## Attack catalog

### C1 — `push` plus `pull_request`, and no `concurrency`

| | |
| --- | --- |
| **Result** | **Pass** for a false green. **P2** for stacked jobs (below). |
| **Evidence** | `push` is limited to `main`. `pull_request` is limited to `main` and uses the default types (`opened`, `synchronize`, `reopened`), not `closed`. There is no `concurrency` key. |
| **Failure mode checked** | Every PR commit runs twice, or a finished older job marks a newer head green. An attacker with a branch multiplies that. |
| **Why the usual double-run does not happen** | A push to a PR branch is not a push to `main`, so only `pull_request` starts. Merging to `main` is a `push`. Closing the PR does not start this workflow. One event, one job, for those two paths. |
| **Why an old job cannot greenwash** | Each run is tied to the SHA that triggered it. A job still running for an older SHA does not satisfy the head SHA. Cancelling it is not required for the check to mean the right commit. |

### C2 — `persist-credentials` and self-hosted reuse

| | |
| --- | --- |
| **Result** | **Pass** on the runner this file selects. |
| **Evidence** | `actions/checkout@v4` is called with no `persist-credentials` input, so the default `true` is what the log recorded. `runs-on` is `ubuntu-latest`. The `8632c81` job identifies **Hosted Compute Agent** and image **ubuntu-24.04**, not a self-hosted label. Token scopes on that job are contents read and metadata read. |
| **Failure mode checked** | The checkout leaves a credential on disk that a later job on the same machine can use to push. |
| **Why it does not apply here** | GitHub-hosted `ubuntu-latest` VMs are destroyed at the end of the job. The persisted extraheader cannot outlive that VM. The token cannot write contents, so a `git push` from a later step in the same job is rejected. The same read token is already in the `GITHUB_TOKEN` environment; the git config is not a second privilege. This file does not target a self-hosted runner. A later edit that changed `runs-on` to a dirty self-hosted label would make the default matter. That edit is not in this diff. |

### C3 — Diff against `main`

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff origin/main...8632c81 --name-only` is `.github/workflows/ci.yml`, `README.md`, `docs/CR1_CI_SMOKE_ATTACKS.md`, and `docs/CR2_CI_SMOKE_ATTACKS.md`. No `src/`, `test/`, prices, brake, exhaust, or commercial files. |

### C4 — `npm test` glob versus suite files

| | |
| --- | --- |
| **Result** | **Pass** for files that exist today. **P2** for the shape of the glob (below). |
| **Evidence** | The script is `node --test test/*.test.ts`. Every file under `test/`, `src/`, and `scripts/` that imports `node:test` is one of: `brake.test.ts`, `brake-cr3.test.ts`, `estimate.test.ts`, `ledger.test.ts`, `sdk.test.ts`, `sidecar.test.ts`, `upstream.test.ts`. All seven match that glob. `test/helpers.ts` exports boot helpers and does not register tests. There is no `*.spec.ts` and no nested `test/` directory. The green run executed **74** tests and failed **0**. |
| **Failure mode checked** | A suite the product already ships is left out of CI and the job still passes. |
| **Empty glob** | The pattern is unquoted. If it matched nothing, `sh` on the runner would pass the literal `test/*.test.ts` through and `node --test` would fail the step. Today it matches seven files. |

### C5 — Secrets and token elevation

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The workflow has no `env` block and no `secrets` context. `permissions` is `contents: read` at the top, which sets every other `GITHUB_TOKEN` scope to none except Metadata read. A step cannot raise that. The `8632c81` log matches: contents read, metadata read, and no other token scope. `Cache mode: write` is the runner cache service already recorded in CR2, not a contents write. |

---

## P2 left open

### P2-1 — No `concurrency` cancel

Rapid pushes to an open PR start a new `pull_request` job each time and leave the older ones running. That spends runner minutes after the head has moved. It does not mark the new head green. Not added here. A cancel group would be a behavior change to a check that is already per-SHA.

### P2-2 — Test glob is one directory level

`test/*.test.ts` will not see `test/<dir>/*.test.ts`. Nothing in the tree is nested today, so the current 74 tests all run. A suite added under a subdirectory would be skipped while this job stayed green. The script is pre-existing; this pass does not change it.

---

## Verdict

**APPROVE.** No P0. No P1. P2-1 and P2-2 stay open, as do the CR1 and CR2 P2s. Do not merge from this review. `8632c81` Actions is success on GitHub-hosted Ubuntu with a contents-read token. Credential persistence is not a cross-job leak on that runner.
