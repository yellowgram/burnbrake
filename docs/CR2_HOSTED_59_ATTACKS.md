# BurnBrake — Code Review ×2 (CR2) Attack Log — hosted optional $59/mo

**Pass:** second hostile review. CR1 is not the evidence.
**PR:** https://github.com/yellowgram/burnbrake/pull/8 (`cursor/hosted-optional-sku-59-f7af`)
**Head reviewed:** `0a15f01828ca7dbd71de92c702ecb6b1a2d4dfa6`
**Date:** 2026-09-27
**Scope:** `git diff origin/main...0a15f01`, including `docs/CR1_HOSTED_59_ATTACKS.md` and the hosted-LIVE edits. Not a sidecar re-audit.
**Stance:** checkout URL leaked into the README or a zip-shipped doc; Soft-WTP, a coupon, or a cold invoice; primary SKU off $199; buyer-facing docs still stating hosted $49 as the price now; the $199 kit Polar listing claimed live; a 14-day refund invented for hosted; checksums or the sealed zip rewritten; the CR1 addendum contradicting its own body on a current lock.
**Outcome:** No P0. No P1. Four P2 limits left open. **Verdict: APPROVE.** Checksums were not written. SHA-256 of the published zip stays `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`.

This file is not a zip member. `scripts/pack-release.sh` refuses any `docs/CR*` name. Adding it does not reseal the kit.

The hosted product is live because CoS published it. The $199 kit listing is not. Soft-WTP stays off. This pass did not merge PR #8 and did not publish Polar.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | A checkout URL lands in `README.md` or any pack-allowlist file; Soft-WTP, a coupon, or a cold invoice becomes an offer; the primary SKU leaves **$199 once**; hosted is given a 14-day refund; `checksums/` or the sealed zip is rewritten; the **$199 kit** listing is stated live; or the CR1 addendum tells a reader the opposite of a lock the body still asserts as true of this head. |
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

### B1 — Checkout URL leaked into the README or a zip-shipped doc

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | On `0a15f01`, before this file, a search for the hosted checkout host and the dashboard host returns only `docs/POLAR_DELIVERABLES.md`. The checkout string is the hosted header and the checked CoS step. The admin URL is the header and that same step. This log does not repeat either URL. The same search over the pack allowlist (`README.md`, `CHANGELOG.md`, `docs/START_HERE.md`, `docs/DEMO_60S.md`, `docs/OPERATOR.md`, `docs/OPERATOR_NEEDS.md`, `docs/SUPPORT.md`, `docs/MINIMUM_SUPPORT.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/DESIGN_BRAKE_CURVE.md`) is empty. README still says “this file has no checkout URL.” The script refuses to pack `POLAR_DELIVERABLES.md` and any `docs/CR*` name. |
| **Failure mode checked** | A zip buyer, or a README reader, is handed the hosted checkout link. |
| **Why the CoS file is the allowed place** | That file is git-only. The zip-shipped lock and scope say hosted is live and that those files have no checkout URL. |

### B2 — Soft-WTP, coupons, or cold invoices

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/COMMERCIAL_LOCK.md` still says **Soft-WTP: OFF** and still lists “Soft-WTP / coupons / cold invoices” under **Do not**. The hosted header in `docs/POLAR_DELIVERABLES.md` says Soft-WTP off. The paste sentence still says the hosted line “is not a coupon, a cold invoice, or Soft-WTP.” The checked CoS step still says do not add coupons, do not send cold invoices, Soft-WTP stays off. No promo code and no percent-off were added. |
| **Failure mode checked** | Hosted $59/mo is worded as a discount on the $199 kit. |
| **Why it fails closed** | Live status sits next to the same ban. The hosted SKU is a separate product with no zip benefit. |

### B3 — Primary SKU drifted off $199

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The primary row in `docs/COMMERCIAL_LOCK.md` is not in the hunk: **$199 once**, “Not $149. Not $79/mo as the plan.” Polar “Primary SKU” is still self-host one-org **$199 once**. The paste still says “Price: $199 once.” The CoS step that sets price is still “Set price **$199 once**” and is still unchecked. Hosted is **$59/mo** recurring, “Not the day-1 primary plan,” and “not this kit.” `git diff origin/main...0a15f01 -- src test prices scripts` is empty, so exhaust bytes were not edited. |
| **Failure mode checked** | The kit price becomes $59, or hosted replaces the day-1 plan, or exhaust becomes retryable or 429. |
| **Why the two prices stay apart** | $199 is the unpublished kit. $59/mo is the live hosted product. Product id `70b1a029-944f-4999-ae39-d39c041ae3e9` appears on the hosted lines only (seven times in `docs/POLAR_DELIVERABLES.md`). |

### B4 — Buyer-facing docs still show hosted $49 as the current lock

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `rg -l '\$49'` on this tree returns only `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, `docs/CR2_BRAKE_CURVE_ATTACKS.md`, and `docs/CR1_HOSTED_59_ATTACKS.md`. The first three are unchanged versus `main` (`git diff` empty). The fourth quotes $49 as the price the diff replaced, not as the lock now. `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MVP_SCOPE.md`, `docs/MINIMUM_SUPPORT.md`, and the Polar paste use **$59/mo**. |
| **Failure mode checked** | A stranger reading the git lock, the README, or the paste still pays or quotes hosted $49. |
| **Why the CR hits are not this failure** | They are the review record of the old string. They are not pack members. |

### B5 — $199 kit Polar listing claimed live

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | `docs/POLAR_DELIVERABLES.md` opens with “**Listing ($199 kit):** **not live.**” The publish step for that SKU is still `- [ ]`. The ready-gate line for the kit listing is still open. The hard fence says “Do not claim the **$199 kit** Polar listing is already live.” `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md` say the $199 kit listing is not live in the same sentences that say hosted **$59/mo** is live. README says “The listing is not live in this repository” and does not say the kit listing is on. |
| **Failure mode checked** | CoS or a buyer is told the $199 zip product is already for sale on Polar. |
| **Why hosted LIVE is not that claim** | Hosted is a second product, no zip, no GitHub benefit. The kit publish checkbox was renamed so it is not the hosted step. |

### B6 — 14-day refund invented for hosted

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | The refund header in `docs/COMMERCIAL_LOCK.md` is still “**14 days** (founder lock) — $199 self-host one-org kit” and was not part of the price hunk. README still says “Refund on the **$199** one-org kit is **14 days**.” The Polar refund field is “**14 days** on the $199 kit.” The checked hosted step says “The 14-day refund stays on the $199 kit only.” The hosted paste sentence does not mention a refund. |
| **Failure mode checked** | The live $59/mo product picks up the kit’s 14-day window. |
| **Why it fails closed** | The new live sentence names the kit as the only holder of that window. |

### B7 — Sealed zip or checksums rewritten

| | |
| --- | --- |
| **Result** | **Pass.** The digest was **not** replaced. |
| **Evidence** | `git diff origin/main...0a15f01 -- checksums src test scripts` is empty. `checksums/burnbrake-0.1.0.sha256` is still `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`, two spaces, `burnbrake-0.1.0.zip`. The five SHA-256 copies inside `docs/POLAR_DELIVERABLES.md` are that same string. `bash scripts/pack-release.sh` on this tree (Node v22.14.0, no `--write`) exited 1. Rebuilt digest `2e0f484d1c5beb42bef557996eb94df4a07ae9cf424116c661c1a9b0bed0bbea`. After that run, `git diff -- checksums/` was empty. CR1 recorded an earlier rebuild `a4b26eb27760a59319472fbcbcb7621ff32da0a93bc9ccc559d9542083061d43` from before the LIVE edits to `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md`. This pass did not paste either rebuilt digest into the Polar doc. |
| **Failure mode checked** | The live-status edit silently replaces the zip buyers already have. |
| **Why the mismatch is the closed state** | Allowlisted docs changed in git. A rebuild cannot match. The committed checksum stays the seal. |

### B8 — CR1 addendum contradicts the CR1 body

| | |
| --- | --- |
| **Result** | **Pass** |
| **Evidence** | CR1’s header is “Head reviewed: `6082235`”. Its line after the outcome says that at that commit the listing was unpublished, and that a later edit is the addendum and does not change that verdict. A7’s evidence describes `6082235` (hosted step open, “not live”). The addendum says CoS then published hosted **$59/mo**, product `70b1a029-944f-4999-ae39-d39c041ae3e9`, and that stating hosted live is not a P0 after that publish. It also says the follow-up does not state that the $199 kit listing is live. Checked against this head: hosted lines say LIVE; the $199 kit lines say not live; the checkout URL is only in `docs/POLAR_DELIVERABLES.md`; `checksums/` is unchanged. The addendum does not repeat the checkout URL. |
| **Failure mode checked** | The addendum says hosted is live while the body, read as this head, still requires hosted to be unpublished, or the addendum claims the $199 kit is live. |
| **Why the tense in A7 is not that failure** | A7 is tied to `6082235`. The addendum is the later fact and matches the files at `0a15f01`. See P2-4 for the unscoped P0 row a skimmer can misread. |

---

## P2 limits (not changed)

### P2-1 — The sealed v0.1.0 zip still says hosted $49 and is not LIVE

The published asset and `checksums/burnbrake-0.1.0.sha256` are still `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8`. That zip’s copies of `README.md`, `CHANGELOG.md`, `docs/COMMERCIAL_LOCK.md`, `docs/MINIMUM_SUPPORT.md`, and `docs/MVP_SCOPE.md` still say hosted $49. They do not say the hosted product is live. This pass did not `--write` and did not edit the GitHub Release. Do not adopt rebuilt digest `2e0f484d1c5beb42bef557996eb94df4a07ae9cf424116c661c1a9b0bed0bbea`.

### P2-2 — Some zip-shipped stranger docs still say “the listing is not live”

`README.md`, `docs/START_HERE.md`, `docs/SUPPORT.md`, and `docs/MINIMUM_SUPPORT.md` were not given a hosted-LIVE sentence. `docs/MINIMUM_SUPPORT.md` still says “The Polar listing is not live until Suthirth solutions publishes it” in the paragraph under the hosted $59 line. `docs/COMMERCIAL_LOCK.md` and `docs/MVP_SCOPE.md` say hosted is live and the $199 kit is not. None of those files contain the checkout URL. Not edited here: the LIVE status was limited to the CoS file plus the lock and scope, and the stranger docs still refuse a checkout link.

### P2-3 — Design Pass 1 and the DR4 brief still say Polar is dark

`docs/DESIGN_PASS_1.md` still says “listing **DARK — not Polar-ready**” and “Pack is **not Polar-ready** today” next to hosted **$59/mo**. `docs/LAUNCHGATE_DR4_BRIEF.md` still describes Polar as dark. Neither file is a zip member. They do not say the $199 kit is live and they do not carry a checkout URL. Deferred.

### P2-4 — CR1’s P0 legend is unscoped

The severity row in `docs/CR1_HOSTED_59_ATTACKS.md` still lists “states that the Polar listing or the hosted product is already live” as a P0, without the `6082235` date. A7’s evidence is present tense (“still opens with”). The addendum is the later ruling and matches this head. Rewriting CR1’s legend would edit the record of that pass. Not edited.

---

## What this pass did not do

- Did not `--write` checksums
- Did not change the published zip or the GitHub Release
- Did not edit `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, or `docs/CR2_BRAKE_CURVE_ATTACKS.md`
- Did not edit `docs/CR1_HOSTED_59_ATTACKS.md`
- Did not merge PR #8
- Did not publish the $199 kit
- Did not change product code

**APPROVE.** No P0. No P1. P2-1 through P2-4 stay open. Hosted **$59/mo** stays live on product `70b1a029-944f-4999-ae39-d39c041ae3e9`. The checkout URL stays in `docs/POLAR_DELIVERABLES.md` only. BurnBrake does not operate the Polar UI.
