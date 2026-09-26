# BurnBrake — MVP Scope (locked; Design Pass 3 absorbed — DR×3 complete)

**Product:** BurnBrake — request-path spend governor  
**Promise:** reject the next completion when user/run/day budget cannot cover the conservative estimate (including debt). Honesty: **one already-forwarded call may still overshoot** — not magical zero overspend.  
**Primary shape:** OpenAI-compatible **sidecar** (self-host); thin **SDK** secondary  
**Pricing (USD, draft):** **~$149 self-host kit** = first cash SKU shape · ~$29/mo **hosted sidecar/ledger tenancy** = **Later**  
**Contact:** hello@yellowgram.dev  
**Polar:** listing **DARK — not Polar-ready** ([`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md); no zip/SHA artifacts yet)  
**Date:** 2026-09-26 ET — design only; no product code · DR3 remediations from [`DR3_ATTACKS.md`](./DR3_ATTACKS.md)

Narrative: [`DESIGN_PASS_1.md`](./DESIGN_PASS_1.md) · Support: [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) · Ops: [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) · Brief: [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md)

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

### 5. Thin SDK (secondary)
- TypeScript wrapper using the same reserve/settle protocol (local ledger or sidecar).
- Same reject error type as HTTP body mapping; decision-table halt behavior documented.

### 6. Operator minimum
- See balances by scope (incl. debt + active reservations); list recent decisions (allow/deny); kill/pause a run; adjust caps; proof `upstream_forwarded=false` on denies; price-table version; auth rotation runbook.
- Details: [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md).

### 7. Delivery honesty
- **First cash SKU = self-host kit** (Polar-**shaped** when ready); hosted sidecar/ledger tenancy is Later.
- Polar public listing **out** until zip / SHA / [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) + **founder** go-live.
- This pack is **not Polar-ready**.
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
| **Polar public listing / Polar-ready claims** | Dark until deliverables + founder |
| **Default `0.0.0.0` bind or auth-optional public proxy** | Fund-drain class |
| **Day-1 hosted multi-tenant as co-equal first SKU** | Self-host first (DR3) |
| **Multi-PSP spend aggregation as day-1** | Kit commerce ≠ OpenAI metering |
| **Replacing OpenAI org hard limits / stopping ungated second clients** | Complement + honesty; don’t claim |
| **Cryptographic compliance theater / FedRAMP path** | Upmarket SpendGuard-class; stay dumb |
| **Implementation services as primary offer** | Product = governor |

---

## Later (not MVP)

- Hosted multi-tenant sidecar/ledger tenancy (~$29/mo draft) after self-host proof.
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

Sidecar: non-2xx + JSON body — **draft `402`**. SDK: thrown `BudgetExhausted`. Exact HTTP status frozen at **LaunchGate 4th DR**; agent **halt** semantics locked now.

---

## Known limits (P2 — LaunchGate / founder visibility)

From [`DR2_ATTACKS.md`](./DR2_ATTACKS.md) + [`DR3_ATTACKS.md`](./DR3_ATTACKS.md); **do not market as closed**:

1. **One in-flight overshoot / debit-on-crash** — pre-call gate + debt; already-forwarded call may exceed reserve or debit estimate; promise is next-call reject, not magical zero overspend.
2. **Day-boundary / multi-writer clock skew** — ledger uses store-side UTC day key; skewed multi-pod clocks without one store can split buckets near midnight.
3. **Ungated second client** — process that ignores sidecar `baseURL` and calls the provider directly bypasses BurnBrake; docs/checklist elevated (DR3); still not code-forced.
4. **Authenticated `run_id` rotation** — per-run-only configs are washable; production needs per-user and/or per-day AND.
5. **Estimate polish residual** — conservative ceiling + debt mitigates but does not eliminate all streaming/tool/vision surprise.
6. **Not Polar-ready** until ready-gate checklist green + founder listing light.

---

## Ready gate (before Polar light)

- [x] DR×3 on this pack  
- [ ] **LaunchGate 4th DR APPROVE** (opens implement)  
- [ ] Implement + CR×3  
- [ ] **LaunchGate 4th CR APPROVE** (opens squash-merge)  
- [ ] Stranger happy path in [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) green  
- [ ] **60s demo script** (mock upstream) green  
- [ ] Operator surfaces in [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) shipped or CLI-complete  
- [ ] Bind/auth/fail-closed/state-machine behaviors covered in demo or tests  
- [ ] zip + SHA + [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) checklist complete  
- [ ] Listing stays **dark** until **founder** Polar go-live (LaunchGate may approve ready-gate docs only)

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

*Last updated: 2026-09-26 ET — Design Pass 3 absorbed (DR×3 complete); design pack only; not Polar-ready.*
