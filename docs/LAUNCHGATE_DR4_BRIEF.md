# BurnBrake — LaunchGate 4th DR Brief (paste-ready)

**From:** Design Review ×3 (final adversarial pack pass)  
**To:** LaunchGate (independent 4th Design Review)  
**Date:** 2026-09-26 ET  
**Ask:** APPROVE / REJECT design freezes below so implement may start.  
**Do not:** implement code, light Polar, Soft-WTP, or spend — those are out of band.

---

## Product one-liner

**BurnBrake** is a request-path **pre-call spend gate** (OpenAI-compatible sidecar first): scopes user ∧ run ∧ day → conservative estimate → atomic reserve → **reject the next completion** before the provider when reserve (including debt) cannot cover — **cap + kill only**. Not billing SoR, not entitlements EMS, not Soft-WTP. Honesty: **one already-forwarded call may still overshoot**; debt gates the next call.

---

## In / Out (MVP)

**In:** Self-host OpenAI-shaped sidecar (default bind `127.0.0.1`); app→sidecar auth (`X-BurnBrake-Key` / `bb_…`); reservation state machine (never free-release after forward; crash/TTL while forwarded → DEBIT_RESERVED); conservative estimate (inject `max_tokens` **only if missing**); debt on overshoot; fail-closed ledger; draft `402` + `BUDGET_EXHAUSTED` halt table; thin TS SDK secondary; operator balances/log/kill/caps; mock-upstream 60s demo path; static versioned price YAML.

**Out:** Autumn/Stigg clone; credits/entitlements/invoice-overage on spend path; Soft-WTP; fail-open; public bind without auth; Polar light; hosted multi-tenant as day-1 SKU; claiming ungated-client stop or org-limit replacement.

**Later:** Hosted sidecar/ledger tenancy (~$29 draft); multi-provider; richer estimates; multi-secret auth.

---

## Resolved locks from DR×3 (treat as pack truth unless you REJECT)

1. Promise = **pre-call reject of next completion** + debt — **not** magical zero overspend on in-flight call.  
2. First cash SKU = **self-host kit only**; hosted tenancy Later (rename off “hosted meter”).  
3. Auth: distinct BurnBrake secret; never reuse provider key; preferred header `X-BurnBrake-Key`.  
4. `max_tokens`: inject default only when omitted; never silent down-clamp of buyer value.  
5. Price table: **static versioned YAML** + `priced_at`; unpriced → deny; stale → warn (not fail-open).  
6. Decision table v2: no mid-stream budget kill after FORWARDED; upstream 5xx/partial after forward → settle if usage known else DEBIT_RESERVED; retries need idempotency key.  
7. Polar: DARK; [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) checklist exists (design); no zip/SHA claims yet.  
8. Lexicon: caps / remaining / reserve / settle / reject / debt only on spend path.

DR2 holdings that still stand: localhost default; fail-closed ledger; no soft-allow-overage; never free-release after forward.

---

## Open questions — need LaunchGate APPROVE / REJECT

| ID | Question | Pack draft | Your call |
| --- | --- | --- | --- |
| **LG-1** | HTTP status for budget exhaust | `402` + `BUDGET_EXHAUSTED` (halt non-retryable) | APPROVE `402` **or** REJECT→alternate status **with same halt semantics** |
| **LG-2** | Price-table source of truth | Static versioned YAML (not live feed) | APPROVE static **or** REJECT→live feed shape |
| **LG-3** | First cash SKU | Self-host kit only; hosted Later | APPROVE shape (**escalate founder** if changing price ladder) |
| **LG-4** | Providers day-1 | OpenAI-shaped HTTP only | APPROVE **or** REJECT→add Anthropic/etc. |
| **LG-5** | Reservation TTL default | State machine locked; numeric draft **15m** | Freeze seconds/minutes |
| **LG-6** | Default injected `max_tokens` | Policy locked; numeric draft **4096** | Freeze number |
| **LG-7** | Day boundary TZ | **UTC** (ledger store clock) | Confirm **or** alternate |
| **LG-8** | Idempotency key | Optional + documented | Optional **or** required on SDK happy path |
| **LG-9** | Stale price-table policy | Warn at **30 days**; still not fail-open | Freeze threshold; warn vs deny-when-stale |
| **LG-10** | Auth header final name | `X-BurnBrake-Key` (Bearer `bb_…` allowed alt) | Freeze |

### Founder-only (do not decide as LaunchGate)

Price · refund window · Polar public listing light · Soft-WTP exceptions · paid spend · Autumn/EMS scope exceptions.

---

## Known P2 limits (do not market closed)

- Day-boundary / multi-writer clock skew without one ledger store  
- Ungated second client (docs loud; not cryptographically forced)  
- Authenticated `run_id` rotation washes per-run-only configs  
- One in-flight overshoot / debit-on-crash residual (promise now explicit)  
- Estimate polish beyond ceiling + debt  
- Not Polar-ready until ready-gate + founder go-live  

---

## Ready-gate checklist (post-APPROVE path)

1. LaunchGate 4th DR **APPROVE** → implement allowed  
2. Implement + **CR×3**  
3. LaunchGate 4th CR **APPROVE** → squash-merge allowed  
4. MINIMUM_SUPPORT stranger path + **60s mock demo** green  
5. OPERATOR_NEEDS surfaces shipped  
6. zip + SHA256 + POLAR_DELIVERABLES checklist complete  
7. Listing stays **dark** until **founder** Polar go-live  

---

## Pack paths (read these)

| Doc | Role |
| --- | --- |
| [`DESIGN_PASS_1.md`](./DESIGN_PASS_1.md) | Narrative (Design Pass 3 absorbed) |
| [`MVP_SCOPE.md`](./MVP_SCOPE.md) | In/Out/Later + known limits |
| [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) | Happy path, decision table v2, 60s demo |
| [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) | Operator see/do |
| [`DR3_ATTACKS.md`](./DR3_ATTACKS.md) | Final attack log + DR2 scorecard |
| [`DR2_ATTACKS.md`](./DR2_ATTACKS.md) | Prior pass (held fixes) |
| [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) | Dark listing zip/SHA checklist (design) |

**Repo root for pack:** `/workspace/burnbrake/`

---

## Suggested LaunchGate verdict block (reply template)

```
VERDICT: APPROVE | REJECT | APPROVE_WITH_CHANGES
LG-1..LG-10: (each APPROVE/REJECT + value if freezing)
BLOCKERS: (none | list)
NOTES: (freezes that differ from pack draft)
FOUNDER_ESCALATIONS: (none | list)
```

*End brief. DR×3 complete; implement blocked until your APPROVE.*
