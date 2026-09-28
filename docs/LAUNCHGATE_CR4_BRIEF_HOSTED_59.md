# LaunchGate CR4 — paste brief (hosted $59/mo)

**Superseded by the PolyForm fence.** This brief records the hosted $59/mo pass. It is not live buyer guidance for the $199 kit. That MIT-era Polar SKU is **archived**. Re-list under PolyForm + the BurnBrake commercial grant is **on hold**. Sentences below that say the $199 listing is “not live” describe this pass only.

**PR:** https://github.com/yellowgram/burnbrake/pull/8
**Branch:** `cursor/hosted-optional-sku-59-f7af`
**Head reviewed by CR3:** `20b23056ec1dcf4b9b483912e8849d1764c58355`
**Date:** 2026-09-27
**Contact:** hello@yellowgram.dev
**Ask:** **APPROVE** this docs-only commercial update for LaunchGate CR4. Do not reseal `v0.1.0`. Do not publish the **$199** kit from this repository. BurnBrake does not operate the Polar UI.

Soft-WTP stays off. Checkout stays out of the README. The hosted checkout path stays in `docs/POLAR_DELIVERABLES.md` only.

---

## What this PR is

Docs only. No product code, no `checksums/` edit, no zip reseal.

- Founder GO 2026-09-27 ET via Chief of Staff: optional hosted price **$49/mo → $59/mo**.
- CoS then published that hosted product **LIVE**. Product `70b1a029-944f-4999-ae39-d39c041ae3e9`. **$59/mo** recurring. No zip and no GitHub benefit on that SKU.
- Primary SKU stays **$199 once** (self-host one-org). That kit’s Polar listing is **not live**.
- Refund stays **14 days on the $199 kit only**.
- Exhaust stays HTTP **402** / `BUDGET_EXHAUSTED` / halt / **not retryable**.

## Freezes held

| Freeze | Held |
| --- | --- |
| Primary **$199 once** | Yes |
| Hosted **$59/mo** recurring, product `70b1a029-944f-4999-ae39-d39c041ae3e9`, **LIVE** | Yes |
| $199 kit listing not live | Yes |
| Soft-WTP off; no coupons; no cold invoices | Yes |
| Checkout out of README and out of zip-shipped docs | Yes |
| Exhaust 402, halt, not retryable | Yes |
| Refund 14 days on the $199 kit only | Yes |
| Sealed zip digest unchanged: `585347975892f29d2e0056fd062eee8520c41d15a152c37e2ce31477ba915cf8` | Yes |

## CR×3 scorecard

| | Verdict | P0 | P1 | P2 left open |
| --- | --- | --- | --- | --- |
| CR1 (`docs/CR1_HOSTED_59_ATTACKS.md`) | **APPROVE** | 0 | 0 | 4, plus a hosted-LIVE addendum |
| CR2 (`docs/CR2_HOSTED_59_ATTACKS.md`) | **APPROVE** | 0 | 0 | 4 |
| CR3 (`docs/CR3_HOSTED_59_ATTACKS.md`) | **APPROVE** | 0 | 0 | 5 |

CR3 did not rubber-stamp CR1 or CR2. It re-read the diff. No P0 or P1 was fixed because none was found. Historical `$49` quotes in `docs/CR1_POLAR_PACK_ATTACKS.md`, `docs/CR2_POLAR_PACK_ATTACKS.md`, and `docs/CR2_BRAKE_CURVE_ATTACKS.md` were left in place.

## Known P2 limits

1. The sealed `v0.1.0` zip and its release notes still say hosted **$49**. Do not `--write`. Do not adopt a rebuilt digest.
2. `README.md`, `docs/START_HERE.md`, `docs/SUPPORT.md`, and `docs/MINIMUM_SUPPORT.md` still say the listing is not live. They do not carry a checkout path. The lock and MVP scope split “$199 kit not live” from “hosted live.”
3. `docs/DESIGN_PASS_1.md` and `docs/LAUNCHGATE_DR4_BRIEF.md` still say Polar is dark. They are not zip members.
4. CR1’s P0 legend and its `$49` leftover list are unscoped relative to this head. The addendum is the later ruling.
5. CR2’s host-search sentence is broader than the path search. The checkout path is still only in `docs/POLAR_DELIVERABLES.md`.

## APPROVE / REJECT

**APPROVE** the docs-only price and hosted-LIVE status for LaunchGate CR4.

**Do not** treat that as a merge, a zip reseal, or a publish of the $199 kit. CoS already published the hosted product. BurnBrake does not click Polar.
