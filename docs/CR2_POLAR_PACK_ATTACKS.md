# BurnBrake — Code Review ×2 (CR2) Attack Log — Polar pack v0.1.0

**Pass:** second hostile review. CR1 is not the evidence.
**PR:** https://github.com/yellowgram/burnbrake/pull/7 (`cursor/polar-ready-v010-3c0d`)
**Head reviewed:** `1745516d3b65a249c28e378a0919abb25464d612`
**Date:** 2026-09-27
**Scope:** Polar paste and CoS steps in `docs/POLAR_DELIVERABLES.md`, version strings, the sealed zip’s install paths (`npm ci`, `npm ci --omit=dev`, `NODE_ENV=production`), and `git diff origin/main...1745516`.
**Stance:** wrong price, missing refund or seller, CoS told to make BurnBrake publish or to put a checkout URL in the README, demo that only works if a founder installs tsx, changelog/tag drift, hosted $49 as a required upsell, exhaust or Soft-WTP edited in the diff.
**Outcome:** No P0. No P1. Five P2 limits left open. **Verdict: APPROVE.** No zip member was edited. SHA-256 stays `3326cdb555a76e2437ff1c31ca0957ffc4bf4908837370bcb36f57266d36104c`.

This file is not a zip member (`docs/CR*` is not on the pack allowlist). After it was on disk, `bash scripts/pack-release.sh` still matched the digest above.

Polar stays unpublished. No GitHub Release was created. Soft-WTP stays off.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Paste copy sells $149 or $79, or the diff turns exhaust retryable / 429 or turns Soft-WTP on. |
| **P1** | A stranger who follows START_HERE / DEMO_60S / MINIMUM_SUPPORT cannot finish the 60s proof without a founder, or CoS steps tell BurnBrake to publish Polar or to add a checkout URL. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 5 | 0 | 5 |

---

## Attack catalog

### B1 — Paste price, refund, seller

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The listing block in `docs/POLAR_DELIVERABLES.md` (through the CoS checklist) contains `$199` eight times, `14 days` four times, `Suthirth` five times, and `$49` five times. It contains zero `$149`, `$79`, or `$29`. The price table row is `$199 once`, refund `14 days`, seller `Suthirth solutions`. Inside the zip, the only file with `$149`, `$79`, or `$29` is `docs/COMMERCIAL_LOCK.md`, and those strings are the do-not-market lines (`Not $149. Not $79/mo as the plan.` and `Prior ~$149 / ~$29 draft strings are superseded`). |
| **Failure mode checked** | CoS pastes an old $149 / $79 price, or the listing forgets the 14-day refund or the seller. |
| **Why it is the lock** | The paste price is the founder lock. The old numbers appear only as superseded drafts. |

### B2 — CoS steps versus BurnBrake publishing

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The section is titled “CoS publish steps” and opens with “BurnBrake will not do these clicks.” The checklist waits for squash-merge, tags `v0.1.0` on that commit, requires `scripts/pack-release.sh` to match the committed digest, creates the GitHub Release, creates the Polar product under Suthirth solutions, sets `$199 once` and 14 days, attaches the release asset plus the SHA-256, keeps hosted $49 as a second product only if Polar requires one, then publishes and updates the yellowgram.dev card. The card step says “Do not add a checkout URL to the BurnBrake README.” No step assigns the Polar UI to this repository. |
| **Failure mode checked** | The checklist is missing price, refund, or seller, or it tells BurnBrake to click publish or to embed a checkout link. |
| **Why it stays CoS-owned** | Publish is one checkbox in a list this repo says it will not perform. |

### B3 — `src/` beside `dist/`, and who `npm run demo` actually runs

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `package.json` `demo` is `node --import tsx scripts/demo-60s.ts`. That script imports `../src/server.ts`. `tsx` is a devDependency, not a dependency. The zip ships both `src/` and `dist/` so the documented demo and `node dist/cli.js serve` both have their inputs. On an `npm ci --omit=dev` tree (1 package: `yaml`, no `tsx`), `node dist/cli.js serve` still came up. Health `version` was `0.1.0`, `mock_upstream.forward_count` started at 0, brake curve off. Allow returned HTTP 200. After the operator key lowered the run cap to spent, the next completion was HTTP 402 `BUDGET_EXHAUSTED`, `halt` true, `retryable` false. Operator decisions showed `upstream_forwarded` 0. |
| **Failure mode checked** | Shipping `src/` means the only working proof is a founder machine, or `dist/` does not enforce the deny. |
| **Why both trees are in the kit** | Demo needs `src/` and tsx. Serve needs `dist/` and `yaml`. The omit-dev serve test is the dist proof. It does not need tsx. |

### B4 — `npm ci` without devDependencies

| | |
| --- | --- |
| **Result** | **Pass** for the documented path. The omit path fails on purpose. |
| **Evidence** | Unpacked the sealed zip. `NODE_ENV` was unset. `npm ci` added 7 packages and `npm run demo` printed allow HTTP 200, deny HTTP 402 `BUDGET_EXHAUSTED`, `mock_forward_count=1` on both, `upstream_forwarded=0`, `demo ok`. The same tree with `npm ci --omit=dev` added 1 package and `npm run demo` exited 1: `Cannot find package 'tsx'`. `NODE_ENV=production npm ci` did the same (1 package, demo exit 1). START_HERE, DEMO_60S, and MINIMUM_SUPPORT tell the buyer to run `npm ci` and not to pass `--omit=dev` for the demo. |
| **Failure mode checked** | The stranger commands in those three docs cannot complete the 60s proof unless someone else installs tsx. |
| **Why this is not a founder gate** | Plain `npm ci` installs devDependencies. That is the command those docs give. `--omit=dev` and `NODE_ENV=production` are extra. They break demo and leave `dist/` serve working. See P2-1. Not changed: moving `tsx` into `dependencies`, or rewriting the demo onto `dist/`, would reseal the zip to cover a path the docs already tell the buyer not to use. |

### B5 — Changelog, package version, tag

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Zip `package.json` `version` is `0.1.0`. Zip `package-lock.json` top-level `version` and `packages[""].version` are `0.1.0`. `CHANGELOG.md` heading is `## 0.1.0` with no `Unreleased` section. Health from `dist/cli.js` reported `"version":"0.1.0"`. Docs name the git tag `v0.1.0`. `git tag -l v0.1.0` on this branch is empty. The tag is the post-merge step in the CoS checklist, not a second version string. |
| **Failure mode checked** | Changelog says 0.1.0 while the package or the built health string says something else. |
| **Why the missing tag is not drift** | The three version strings that ship in the zip agree. The tag is created from the squash commit after this PR, then the pack script must still match this digest. |

### B6 — Hosted $49 as Soft-WTP or a required upsell

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Paste sentence: “Hosted operation at $49/mo is optional and is not this product. Create it as a separate Polar product only if Polar requires one. It is not a coupon, a cold invoice, or Soft-WTP.” CoS step: do not fold $49 into the $199 SKU, do not add coupons, do not send cold invoices. `docs/COMMERCIAL_LOCK.md` in the zip: hosted is optional and “Not the day-1 primary plan.” README: “optional and not the day-1 plan.” |
| **Failure mode checked** | $49 is required to use the zip, or it is worded as a discount / Soft-WTP concession. |
| **Why the primary SKU stays $199** | Hosted is a separate product the seller adds only when Polar needs a second SKU. The zip does not contain it. |

### B7 — Full diff: exhaust, Soft-WTP, checkout URL

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff --name-only origin/main...1745516` is docs, `CHANGELOG.md`, `README.md`, `package.json` (one `pack` script), `scripts/pack-release.sh`, and `checksums/`. No `src/`, `test/`, or `prices/` path. Zip grep for `polar.sh` is empty. Soft-WTP lines in the diff are “off”, “none”, or “forbidden”. `src/ledger.ts` on this tree still denies with `httpStatus: 402` and `BUDGET_EXHAUSTED`. The dist serve in B3 returned `retryable` false. |
| **Failure mode checked** | The pack commit softens exhaust, enables Soft-WTP, or adds a checkout URL. |
| **Why the product bytes are the pre-pack bytes** | The diff does not touch the emitter. The serve probe used the zip’s `dist/`, not a hand-patched tree. |

---

## P2 limits (not changed)

### P2-1 — DevDependencies and `NODE_ENV=production`

`npm ci --omit=dev` and `NODE_ENV=production npm ci` both install only `yaml`. `npm run demo` then exits 1 because `tsx` is missing. `node dist/cli.js serve` still 402s. The stranger docs forbid `--omit=dev` and do not mention `NODE_ENV`. A shell that already exports `NODE_ENV=production` will follow `npm ci` and still miss `tsx`. The fix on that shell is `npm ci --include=dev`. Not edited. Editing START_HERE to add that sentence would change the zip and the digest.

### P2-2 — `npm test` in the zip is an empty green

`test/` is not in the archive. After a full `npm ci`, `npm test` printed `# tests 0` and exited 0. The 60s demo is the stranger proof and it fails closed. The empty unit-test run does not. Not edited.

### P2-3 — Demo and serve are different trees

`npm run demo` executes `src/` through tsx. `serve` executes `dist/`. This pass ran both against the sealed zip and both denied with `upstream_forwarded` 0. A buyer who edits `src/` and does not run `npm run build` will demo the edit and serve the old `dist/`. Not edited.

### P2-4 — Tag `v0.1.0` is not on this branch

Version strings match. The annotated tag is still the post-merge command. Cutting it here would publish a tag before squash-merge. Not done.

### P2-5 — Superseded prices remain in the commercial lock

`$149`, `$79/mo`, and `~$29` stay in `docs/COMMERCIAL_LOCK.md` as the do-not-market lines. They are not the paste price. Deleting them would reseal the zip. Not edited.

CR1’s P2-1 through P2-8 stay open. This pass did not close them and did not treat that log as a new test.

---

## What this pass did not do

- Did not `--write` checksums
- Did not change a zip member
- Did not merge PR #7
- Did not create the GitHub Release
- Did not publish Polar

**APPROVE.** No P0. No P1. P2-1 through P2-5 stay open. The documented stranger command remains `npm ci` then `npm run demo`.
