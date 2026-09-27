# BurnBrake — Code Review ×3 (CR3) Attack Log — hosted optional $59/mo

**Pass:** third hostile review. CR1 and CR2 are not the evidence.
**PR:** https://github.com/yellowgram/burnbrake/pull/8 (`cursor/hosted-optional-sku-59-f7af`)
**Head reviewed:** `20b23056ec1dcf4b9b483912e8849d1764c58355`
**Date:** 2026-09-27
**Scope:** `git diff origin/main...20b2305`, including both hosted-price attack logs. Not a sidecar re-audit.
**Stance:** checkout URL in the README or a zip-shipped doc; Soft-WTP, a coupon, or a cold invoice; primary SKU off $199; buyer-facing docs still stating hosted $49 as the price now; the $199 kit Polar listing claimed live; a 14-day refund invented for hosted; checksums or the sealed zip rewritten; CR1 and CR2 contradicting each other on a current lock; the live checkout path living anywhere but `docs/POLAR_DELIVERABLES.md`.
**Outcome:** No P0. No P1. Five P2 limits left open. **Verdict: APPROVE.** Checksums were not written. SHA-256 of the published zip stays `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`.

This file is not a zip member. `scripts/pack-release.sh` refuses any `docs/CR*` name. Adding it does not reseal the kit.

Hosted **$59/mo** is live because CoS published it. The $199 kit listing is not. Soft-WTP stays off. This pass did not merge PR #8 and did not publish the $199 kit.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | The checkout path is in `README.md` or any pack-allowlist file; Soft-WTP, a coupon, or a cold invoice becomes an offer; the primary SKU leaves **$199 once**; hosted is given a 14-day refund; `checksums/` or the sealed zip is rewritten; the **$199 kit** listing is stated live; or CR1 and CR2 assert opposite current locks for this head (hosted price, hosted live versus kit live, or where the checkout path sits). |
| **P1** | A buyer-facing current-lock doc still states hosted **$49** as the price now: `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/MINIMUM_SUPPORT.md`, or the paste block in `docs/POLAR_DELIVERABLES.md`. |
| **P2** | Real limit. Documented. Not changed in this pass. CR2’s deferred P2s stay if they are still true. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 5 | 0 | 5 |

---

## Attack catalog

### C1 — Checkout in the README or a zip-shipped doc

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The checkout path token appears only in `docs/POLAR_DELIVERABLES.md` (hosted header and the checked CoS step). The admin URL is in that same file only. This log does not repeat either URL. The pack allowlist (`README.md`, `CHANGELOG.md`, `docs/START_HERE.md`, `docs/DEMO_60S.md`, `docs/OPERATOR.md`, `docs/OPERATOR_NEEDS.md`, `docs/SUPPORT.md`, `docs/MINIMUM_SUPPORT.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/DESIGN_BRAKE_CURVE.md`) has neither host. README still says “this file has no checkout URL.” The pack script refuses `POLAR_DELIVERABLES.md` and any `docs/CR*` name. |
| **Failure mode checked** | A zip buyer or a README reader receives the hosted checkout link. |
| **Why a host name in CR1 is not this failure** | CR1’s addendum names the checkout host and the dashboard host inside a “no” sentence. It does not contain the checkout path. See C9 and P2-5. |

### C2 — Soft-WTP, coupons, or cold invoices

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/COMMERCIAL_LOCK.md` still says **Soft-WTP: OFF** and still forbids Soft-WTP, coupons, and cold invoices. The hosted header says Soft-WTP off. The $199 paste still says the hosted line “is not a coupon, a cold invoice, or Soft-WTP.” The checked CoS step still says do not add coupons, do not send cold invoices, and Soft-WTP stays off. No promo code and no percent-off were added. |
| **Failure mode checked** | Live hosted $59/mo is a discount, a coupon, or a cold invoice against the $199 kit. |
| **Why it fails closed** | The live product is a separate SKU with no zip and no GitHub benefit, next to the same ban. |

### C3 — Primary SKU drifted off $199, or exhaust softened

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The primary row is still **$199 once**, “Not $149. Not $79/mo as the plan.” It is not in the hunk. Polar “Primary SKU” is still self-host one-org **$199 once**. The paste still says “Price: $199 once.” The CoS step that sets that price is still unchecked. Hosted is **$59/mo** recurring, not the day-1 plan, and not this kit. `git diff origin/main...20b2305 -- src test prices scripts checksums` is empty. Exhaust in the lock is still HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable**. |
| **Failure mode checked** | The kit price becomes $59, hosted replaces day-1, or exhaust becomes retryable or 429. |
| **Why the two prices stay apart** | $199 is the unpublished kit. $59/mo is the live hosted product `70b1a029-944f-4999-ae39-d39c041ae3e9`. |

### C4 — Buyer-facing docs still show hosted $49 as the current lock

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | On this head, `$49` remains in `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, `docs/CR2_BRAKE_CURVE_ATTACKS.md`, `docs/CR1_HOSTED_59_ATTACKS.md`, and `docs/CR2_HOSTED_59_ATTACKS.md`. The first three are unchanged versus `main`. The last two quote $49 as the replaced price or as the attack name, not as the lock now. `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/MINIMUM_SUPPORT.md`, and the Polar paste use **$59/mo**. |
| **Failure mode checked** | A stranger reading the git lock, the README, or the paste still quotes hosted $49. |
| **Why CR1’s leftover list is stale** | CR1 A6 said the only leftovers were the three historical pack logs. That was the price-commit tree. This head also has the two hosted-price logs. They are not buyer-facing. See P2-4. |

### C5 — $199 kit Polar listing claimed live

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/POLAR_DELIVERABLES.md` opens with “**Listing ($199 kit):** **not live.**” The kit publish step and the kit ready-gate line are still `- [ ]`. The hard fence says do not claim the $199 kit listing is already live. `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md` say the $199 kit listing is not live in the same sentences that say hosted **$59/mo** is live. README says the listing is not live in that file. |
| **Failure mode checked** | CoS or a buyer is told the $199 zip is already for sale on Polar. |
| **Why hosted LIVE is not that claim** | Hosted is a second product. No zip. No GitHub benefit. The kit checkbox was renamed so it is not the hosted step. |

### C6 — 14-day refund invented for hosted

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The lock refund line is still “**14 days** (founder lock) — $199 self-host one-org kit.” README still limits **14 days** to the **$199** kit. The Polar refund field is “**14 days** on the $199 kit.” The checked hosted step says “The 14-day refund stays on the $199 kit only.” The hosted paste sentence does not mention a refund. |
| **Failure mode checked** | The live $59/mo product inherits the kit refund. |
| **Why it fails closed** | The live sentence names the kit as the only holder of that window. |

### C7 — Sealed zip or checksums rewritten

| | |
| --- | --- |
| **Result** | **Pass.** The digest was **not** replaced. |
| **Evidence** | `git diff origin/main...20b2305 -- checksums` is empty. The checksum file is still `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`, two spaces, `burnbrake-0.1.0.zip`. The five SHA-256 copies in `docs/POLAR_DELIVERABLES.md` are that string. `bash scripts/pack-release.sh` on this tree (Node v22.14.0, no `--write`) exited 1. Rebuilt digest `2e0f484d1c5beb42bef557996eb94df4a07ae9cf424116c661c1a9b0bed0bbea`, the same digest CR2 recorded, which is what a rebuild must do when only `docs/CR*` files were added after the LIVE edits. After the run, `git diff -- checksums/` was empty. Neither rebuilt digest was pasted into the Polar doc. |
| **Failure mode checked** | A review pass silently replaces the zip buyers already have. |
| **Why the mismatch is the closed state** | Allowlisted docs in git differ from the sealed asset. The committed checksum stays the seal. |

### C8 — CR1 and CR2 contradict each other on a current lock

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | Both logs **APPROVE** with no P0 and no P1. Both say the committed digest is `58534797…cf8` and that it was not rewritten. CR1’s body is the review of `6082235` (hosted not yet live). Its addendum, and CR2’s review of `0a15f01`, agree on this head: hosted **$59/mo** is live, the $199 kit is not, Soft-WTP is off, the 14-day refund stays on the kit, and the checkout path is not in the README. CR2’s rebuilt digest differs from CR1’s earlier rebuild because `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md` changed after CR1 ran the script. CR2 says so. This run matched CR2’s digest, not CR1’s. |
| **Failure mode checked** | One log says hosted is unpublished, or the kit is live, or the checksum changed, as the fact of this head, and the other log says the opposite. |
| **Why the unscoped CR1 P0 row is not that split** | CR1’s legend still lists “hosted product is already live” as a P0 with no date. The addendum withdraws that for the post-publish edit, and CR2 P2-4 records the skim hazard. The files at this head match the addendum, not a second lock. See P2-4. |

### C9 — Live checkout path belongs only in POLAR_DELIVERABLES

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | A search for the checkout path token returns only `docs/POLAR_DELIVERABLES.md`. It is not in `README.md`, not in any pack-allowlist doc, and not in `docs/CR1_HOSTED_59_ATTACKS.md` or `docs/CR2_HOSTED_59_ATTACKS.md`. CR1 names the checkout host in a denial sentence and does not include the path. |
| **Failure mode checked** | The live buy link is copied into a second git file or into the zip. |
| **Why CR2’s “only one file” line is narrower than it sounds** | A search for the host string also hits CR1’s denial. A search for the path does not. The path is the checkout. See P2-5. |

---

## P2 limits (not changed)

CR2 P2-1 through P2-4 are still true. P2-5 is new. None are fixed here.

### P2-1 — The sealed v0.1.0 zip still says hosted $49 and is not LIVE

Published asset and `checksums/burnbrake-0.1.0.sha256` are still `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`. That zip’s `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MINIMUM_SUPPORT.md`, and `docs/MVP_SCOPE.md` still say hosted $49. They do not say hosted is live. Do not adopt rebuilt digest `2e0f484d1c5beb42bef557996eb94df4a07ae9cf424116c661c1a9b0bed0bbea`. Do not `--write`.

### P2-2 — Some zip-shipped stranger docs still say the listing is not live

`README.md`, `docs/START_HERE.md`, `docs/SUPPORT.md`, and `docs/MINIMUM_SUPPORT.md` do not say hosted is live. `docs/MINIMUM_SUPPORT.md` still says “The Polar listing is not live until Suthirth solutions publishes it” under the hosted $59 line, and its header still says the listing is not live. `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md` split kit-not-live from hosted-live. None of them contain the checkout path. Deferred.

### P2-3 — Design Pass 1 and the DR4 brief still say Polar is dark

`docs/DESIGN_PASS_1.md` still says “listing **DARK — not Polar-ready**” and “Pack is **not Polar-ready** today” next to hosted **$59/mo**. `docs/LAUNCHGATE_DR4_BRIEF.md` still describes Polar as dark. Neither file is a zip member. They do not say the $199 kit is live and they do not carry the checkout path. Deferred.

### P2-4 — CR1’s P0 legend and A6 leftover list are unscoped

The CR1 severity row still lists “hosted product is already live” as a P0 with no `6082235` date. A6 still says the only `$49` leftovers are the three historical pack logs. The addendum is the later ruling on live status. CR2 did not rewrite CR1. This pass does not either.

### P2-5 — CR2 B1 says the host search hits one file

CR2 says a search for the checkout host and the dashboard host on `0a15f01` returns only `docs/POLAR_DELIVERABLES.md`. CR1’s addendum, already on that commit, names both hosts in a “no” sentence and does not include the checkout path. The path search is the one that returns a single file. Not edited.

---

## What this pass did not do

- Did not `--write` checksums
- Did not change the published zip or the GitHub Release
- Did not edit `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, or `docs/CR2_BRAKE_CURVE_ATTACKS.md`
- Did not edit `docs/CR1_HOSTED_59_ATTACKS.md` or `docs/CR2_HOSTED_59_ATTACKS.md`
- Did not merge PR #8
- Did not publish the $199 kit
- Did not change product code

**APPROVE.** No P0. No P1. P2-1 through P2-5 stay open. Hosted **$59/mo** stays live on product `70b1a029-944f-4999-ae39-d39c041ae3e9`. The checkout path stays in `docs/POLAR_DELIVERABLES.md` only. BurnBrake does not operate the Polar UI.
