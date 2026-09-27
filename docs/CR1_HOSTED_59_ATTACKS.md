# BurnBrake — Code Review ×1 (CR1) Attack Log — hosted optional $59/mo

**Pass:** hostile review of the docs-only hosted price string
**PR:** https://github.com/yellowgram/burnbrake/pull/8 (`cursor/hosted-optional-sku-59-f7af`)
**Head reviewed:** `6082235a73e7c5b7b5e497b81b2df120ee74eef9`
**Date:** 2026-09-27
**Scope:** the ten-file diff vs `main` that replaces hosted **$49/mo** with **$59/mo**. Not a re-audit of the sidecar, the brake curve, or the v0.1.0 pack script.
**Stance:** Soft-WTP / coupons / cold invoices smuggled; a checkout URL added to the README; exhaust softened; primary SKU drifted off $199; a refund invented for hosted; buyer-facing docs still stating hosted $49 as the current lock; Polar claimed live; the sealed v0.1.0 zip or checksums quietly resealed; historical CR attack logs rewritten so the prior $49 evidence is gone.
**Outcome:** No P0. No P1. Four P2 limits left open. **Verdict: APPROVE.** Checksums were not written. SHA-256 of the published zip stays `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`.

This file is not a zip member. `scripts/pack-release.sh` refuses any `docs/CR*` name. Adding it does not reseal the kit.

Polar listing stays unpublished. Soft-WTP stays off. Exhaust contract was not edited. The GitHub Release `v0.1.0` was not edited. This pass did not merge PR #8.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | The diff turns Soft-WTP, a coupon, or a cold invoice into an offer; puts a Polar checkout URL in the README; makes exhaust retryable or 429; moves the primary SKU off **$199 once**; grants hosted a 14-day refund; rewrites `checksums/` or replaces the sealed zip; deletes the $49 evidence in `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, or `docs/CR2_BRAKE_CURVE_ATTACKS.md`; or states that the Polar listing or the hosted product is already live. |
| **P1** | A buyer-facing current-lock doc still states hosted **$49** as the price now: `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/MINIMUM_SUPPORT.md`, or the paste block in `docs/POLAR_DELIVERABLES.md`. |
| **P2** | Real limit. Documented. Not changed in this pass. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 4 | 0 | 4 |

---

## Attack catalog

### A1 — Soft-WTP, coupons, or cold invoices smuggled

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The diff is 29 added lines and 28 removed lines. Added and removed line counts match for `Soft-WTP` (7), `coupon` (4), and `cold invoice` (4). Every one of those added lines is a prohibition. The new CoS step still says “Do not add coupons. Do not send cold invoices. Soft-WTP stays off.” The paste sentence still says the hosted line “is not a coupon, a cold invoice, or Soft-WTP.” `docs/COMMERCIAL_LOCK.md` still lists “Soft-WTP / coupons / cold invoices” under **Do not**. No promo code, no percent-off, no “discount” string was added. |
| **Failure mode checked** | Hosted $59 is worded as a concession, a coupon, or a cold invoice against the $199 kit. |
| **Why it fails closed** | The new price sits next to the same ban. Soft-WTP in the lock header is still **OFF**. |

### A2 — Checkout URL added to the README

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The README hunks replace `**$49/mo**` with `**$59/mo**` in two sentences and change nothing else. The first sentence still says “this file has no checkout URL.” The CoS card step still says “Do not add a checkout URL to the BurnBrake README.” README URLs are `https://api.openai.com` and `http://127.0.0.1:8787` only. Zero hits for `polar.sh`, `checkout.polar`, or `buy.polar` in the diff. |
| **Failure mode checked** | A buyer is handed a Polar checkout link from the README. |
| **Why it fails closed** | The commercial lock still forbids a checkout URL in the README. This diff does not add one. |

### A3 — Exhaust softened

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff --name-only origin/main...6082235` is ten markdown files. It does not touch `src/`, `test/`, `prices/`, or `scripts/`. Added lines contain zero `retryable` and zero `429`. `docs/COMMERCIAL_LOCK.md` still says HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable**. The Polar exhaust section was not in the hunk. |
| **Failure mode checked** | The price edit flips exhaust to retryable, to 429, or to a halt-off switch. |
| **Why it fails closed** | The bytes that emit 402 were not in the diff. |

### A4 — Primary SKU drifted off $199

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `$199` appears on 20 added lines and 20 removed lines. The primary row in `docs/COMMERCIAL_LOCK.md` is not in the hunk: **$199 once**, “Not $149. Not $79/mo as the plan.” No added line contains `$149`, `$79`, or `$29`. Hosted is still “Not the day-1 primary plan” and “not this product.” |
| **Failure mode checked** | The $199 kit becomes $59, or hosted becomes the day-1 plan. |
| **Why it is the lock** | Founder GO 2026-09-27 ET via Chief of Staff changes only the optional hosted price. |

### A5 — Refund invented for hosted

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The refund header in `docs/COMMERCIAL_LOCK.md` was not edited: “**14 days** (founder lock) — $199 self-host one-org kit.” README still says “Refund on the **$199** one-org kit is **14 days**.” The new CoS checkbox says “The 14-day refund stays on the $199 kit only.” Polar “Refund” field is still “**14 days** on the $199 kit.” No added sentence grants 14 days, or any refund window, to the hosted product. |
| **Failure mode checked** | Hosted $59/mo picks up the kit’s 14-day refund without a founder lock. |
| **Why it fails closed** | The new sentence narrows the existing window. It does not open a second one. |

### A6 — Buyer-facing docs still claim hosted $49 as the current lock

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Removed lines contain `$49` 28 times. Added lines contain `$49` zero times and `$59` 29 times. `rg -n '\$49'` on `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/MINIMUM_SUPPORT.md`, `docs/POLAR_DELIVERABLES.md`, `docs/DESIGN_PASS_1.md`, `docs/LAUNCHGATE_DR4_BRIEF.md`, `docs/SUPPORT.md`, and `docs/START_HERE.md` is empty. The hosted row is **$59/mo**. The paste sentence is “Hosted operation at $59/mo”. |
| **Failure mode checked** | A stranger reading the git lock, the README, or the Polar paste still sees hosted $49 as the price now. |
| **Why the leftovers are not this failure** | Remaining `$49` hits are only in the three historical CR logs named in A9. They are not the current lock. |

### A7 — Polar claimed live

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/POLAR_DELIVERABLES.md` still opens with “**Listing:** **not live.**” Publish checkboxes stay `- [ ]`, including “Publish the Polar product” and the hosted second-product step. New sentences say “Not published from this repository,” “not live — CoS publishes,” “The hosted product is not live,” and “That product is not live.” `docs/MINIMUM_SUPPORT.md` still says “The Polar listing is not live until Suthirth solutions publishes it.” No added line says the listing is live or that BurnBrake operates the Polar UI. |
| **Failure mode checked** | CoS or a buyer is told the $199 listing or the hosted product is already on. |
| **Why “CoS publishes” is not a completion claim** | It names who may publish later. The same sentences say the product is not live, and the checkbox is open. |

### A8 — Sealed zip or checksums quietly resealed

| | |
| --- | --- |
| **Result** | **Pass.** The digest was **not** replaced. |
| **Evidence** | `git diff origin/main...6082235 -- checksums src test scripts` is empty. `checksums/burnbrake-0.1.0.sha256` is still `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`, two spaces, `burnbrake-0.1.0.zip`. The GitHub Release asset downloaded from tag `v0.1.0` hashes to that same digest (73 members). `bash scripts/pack-release.sh` on this tree (Node v22.14.0, no `--write`) exited 1: committed digest as above, rebuilt `a4b26eb27760a59319472fbcbcb7621ff32da0a93bc9ccc559d9542083061d43`. After that run, `git diff -- checksums/` was empty. The script’s own text says stop, do not publish, and do not `--write` except after an intentional kit change. This pass did not `--write` and did not edit the five SHA-256 copies in `docs/POLAR_DELIVERABLES.md`. |
| **Failure mode checked** | The price edit silently replaces the zip buyers already have, or pastes a new digest into the Polar doc. |
| **Why the mismatch is the closed state** | Five allowlisted members changed in git (`README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MINIMUM_SUPPORT.md`, `docs/MVP_SCOPE.md`). A rebuild cannot match. The committed checksum stays the seal. |

### A9 — Historical CR logs rewritten so $49 evidence is gone

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `git diff origin/main...6082235 -- docs/CR1_POLAR_PACK_ATTACKS.md docs/CR2_POLAR_PACK_ATTACKS.md docs/CR2_BRAKE_CURVE_ATTACKS.md` is empty. Those files still contain the review-time quotes: CR1 A6 “Nine `$49` mentions in the zip” and the paste sentence “Hosted operation at $49/mo”; CR2 B6 the same paste sentence and “`$49` five times”; CR2 brake-curve outcome “Commercial lock on this branch is unchanged ($199 once / $49/mo).” `docs/DR2_ATTACKS.md` and `docs/DR3_ATTACKS.md` changed only on lines that cite the current founder lock in `COMMERCIAL_LOCK.md` (`$49/mo` → `$59/mo`). DR3 still says the ~$149 figure in the evidence row is a superseded draft. The “Do not sell $149 or $29/mo” banners were not deleted. |
| **Failure mode checked** | A later reader cannot see that the pack attacks reviewed a $49 hosted line, because this PR erased those quotes. |
| **Why the DR edits are not that erasure** | They point at the living lock. The CR evidence of the $49 review is still in the three files above. See P2-3. |

---

## P2 limits (not changed)

### P2-1 — The sealed v0.1.0 zip and its release notes still say hosted $49

The published asset `burnbrake-0.1.0.zip` (tag `v0.1.0`, digest above, 73 members) still has nine `$49` hits and zero `$59` hits: `CHANGELOG.md` (1), `README.md` (2), `docs/COMMERCIAL_LOCK.md` (1), `docs/MINIMUM_SUPPORT.md` (2), `docs/MVP_SCOPE.md` (3). The v0.1.0 release notes still say “Hosted **$49/mo** is optional and is not this asset.” Git copies of those five files now say $59. This pass did not reseal, did not `--write`, and did not edit the GitHub Release. A buyer of the existing asset still reads $49 until a later intentional reseal.

### P2-2 — Do not adopt the rebuilt digest

`bash scripts/pack-release.sh` rebuilt `a4b26eb27760a59319472fbcbcb7621ff32da0a93bc9ccc559d9542083061d43` and exited 1. That digest is the git docs plus the same dist bytes. It is not the shipped zip. Do not paste it into `docs/POLAR_DELIVERABLES.md`. Do not `--write`. Do not upload it over tag `v0.1.0`.

### P2-3 — DR2 and DR3 lock banners now read $59

Two lines in `docs/DR2_ATTACKS.md` and three lines in `docs/DR3_ATTACKS.md` now cite the founder lock as **$59/mo**. Those banners were written when the lock was $49, as a pointer at `COMMERCIAL_LOCK.md`, not as attack evidence. The superseded-draft figures (~$149, ~$29) remain. The CR logs in A9 were not edited. Not reverted: a banner that still said the current lock is $49 would be the A6 failure.

### P2-4 — Design Pass 1 still says the pack is not Polar-ready

`docs/DESIGN_PASS_1.md` keeps “Pack is **not Polar-ready** today” and “listing **DARK — not Polar-ready**” in sentences whose price is now $59. Those status clauses predate the v0.1.0 pack. This diff did not claim the listing is live, and this file is not a zip member. Rewriting the status line is outside the price string. Deferred.

---

## What this pass did not do

- Did not `--write` checksums
- Did not change the published zip or the GitHub Release
- Did not edit `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, or `docs/CR2_BRAKE_CURVE_ATTACKS.md`
- Did not merge PR #8
- Did not publish Polar
- Did not change product code

**APPROVE.** No P0. No P1. P2-1 through P2-4 stay open. CoS publishes the hosted **$59/mo** product. BurnBrake does not operate the Polar UI.
