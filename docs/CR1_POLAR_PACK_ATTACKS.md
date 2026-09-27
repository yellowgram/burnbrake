# BurnBrake — Code Review ×1 (CR1) Attack Log — Polar pack v0.1.0

**Pass:** hostile review of the self-host kit seal only
**PR:** https://github.com/yellowgram/burnbrake/pull/7 (`cursor/polar-ready-v010-3c0d`)
**Head reviewed:** `189b000d41820c79a203f0420ff199215bdb819f`
**Date:** 2026-09-27
**Scope:** `scripts/pack-release.sh`, `checksums/burnbrake-0.1.0.sha256`, `checksums/burnbrake-0.1.0.manifest.txt`, `docs/POLAR_DELIVERABLES.md`, and the 73 members of `burnbrake-0.1.0.zip`. Product sources under `src/` were not in the pack diff.
**Stance:** secrets in the zip, digest drift, stranger-path lies, Soft-WTP smuggling, exhaust softening, hosted $49 as day-1, non-deterministic bytes, demo that fails to prove `upstream_forwarded` false.
**Outcome:** No P0. No P1. Eight P2 limits left open. **Verdict: APPROVE.** Zip bytes were not changed in this pass. SHA-256 stays `3326cdb555a76e2437ff1c31ca0957ffc4bf4908837370bcb36f57266d36104c`.

This file is not a zip member. The pack allowlist does not include `docs/CR*`. After this file was on disk, `bash scripts/pack-release.sh` still matched the digest above (73 files). Adding it does not reseal the kit.

Polar listing stays unpublished. Soft-WTP stays off. Exhaust contract was not edited. No GitHub Release was created.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | The zip can ship a live secret, a real `.env`, or a provider key, or the digest CoS will paste does not match the zip the script builds. |
| **P1** | A buyer following START_HERE / README / MINIMUM_SUPPORT is told the listing is already live, is given a checkout URL, is told exhaust is retryable or 429, or the unpacked demo does not prove the deny skipped upstream. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 8 | 0 | 8 |

---

## Attack catalog

### A1 — Secrets, real `.env`, provider keys, `node_modules`, `.git`

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Rebuilt zip is 155429 bytes, 73 members. Names contain no `node_modules`, no `.git`, no `*.sqlite`, no `POLAR_DELIVERABLES`, no `CR*` / `DR*` / `LAUNCHGATE`. The only name containing `.env` is `burnbrake-0.1.0/config.example.env`. Its live lines are `BURNBRAKE_KEY=bb_replace_me` and `BURNBRAKE_OPERATOR_KEY=bb_operator_replace_me`. `OPENAI_API_KEY=sk-replace-me-not-the-burnbrake-key` is a comment. A scan of every member for `sk-proj-`, `sk-live-`, `sk-` plus 20 alphanumerics, `ghp_`, `github_pat_`, `AKIA`, `BEGIN … PRIVATE KEY`, and Slack tokens found none. `git diff origin/main...189b000 -- src test prices` is empty, so no new key material landed in product code. |
| **Failure mode checked** | The buyer zip carries a live provider key, a filled `.env`, git history, or a `node_modules` tree. |
| **Why it fails closed** | `scripts/pack-release.sh` builds from an allowlist, then refuses `.git`, `node_modules`, `data`, `checksums`, `test`, a file named `.env`, sqlite sidecars, and the private-key / `sk-proj-` / `sk-live-` / `AKIA` markers. |

### A2 — Checksum file and Polar paste versus a rebuild

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `bash scripts/pack-release.sh` on `189b000` printed `SHA-256 matches checksums/burnbrake-0.1.0.sha256` and `3326cdb555a76e2437ff1c31ca0957ffc4bf4908837370bcb36f57266d36104c`. The checksum file is that digest, two spaces, `burnbrake-0.1.0.zip`, and a trailing newline. Every 64-hex digest in `docs/POLAR_DELIVERABLES.md` is that same string (five copies). The fenced member list in that file equals `checksums/burnbrake-0.1.0.manifest.txt` (73 lines, same order). |
| **Failure mode checked** | CoS pastes a digest that is not the zip the script just wrote. |
| **Why it fails closed** | Default mode of the script exits non-zero on a digest or manifest mismatch. It does not `--write` unless asked. This pass did not pass `--write`. |

### A3 — Stranger path: draft 402, listing already live, checkout URL

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Grep of all 73 zip members: zero hits for `draft 402`, `draft HTTP`, or ``draft `402` ``. Zero hits for `polar.sh`, `checkout.polar`, `buy.polar`. Zero hits for “listing is live”. README, `docs/START_HERE.md`, `docs/MINIMUM_SUPPORT.md`, `docs/SUPPORT.md`, and `docs/COMMERCIAL_LOCK.md` say the listing is **not** live and that Suthirth solutions publishes after founder GO. README states it has no checkout URL. MINIMUM_SUPPORT step 6 and the 60s table say HTTP **402** `BUDGET_EXHAUSTED`, halt, not retryable, not 429. |
| **Failure mode checked** | A zip buyer is told exhaust is still a draft status, or that Polar is already on, or is handed a checkout link in the README. |
| **Why it is not a false ship** | “Kit ready” in those files is the pack status. The same sentences say the listing is not live. |

### A4 — Soft-WTP, coupons, cold invoices in the Polar paste

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/POLAR_DELIVERABLES.md` sets Soft-WTP / coupons / cold invoices to **none**, tells CoS not to add coupons and not to send cold invoices, and repeats that in the release notes. Zip-wide, `coupon` (5) and `cold invoice` (6) occur only in those prohibitions (`COMMERCIAL_LOCK`, `MINIMUM_SUPPORT`, `SUPPORT`, and the same sentences’ sources). No `promo` or `discount` string. No coupon code. |
| **Failure mode checked** | The paste-ready listing offers a discount, a coupon, or a cold invoice. |
| **Why it fails closed** | The commercial lock in the zip still forbids Soft-WTP / coupons / cold invoices. The paste copy does not add a price other than $199 once and the optional hosted line. |

### A5 — Exhaust softened

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff origin/main...189b000` does not touch `src/`, `test/`, or `prices/`. `src/ledger.ts` still returns `BUDGET_EXHAUSTED` with `httpStatus: 402`. `src/errors.ts` defaults `retryable` to false. `src/sdk/index.ts` sets `BudgetExhausted.retryable = false` and `httpStatus = 402`. `src/brake.ts` rejects `halt_mode` and `exhaust.retryable` (`BrakeConfigError`). The one `retryable: true` inside the zip is the forbidden list in `docs/DESIGN_BRAKE_CURVE.md`, not a default. `brake.enabled` still defaults to `false` in `src/brake.ts`. |
| **Failure mode checked** | The pack flips exhaust to retryable, to 429, or to a `halt_mode` switch. |
| **Why it fails closed** | Those keys are refused at config load. The pack commit does not edit the bytes that emit 402. |

### A6 — Hosted $49 as required day-1 or as Soft-WTP

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Nine `$49` mentions in the zip. Each one says optional, not the day-1 primary, or not in the zip (`README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MINIMUM_SUPPORT.md`, `docs/MVP_SCOPE.md`). Polar paste: “Hosted operation at $49/mo is optional and is not this product. Create it as a separate Polar product only if Polar requires one. It is not a coupon, a cold invoice, or Soft-WTP.” |
| **Failure mode checked** | The $199 buyer is told they must take $49/mo, or hosted is described as a willingness-to-pay concession. |
| **Why it is the lock** | Primary SKU in the same paragraphs remains $199 once. Seller remains Suthirth solutions. Refund remains 14 days. |

### A7 — Pack script non-determinism after squash-merge

| | |
| --- | --- |
| **Result** | **Pass.** Rebase is **not** required. |
| **Evidence** | Every `ZipInfo` in the rebuilt archive has `date_time == (1980, 1, 1, 0, 0, 0)`, empty `extra`, `create_system == 3`, and the data-descriptor flag clear. No member contains `/workspace`, `/home/`, or `/Users/`. Source map `sources` stay relative (`../src/cli.ts` on `dist/cli.js.map`). The script does not read `git rev-parse` or the clock. A second `bash scripts/pack-release.sh` on this same tree matched the committed digest. This PR is one commit on `main`; a squash-merge that does not edit file bytes keeps that tree. The zip is not a git blob. It is rebuilt from the tree. |
| **Failure mode checked** | Timestamps or absolute paths make the digest differ on the merge commit even though the packed files did not change. |
| **Why a rebase is the wrong fix** | The digest is a function of file bytes plus this zip writer, not of the commit id. Rebase does not stabilize zlib. If a later machine’s Python disagrees, the script exits non-zero. Stop. Do not `--write`. Do not publish. See P2-2. |

### A8 — Unpacked demo and `upstream_forwarded`

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Unzipped `dist/release/burnbrake-0.1.0.zip` to a clean directory and ran `npm ci && npm run demo` (Node v22.14.0). Output: allow HTTP 200, `mock_forward_count=1`; deny HTTP 402 `BUDGET_EXHAUSTED` scope `run`, `mock_forward_count=1`; `45–60s decision upstream_forwarded=0`. `scripts/demo-60s.ts` asserts `denied.upstream_forwarded === 0` and sets a non-zero exit if that fails. The ledger stores the flag as 0/1. Zero is the false the README requires on a deny. |
| **Failure mode checked** | The zip’s demo cannot run, or a deny still increments the mock upstream. |
| **Why it proves the gate** | Forward count stayed 1 across the deny, and the decision row recorded `upstream_forwarded=0`. |

---

## P2 limits (not changed)

### P2-1 — `sha256sum -c` from the repo root

The checksum line names `burnbrake-0.1.0.zip`. The script writes `dist/release/burnbrake-0.1.0.zip`. `sha256sum -c checksums/burnbrake-0.1.0.sha256` from the repo root looks for the zip in the current directory and reports a missing file. That is not a digest mismatch. The script compares the hex itself. Not changed.

### P2-2 — zlib is part of the digest

Seal toolchain: Node v22.14.0, Python 3.12.3, zlib 1.3, TypeScript from `package-lock.json`. Deflate output can differ on another zlib even when the members are identical. The script then fails closed. Do not rebase and do not `--write` to chase that. A squash-merge of this tree does not by itself require a new digest.

### P2-3 — Public placeholders in `config.example.env`

`bb_replace_me` and `bb_operator_replace_me` ship on purpose. The commented `sk-replace-me-not-the-burnbrake-key` is not a live provider key. Compose publishes `127.0.0.1:8787` and sets `BURNBRAKE_MOCK_UPSTREAM=1`. Not changed.

### P2-4 — Demo key in the kit

`scripts/demo-60s.ts` uses `bb_demo_key` and `bb_demo_operator` for a process that binds an ephemeral port and a temp ledger. They are not provider keys. Not changed.

### P2-5 — “draft 30d” is still in the zip

`docs/MVP_SCOPE.md` and `docs/OPERATOR_NEEDS.md` still say “draft 30d” for the stale price-table warn. `src/constants.ts` sets `STALE_PRICE_DAYS = 30`. That phrase is not “draft 402”. Editing it would change zip bytes and the digest. Deferred.

### P2-6 — The script does not parse the Polar doc

This pass, the Polar digests match the checksum file. The script never opens `docs/POLAR_DELIVERABLES.md`. A later hand edit could desync the paste copy from `checksums/`. Deferred.

### P2-7 — Older attack logs still say there is no zip

`docs/CR*`, `docs/DR*`, and the LaunchGate briefs still describe an earlier “Polar dark / no zip” state. They are not in the buyer zip. They stay as the record of those passes. Deferred.

### P2-8 — Brake-curve status line still says “this PR”

`docs/DESIGN_BRAKE_CURVE.md` keeps “Implemented on this PR” from the curve amendment. The same file now says the curve ships in the v0.1.0 kit and that this file does not light Polar. Rewriting the old status line would reseal the zip. Deferred.

---

## What this pass did not do

- Did not `--write` checksums
- Did not change a zip member
- Did not merge PR #7
- Did not create the GitHub Release
- Did not publish Polar

**APPROVE.** No P0. No P1. P2-1 through P2-8 stay open. Ship the existing digest after squash-merge only if `scripts/pack-release.sh` on that commit prints the same SHA-256.
