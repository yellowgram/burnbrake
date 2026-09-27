# BurnBrake — Code Review ×1 (CR1) Attack Log — CI smoke

**Pass:** hostile review of the smoke workflow only
**PR:** https://github.com/yellowgram/burnbrake/pull/6 (`cursor/ci-smoke-workflow-9fac`)
**Head reviewed:** `ed523be257b24444d1f3418b7de668cae006069d`
**Date:** 2026-09-27
**Scope:** `.github/workflows/ci.yml` and the README Tests pointer. No other files in that commit.
**Stance:** token scope, untrusted `pull_request` execution, install drift, Node vs `engines`, false greens, and product-lock bleed.
**Outcome:** No P0. No P1. Three P2 limits left open. **Verdict: APPROVE.** Workflow file not changed in this pass.

Actions run [36289606218](https://github.com/yellowgram/burnbrake/actions/runs/36289606218) on `ed523be` (`pull_request`) concluded **success**. Job log: `GITHUB_TOKEN` Contents read, Metadata read; Node **v22.23.2**; `npm ci` added 7 packages; tests **74 pass / 0 fail / 11 suites**.

Polar stays dark. Soft-WTP stays off. Exhaust contract was not edited.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | This workflow can write the repo, receive secrets, or hand a fork a token that changes `main`. |
| **P1** | Typecheck or tests can fail while the check stays green, or install can drift off the lockfile. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 3 | 0 | 3 |

---

## Attack catalog

### A1 — Token scope and secrets

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Top-level `permissions: contents: read`. Specifying `permissions` sets every other scope to none except Metadata, which GitHub always grants as read. The job log shows only `Contents: read` and `Metadata: read`. No `secrets.*`, no `env:` block, no `id-token`, no artifact upload. Checkout token is masked. |
| **Failure mode checked** | A step or a test could push to `main`, open a release, or print a repo secret. |
| **Why it fails closed** | The token cannot write contents. This file references no secrets, so there is nothing for a step to echo. `persist-credentials` stays at the checkout default (`true` on this same-repo PR). That stores the same read token in `.git/config`. It does not add write. |

### A2 — Fork and untrusted pull requests

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Trigger is `pull_request` to `main`, not `pull_request_target`. Checkout ran with `allow-unsafe-pr-checkout: false`. No expression interpolates the PR title, body, or head ref into `run:`. |
| **Failure mode checked** | A fork PR runs with the base workflow's secrets, or checkout persists a write token into an untrusted tree. |
| **Why it fails closed** | `pull_request` from a fork does not receive secrets, and this file defines none. Checkout refuses the unsafe credential persist on fork PRs. Private repositories do not run fork workflows unless an admin turns that setting on. This PR does not change that setting. Residual, accepted: if that setting is enabled later, a fork can edit this file in the PR and exfiltrate the checkout of private source. The token would still be contents-read. Do not add secrets to this workflow. |

### A3 — `npm ci` versus install drift

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `package-lock.json` is at the repo root (`lockfileVersion` 3). The install step is `npm ci` with no `npm install` fallback. Default working directory after checkout is the repo root. One `package.json`. The Actions install log is `added 7 packages`. |
| **Failure mode checked** | A missing or stale lockfile still installs a floating tree and the check goes green. |
| **Why it fails closed** | `npm ci` exits non-zero when the lockfile is absent or does not match `package.json`. There is no second install path. |

### A4 — Node versus `engines`

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `engines.node` is `>=22.13`. The workflow sets `node-version: 22`. The job installed **v22.23.2**, which satisfies the floor. `npm test` and `npm run typecheck` use that Node, not the runner image's Node. |
| **Failure mode checked** | Setup installs 22.0–22.12 and the suite still passes under an engine the package rejects. |
| **Why it is acceptable** | `actions/setup-node` resolves major `22` to the latest 22.x. That line is past 22.13. `npm ci` does not set `engine-strict`; a future resolver bug that picked an old 22 would warn rather than fail. Not observed. Not changed. |

### A5 — Fail-fast and greenwash

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Four steps in order: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. No `continue-on-error`, no `if: always()`, no `|| true`, no matrix. `npm test` is `node --test` (non-zero on failure). Both `tsc` scripts are non-zero on type errors. |
| **Failure mode checked** | A failed typecheck or test is swallowed and a later step marks the job green. |
| **Why it fails closed** | A failed step fails the job and skips the rest. Build cannot repaint a red test run. |

### A6 — Product, spend path, Polar, Soft-WTP, exhaust

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff origin/main...ed523be` is `.github/workflows/ci.yml` (new, 36 lines) and two lines in `README.md` under Tests. No `src/`, `test/`, `prices/`, commercial docs, or brake files. The README sentence lists `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on Node 22. It does not claim the demo, Docker, Polar, or a changed exhaust contract. |
| **Failure mode checked** | The CI PR silently edits 402 / `BUDGET_EXHAUSTED` / halt / retryable, brake defaults, Soft-WTP, or commercial strings. |

### A7 — Skip and disable

| | |
| --- | --- |
| **Result** | **Pass** (no bypass added) |
| **Evidence** | Triggers are `pull_request` and `push` to `main` only. No `if: false`, no `workflow_dispatch`-only gate, no path filter that can drop the workflow file. |
| **Failure mode checked** | This PR ships a switch that lets later commits skip the check without a visible workflow edit. |
| **Note** | GitHub's own `[skip ci]` trailer can skip `push` and `pull_request` runs. That is platform behavior. This file does not add a second skip. Out of scope. |

---

## P2 left open

### P2-1 — Actions are major tags, not commit SHAs

`actions/checkout@v4` and `actions/setup-node@v4` float. On this run they resolved to `11d5960a326750d5838078e36cf38b85af677262` and `49933ea5288caeca8642d1e84afbd3f7d6820020`. The job also warned that both still target Node.js 20 and were forced onto Node.js 24. The project toolchain was Node v22.23.2; the warning is about the action runtime. A moved tag could change checkout or setup behavior. Not SHA-pinned here.

### P2-2 — No path filters

Every pull request to `main` and every push to `main` runs the job, including docs-only edits. The observed job was about 27 seconds. A path filter could skip CI when the workflow, lockfile, or `package.json` scripts change if the filter is wrong. Left unfiltered on purpose.

### P2-3 — No job timeout

`smoke` does not set `timeout-minutes`. A hung `npm test` holds the runner until GitHub's default (6 hours). That wastes minutes. It does not turn a failure into success. The observed run finished in under a minute.

---

## Verdict

**APPROVE.** No P0. No P1. P2-1, P2-2, and P2-3 stay documented. Do not merge from this review. Do not treat a green smoke check as a product or Polar gate.
