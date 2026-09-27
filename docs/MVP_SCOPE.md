# BurnBrake — MVP Scope (locked; Design Pass 3 absorbed — DR×3 complete)

**Kit status (v0.1.1):** the sidecar in this zip is the current kit (`burnbrake-0.1.1.zip`). Tag `v0.1.1` is not pushed until License Gate and LaunchGate say go. Tag `v0.1.0` and `checksums/burnbrake-0.1.0.*` stay historical and are not resealed. This file remains the locked scope record. Attack logs and LaunchGate briefs stay in the git repository and are not in the buyer zip. The $199 self-host kit Polar listing is **archived** (MIT-era SKU unlisted). Re-list under PolyForm + the Suthirth Commercial Grant is **on hold** (CoS/License Gate). Not live in this repo. The optional hosted **$59/mo** Polar product remains live (CoS, 2026-09-27) and does not grant self-host production rights. This file has no checkout URL. Seller paste copy is [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) in git (not in the zip).

**Product:** BurnBrake — request-path spend governor  
**Promise:** reject the next completion when user/run/day budget cannot cover the conservative estimate (including debt). Honesty: **one already-forwarded call may still overshoot** — not magical zero overspend. **No claim** that BurnBrake will outrun OpenAI forever.  
**Primary shape:** OpenAI-compatible **sidecar** (self-host); thin **SDK** secondary  
**Pricing (USD, founder lock):** **$199 once** self-host one-org kit (primary) · **$59/mo** hosted optional, separate · source-available commercial (PolyForm Noncommercial 1.0.0 + [Suthirth Commercial Grant](./COMMERCIAL_GRANT.md)) · OSI open source: false · see [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)  
**Contact:** hello@yellowgram.dev  
**Polar:** the $199 self-host kit listing is **archived** (MIT-era SKU unlisted). Re-list is **on hold** (CoS/License Gate). Hosted optional **$59/mo** remains live (CoS, 2026-09-27). No checkout URL in this file.  
**Date:** 2026-09-26 ET scope lock · current kit v0.1.1 (license fence) · first shipped in the historical v0.1.0 kit · DR3 remediations from [`DR3_ATTACKS.md`](./DR3_ATTACKS.md) (git only)

Narrative: [`DESIGN_PASS_1.md`](./DESIGN_PASS_1.md) · Price: [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md) · Support: [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) · Ops: [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) · Brief: [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md)

Approach policy: [`DESIGN_BRAKE_CURVE.md`](./DESIGN_BRAKE_CURVE.md) — amendment **BB_BRAKE_CURVE_1** (implemented on the curve PR; exhaust bytes unchanged).

Fences: Soft-WTP OFF · not Autumn/Stigg · cap + kill only · **LaunchGate 4th DR** before implement · **CR×3 → LaunchGate 4th CR** before merge.

**Gate process:** ordinary design/code freezes → **LaunchGate**. Founder only for price / refunds / Polar go-live / Soft-WTP / spend / Autumn-scope creep.

---

## In (MVP)

### 1. Sidecar (primary)
- OpenAI-compatible proxy for at least `/v1/chat/completions` (document exact route list).
- Buyer points `OPENAI_BASE_URL` (or SDK `baseURL`) at sidecar; provider key stays with buyer (sidecar forwards; BurnBrake does not become key vault as a product).
- On each completion: **conservative estimate → atomic reserve → forward or reject → settle** (see state machine below).
- **Default bind `127.0.0.1`**. Non-loopback requires `BURNBRAKE_ALLOW_PUBLIC_BIND=1` **and** auth still on.
- **App→sidecar auth required:** preferred **`X-BurnBrake-Key`** (alt Bearer `bb_…`). Never reuse provider key as BurnBrake secret. `user_id` / `run_id` only from authenticated callers; unauthenticated → reject.
- Optional **`x-burnbrake-request-id` / Idempotency-Key`**: same in-flight key must not double-forward.
- `/health`: listen address, `auth.required`, `ledger.writable`, `fail_closed=true`, price-table `version`/`priced_at`, `estimate.default_max_tokens`.
- **Mock upstream** path for stranger demo / 60s proof (no live provider $ required).

### 2. Reservation state machine (DR2 P0 held + DR3 settle matrix)
| State / event | Budget effect |
| --- | --- |
| `RESERVED` then reject / pre-forward failure | **RELEASE** (free) |
| Forward begins → `FORWARDED` → settle | Debit **actual**; release unused reserve |
| `FORWARDED` + upstream confirmed no-charge | **RELEASE** unused |
| Crash/TTL while `FORWARDED` | **DEBIT_RESERVED** (assume estimate spent) — **never free-release after forward** |
| Upstream 5xx / disconnect after forward | Settle if usage known; else **DEBIT_RESERVED** |
| Settle > reserve | Record **debt**; next reserve must cover debt + new estimate |
| Once `FORWARDED` | **No mid-stream budget reject** — next-call gate only |
| Operator force-release | Audited; only for proven no-charge stuck rows |

### 3. Budgets
- Scopes: **per-user**, **per-run**, **per-day** (AND semantics; day default = **UTC** ledger clock).
- Config via env/file/CLI for MVP (no packaging studio).
- Units: USD micros + **static versioned** model price table (`version`, `priced_at`).
- **Unpriced model → deny by default** (token-only only if explicitly configured; never silent $0).
- **Conservative estimate:** input + output ceiling — use request `max_tokens` if present; **else** inject sidecar default (**never silently lower** a buyer-supplied higher ceiling) + documented vision/tool surcharges when those request fields present; unknown surcharge path → deny.
- Stale price table → **warn** in health/operator (draft 30d — LaunchGate freezes); never fail-open because stale.
- Production: set **per-user and/or per-day**; per-run alone is washable by run-id rotation (Known limit).

### 4. Reject path
- Fail-closed: exhausted budget / debt / ledger down → **no upstream provider call**.
- Stable error: `BUDGET_EXHAUSTED` + failing scope + remaining + requested.
- **Draft HTTP status `402`** (LaunchGate freezes; halt semantics required either way).
- Retries that re-enter the gate must not spend provider dollars; agents **halt** (non-retryable for spend).
- **No MVP config** for soft-allow-overage / warn-only / fail-open ledger.

An optional pre-cap brake curve (warn / slow before the cap) is implemented — see [`DESIGN_BRAKE_CURVE.md`](./DESIGN_BRAKE_CURVE.md) (**BB_BRAKE_CURVE_1**). At the cap, the sidecar still halts with the unchanged exhaust bytes (402, `BUDGET_EXHAUSTED`, halt true, retryable false, no Retry-After, no 429). Founder PQ1–PQ3 stay locked (2026-09-26 ET): hosted `brake.enabled` `false`, `black_delay_ms` `0`, allowance later. `brake.enabled` is not a halt-off switch.

### 5. Thin SDK (secondary)
- TypeScript wrapper using the same reserve/settle protocol (local ledger or sidecar).
- Same reject error type as HTTP body mapping; decision-table halt behavior documented.

### 6. Operator minimum
- See balances by scope (incl. debt + active reservations); list recent decisions (allow/deny); kill/pause a run; adjust caps; proof `upstream_forwarded=false` on denies; price-table version; auth rotation runbook.
- Details: [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md).

### 7. Delivery honesty
- **First cash SKU = $199 once** self-host one-org kit. [`LICENSE`](../LICENSE) is the PolyForm Noncommercial License 1.0.0. OSI open source: false. The $199 purchase is the [Suthirth Commercial Grant](./COMMERCIAL_GRANT.md), the packaged kit, and 60-day Issues for one organization and the named tag, perpetual for that tag. Noncommercial use of the published source does not require the grant. Commercial production use of the self-host kit does. Hosted **$59/mo** is a separate SKU and does not grant self-host production rights. Buyer of the $199 kit keeps the zip. See [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md).
- The $199 self-host kit Polar listing is **archived** (MIT-era SKU unlisted). Re-list under PolyForm + the Suthirth Commercial Grant is **on hold** (CoS/License Gate). Not live in this repo. Hosted optional **$59/mo** remains live on Polar (CoS, 2026-09-27) and is not this kit. This file has no checkout URL. This repository does not publish Polar and does not ask for a $199 republish.
- BurnBrake only governs traffic that hits the sidecar.

---

## Out (explicit)

| Out | Why |
| --- | --- |
| **Billing SoR / Stripe subscription lifecycle / invoices / dunning / tax** | Autumn/Chargebee; Soft-WTP forbidden |
| **Plan packaging / entitlement EMS / customer portal widgets** | Stigg/Schematic upmarket |
| **Credit wallets for end-customer monetization** | Credit-ledger / Autumn lane |
| **Usage metering → end-of-period invoices as the product** | Default Autumn failure mode we refuse to become |
| **MVP lexicon: credits / entitlements / invoice overage on spend path** | Fence — caps/remaining/reserve/settle/reject/debt only |
| **Marketing “never overspend” / magical zero burn** | Dishonest vs one in-flight call residual |
| **Soft-alert-only MVP** (no reject) / **fail-open ledger** | Breaks the promise |
| **Soft-WTP / cold invoices** | Forbidden |
| **Claiming the $199 kit Polar listing is already live** | That MIT-era SKU is archived. Re-list is on hold (CoS/License Gate). Hosted $59/mo is a separate live product and is not this zip. |
| **Default `0.0.0.0` bind or auth-optional public proxy** | Fund-drain class |
| **Day-1 hosted multi-tenant as co-equal first SKU** | Self-host first (DR3) |
| **Multi-PSP spend aggregation as day-1** | Kit commerce ≠ OpenAI metering |
| **Replacing OpenAI org hard limits / stopping ungated second clients / outrunning OpenAI forever** | Complement + honesty; don’t claim |
| **Cryptographic compliance theater / FedRAMP path** | Upmarket SpendGuard-class; stay dumb |
| **Implementation services as primary offer** | Product = governor |

---

## Later (not MVP)

- Hosted multi-tenant sidecar/ledger tenancy (**$59/mo** optional, not day-1 primary) after self-host proof. Month-2 platform caps are expected; the buyer keeps the zip.
- Additional providers beyond OpenAI-shaped HTTP (Anthropic native, etc.).
- Richer estimate models (streaming true-up polish, tool-call graphs) beyond conservative ceiling + debt.
- Optional Polar/Stripe **kit commerce** only (still not Autumn; still not in-path OpenAI credits).
- MayDo/SeatTruth joins — out of band unless founder asks.
- Signed identity tokens / multi-secret auth beyond single shared BurnBrake key per deploy.

---

## Reject path (contract sketch)

| Field | Meaning |
| --- | --- |
| `code` | `BUDGET_EXHAUSTED` |
| `scope` | `user` \| `run` \| `day` (first failing; may be debt-related) |
| `remaining_micros` | What was left |
| `requested_micros` | What reserve asked for |
| `run_id` / `user_id` | Echo of authenticated request identity |

Sidecar: non-2xx + JSON body — **402** `BUDGET_EXHAUSTED`, halt, **not retryable**. SDK: thrown `BudgetExhausted`. Agent **halt** semantics stay. Exhaust path is unchanged by the price lock.

**Honesty:** one already-forwarded call may still overshoot (settle above reserve, or debit-on-crash). That residual stays. **No claim** that BurnBrake will outrun OpenAI forever, or stay ahead of provider org limits.

---

## Known limits (P2 — LaunchGate / founder visibility)

From [`DR2_ATTACKS.md`](./DR2_ATTACKS.md) + [`DR3_ATTACKS.md`](./DR3_ATTACKS.md); **do not market as closed**:

1. **One in-flight overshoot / debit-on-crash** — pre-call gate + debt; already-forwarded call may exceed reserve or debit estimate; promise is next-call reject, not magical zero overspend. **No claim** that BurnBrake will outrun OpenAI forever.
2. **Day-boundary / multi-writer clock skew** — ledger uses store-side UTC day key; skewed multi-pod clocks without one store can split buckets near midnight.
3. **Ungated second client** — process that ignores sidecar `baseURL` and calls the provider directly bypasses BurnBrake; docs/checklist elevated (DR3); still not code-forced.
4. **Authenticated `run_id` rotation** — per-run-only configs are washable; production needs per-user and/or per-day AND.
5. **Estimate polish residual** — conservative ceiling + debt mitigates but does not eliminate all streaming/tool/vision surprise.
6. **$199 kit Polar listing is archived** (MIT-era SKU unlisted). Re-list is on hold. Hosted **$59/mo** is a separate live Polar product (CoS, 2026-09-27) and is not a checkout in this file. Do not treat the zip as a checkout.

---

## Ready gate

Design-time gate, updated for the v0.1.1 kit. Attack logs and the DR4 verdict stay in git and are not in the buyer zip.

- [x] DR×3 on this pack
- [x] LaunchGate 4th DR verdict on file: **APPROVE_WITH_CHANGES** (`docs/LAUNCHGATE_DR4_VERDICT.md` in git). Implement was unblocked.
- [x] MVP sidecar, brake curve (**BB_BRAKE_CURVE_1**, default off), and CI smoke are on main and in this zip
- [ ] A LaunchGate 4th CR verdict file is not in the repository. This kit does not invent one. The implementation is already merged.
- [x] Stranger happy path in [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md), [`START_HERE.md`](./START_HERE.md), and the README
- [x] **60s demo script** (mock upstream) in this kit
- [x] Operator surfaces in [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) shipped
- [x] Zip `burnbrake-0.1.1.zip`. SHA-256 lives in git at `checksums/burnbrake-0.1.1.sha256` (not inside the zip). Historical `checksums/burnbrake-0.1.0.sha256` stays and is not this kit.
- [x] $199 kit Polar listing is **archived** (MIT-era SKU unlisted). Re-list under PolyForm + the Commercial Grant is **on hold**. This kit does not ask CoS to republish it. Hosted **$59/mo** remains live on Polar and is not this zip.

### Founder-only (not LaunchGate)
Price · refund window · Polar public listing · Soft-WTP exceptions · paid spend · any scope that becomes Autumn/billing EMS.  

---

## Kill criteria (MVP)

1. Cannot reject next completion without upstream call in ≤60s demo → do not sell.  
2. Buyers demand invoicing/entitlement studio as must-have → walk away.  
3. Support band breached with no doc fix → pause sales.  
4. Fail-open ledger or free-release-after-forward ships → product-breaking; do not sell.  
5. Listing/docs claim “never overspend” contrary to one-call honesty → fix before sell.

---

## Differentiation one-liner

> Cap + kill on the request path. Autumn/Stigg meter and entitle; BurnBrake stops the next completion (and honestly admits one in-flight call may still overshoot).

*Last updated: 2026-09-27 ET — license fence ([`COMMERCIAL_GRANT.md`](./COMMERCIAL_GRANT.md), [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)); source-available commercial; OSI open source: false; v0.1.1 kit packed; v0.1.0 tag and checksums not resealed (grandfathered MIT); $199 kit Polar listing archived, re-list on hold; hosted $59/mo remains live (CoS) and separate; Soft-WTP off; exhaust unchanged.*
