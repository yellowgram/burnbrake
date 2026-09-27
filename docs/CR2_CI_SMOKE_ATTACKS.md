# BurnBrake — Code Review ×2 (CR2) Attack Log — CI smoke

**Pass:** second hostile review. Does not re-open the CR1 catalog except to note those P2s are still open.
**PR:** https://github.com/yellowgram/burnbrake/pull/6 (`cursor/ci-smoke-workflow-9fac`)
**Head reviewed:** `250cf2089b8df8512bcdf28e4e160ef5737db9d6`
**Date:** 2026-09-27
**Scope:** workflow file, README Tests pointer, and the CR1 log as part of the diff. This file is the only addition from this pass.
**Stance:** artifact and OIDC minting, reusable-workflow injection, npm cache restore, and whether the README sentence over-claims what CI gates.
**Outcome:** No P0. No P1. Three new P2 limits, left open. **Verdict: APPROVE.** Workflow file not changed.

Actions run [36289767663](https://github.com/yellowgram/burnbrake/actions/runs/36289767663) on `250cf20` (`pull_request`) concluded **success**. Node **v22.23.2**. Tests **74 pass / 0 fail**. Artifacts uploaded: **0**.

Polar stays dark. Soft-WTP stays off. Exhaust contract was not edited.

CR1 P2s still open and not re-counted here: unpinned `actions/*@v4`, no path filters, no `timeout-minutes`.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | This file can upload artifacts, mint OIDC, or write `main` with the token it requests. |
| **P1** | A green check can mean demo, Polar, or a drifted install was verified, or a failed test still passes the job. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 3 | 0 | 3 |

---

## Attack catalog

### B1 — Artifacts, upload, OIDC

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Workflow `permissions` is only `contents: read`. The job log lists `Contents: read` and `Metadata: read` (Metadata is always granted). It does not list `actions`, `id-token`, `packages`, `pull-requests`, or `contents: write`. No `upload-artifact`, no `environment:`, no `permissions.id-token`. Run artifacts API: `total_count` 0. `dist/` from `npm run build` is not uploaded. |
| **Failure mode checked** | A pull request uses this workflow to publish an artifact, push the tree, or assume a cloud role via OIDC. |
| **Why it fails closed** | The token this file requests cannot write contents and cannot request an OIDC token. Official artifact upload needs `actions: write`, which is unset (none). |
| **Residual** | `pull_request` runs the workflow from the PR. A later commit that edits `permissions` could request `id-token: write` or `actions: write`, up to the repository cap. That edit would be a visible diff. This PR does not do it. Do not add secrets or `id-token` to this file. |

### B2 — Matrix and reusable workflows

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | One job, `smoke`. No `strategy`, no `workflow_call`, no job-level `uses:`, no `secrets: inherit`. The only `uses:` lines are `actions/checkout@v4` and `actions/setup-node@v4`. The file contains no `${{ }}` expressions, so the PR title, body, and head ref are not interpolated into a shell step. |
| **Failure mode checked** | An attacker-controlled reusable workflow ref or matrix cell runs with this job's token. |

### B3 — `cache: npm` poisoning

| | |
| --- | --- |
| **Result** | **Pass** for install integrity. **P2** for the extra write channel (below). |
| **Evidence** | `actions/setup-node` cache key on this run: `node-cache-Linux-x64-npm-2d69960ff73f37b8b2332035dff15c7226862c677394c517f29da98d84e22711`. Primary-key hit, so the post step did not save a new entry. `npm ci` still checks the lockfile integrity hashes (`package-lock.json` is lockfileVersion 3 at the repo root). The job log also says `Cache mode: write`. That is the runner cache service, not a `GITHUB_TOKEN` scope. |
| **Failure mode checked** | A bad cache on `ubuntu-latest` makes `npm ci` install bytes the lockfile did not pin, or a PR overwrites `main`'s cache entry. |
| **Why install still matches the lockfile** | The key includes a hash of the lockfile. A different lockfile is a different key. Restored tarballs that do not match lockfile integrity fail `npm ci`. A pull-request cache is not the entry `main` restores before that PR is merged. The only install scripts in the current lockfile that set `hasInstallScript` are `esbuild` (runs on Linux) and `fsevents` (optional, darwin). Both are lockfile-pinned. |

### B4 — README wording (demo / Polar)

| | |
| --- | --- |
| **Result** | **Pass** as a false claim. **P2** for adjacency (below). |
| **Evidence** | Under Tests, a local block lists `npm test` and `npm run demo`. The next sentence is: "Pull requests and pushes to `main` run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on Node 22." Polar, Docker, and `npm run demo` are not in that list. Known limits still say the listing is not Polar-ready. |
| **Failure mode checked** | An operator treats a green check as proof that the demo ran or that Polar packaging was gated. |
| **Why it is not a false gate** | The sentence names four commands. It does not say the block above is what CI runs, and it does not mention Polar. |

### B5 — Diff is still CI-only

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff origin/main...250cf20 --name-only` is `.github/workflows/ci.yml`, `README.md` (the one Tests sentence), and `docs/CR1_CI_SMOKE_ATTACKS.md`. No `src/`, `test/`, `prices/`, brake, exhaust, or commercial files. |

### B6 — What a green typecheck actually covers

| | |
| --- | --- |
| **Result** | **P2** (below). Not a job that stays green after `tsc` fails. |
| **Evidence** | `npm run typecheck` is `tsc -p tsconfig.json --noEmit`. `tsconfig.json` `include` is `src/**/*.ts` only. `npm test` runs `test/*.test.ts` through `tsx`, which does not apply that project. |
| **Failure mode checked** | A type error under `src/` is ignored. It is not: `tsc` on `src/` still fails the step. A type error that exists only in a test file is outside that command. The workflow runs the script as defined. It does not claim tests are part of `tsc`. |

---

## P2 left open

### P2-1 — Demo sits next to the CI sentence

`npm run demo` is in the Tests block directly above the CI sentence. The sentence does not say CI skips the demo, Docker, and Polar. A skim can attach the demo line to the gate. The sentence itself is accurate. Not edited in this pass.

### P2-2 — Runner cache write is wider than `contents: read`

`cache: npm` gives the job cache-service write (`Cache mode: write` on the same run whose token is contents-read). It does not upload artifacts or mint OIDC, and it does not bypass lockfile integrity. A branch can still consume repository cache quota. Not removed in this pass. Dropping the cache would only slow a 7-package install.

### P2-3 — Green typecheck does not typecheck tests

`tsc` includes `src/**/*.ts` only. Test files are executed, not typechecked. Closing that would mean changing `tsconfig` or the typecheck script, which is outside this workflow diff. Left as a limit of what the smoke check proves.

---

## Verdict

**APPROVE.** No P0. No P1. P2-1, P2-2, and P2-3 stay open, as do the three CR1 P2s. Do not merge from this review. A green run is install, `tsc` on `src/`, unit tests, and `tsc` emit. It is not a demo, Polar, or Soft-WTP gate.
