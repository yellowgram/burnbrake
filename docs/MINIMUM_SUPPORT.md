# BurnBrake — Minimum Support Surface (before Polar)

**Product:** BurnBrake — request-path spend governor  
**Pricing (USD, founder lock):** **$199 once** self-host one-org license (primary) · **$49/mo** hosted optional · see [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)  
**Contact:** hello@yellowgram.dev  
**Goal:** Strangers self-serve the happy path; founder support stays thin and bounded.  
**Polar:** listing **DARK — not Polar-ready** ([`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md))  
**Date:** 2026-09-26 ET — Design Pass 3 absorbed ([`DR3_ATTACKS.md`](./DR3_ATTACKS.md); DR×3 complete)

Modeled on yellowgram MINIMUM_SUPPORT discipline (docs replace the founder; boundary written once). Process quality borrowed from Guard checklist (decision table, localhost bind, fail-loud misconfig) — **wallet Guard ≠ BurnBrake scope**.

---

## Support boundary (write once, link everywhere)

- **Channel:** **60-day Issues**, no SLA (same fence as HookSteel). Email `hello@yellowgram.dev` in that window.
- **Scope:** BurnBrake sidecar/SDK behavior, budget config, reject path, auth/bind, operator CLI/UI shipped with the kit.
- **No SLA.** Best-effort only. Do not invent a paid SLA at launch.
- **Time box:** the fence is 60 days of Issues, not an on-call band. If volume exceeds what docs can absorb → pause new founders or productize the FAQ — do **not** Soft-WTP.
- **Require for any ticket:** BurnBrake version/tag; sidecar vs SDK; OS; listen bind; auth enabled yes/no; failing request identity (`user_id`, `run_id`); expected vs actual (did upstream get called?); redacted config booleans only — **no live provider API keys**, no live Polar/Stripe secrets, no BurnBrake shared secrets in cleartext.

### What the $199 fee includes

See [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md). The primary fee is the self-host one-org license. It includes:

- Perpetual self-host for **one organization**
- Tag + SHA + the **402 / debt / run-id** contract (exhaust unchanged: halt, not retryable)
- **60-day Issues**, no SLA (same fence as HookSteel)
- **Brake-curve** config in the tree ([`DESIGN_BRAKE_CURVE.md`](./DESIGN_BRAKE_CURVE.md))
- **No claim** that BurnBrake will outrun OpenAI forever

Hosted **$49/mo** is optional and not the day-1 primary. Month-2 platform caps are expected. The buyer keeps the zip. Polar stays dark.

---

## Stranger-reproducible happy path (must work offline of founder)

1. Install / start sidecar from kit README (Docker or one binary — pick one default in implement). **Default listen `127.0.0.1`**; set app→sidecar **`X-BurnBrake-Key`** (or Bearer `bb_…`). **Never** put the provider key in the BurnBrake auth header.
2. Set budgets: e.g. run=$1, day=$5, user=$10 (document exact config keys). Prefer setting **user or day** in addition to run.
3. Point OpenAI client `baseURL` at sidecar with BurnBrake auth header; use **mock upstream** for first proof (kit must ship mock path).
4. **Confirm no second ungated client** in the app (no raw `api.openai.com` client left in tree). BurnBrake only governs traffic that hits the sidecar.
5. **Under budget:** one completion succeeds; operator view shows reserve → settle (or debit path).
6. Lower run cap (or burn it with N calls) → **next** completion returns `BUDGET_EXHAUSTED` (**draft HTTP `402`**) and **upstream call count stays flat** (prove with mock/counter).
7. Confirm agent sample **halts** (does not retry-as-rate-limit; does not open second ungated client).
8. For long jobs: set your own `max_tokens` (sidecar injects default **only when omitted**; it will not silently lower your higher ceiling — but a high ceiling means a larger reserve and may deny earlier).
9. Operator kills or raises cap → further calls behave as documented.

If this path needs a founder screenshare, the product is not Polar-ready.

---

## 60s demo script (ready-gate; mock upstream)

**Preconditions:** sidecar already running on `127.0.0.1`, mock upstream on, BurnBrake key set, run cap tiny (e.g. enough for one short allow then deny).

| t | Step | Pass criterion |
| --- | --- | --- |
| 0–10s | `GET /health` | listen=`127.0.0.1`, `auth.required=true`, `fail_closed=true`, `ledger.writable=true` |
| 10–25s | One under-budget completion via sidecar | `200`; mock upstream count += 1; reserve→settle visible |
| 25–45s | Exhaust run (or lower cap) → next completion | non-2xx `BUDGET_EXHAUSTED` (draft `402`); **mock upstream count unchanged**; decision `upstream_forwarded=false` |
| 45–60s | Show operator: remaining/debt; optional note | Promise honesty: next call gated; one in-flight call could have overshot |

If any step needs live OpenAI $ or a founder screenshare → not Polar-ready.

---

## Agent decision table v2 (DR2 + DR3 — docs replace founder)

Paste into agent repos. LaunchGate may freeze final HTTP status; **halt semantics stay**.

| Signal | HTTP (draft) | `code` / shape | Retry spend call? | Agent action | Human action |
| --- | --- | --- | --- | --- | --- |
| Budget exhausted | **`402`** | `BUDGET_EXHAUSTED` + scope + remaining + requested | **No** (non-retryable) | **Halt** run/loop for spend; surface error | Raise cap, wait day boundary, clear debt, or kill run |
| Auth failure to sidecar | `401`/`403` | sidecar auth | No (fix config) | Halt; **do not** fall back to `api.openai.com` | Fix `X-BurnBrake-Key` / bind; do not paste provider key as BurnBrake secret |
| Ledger / fail-closed refuse | non-2xx | `LEDGER_UNAVAILABLE` (or refuse-start) | No blind retry storm | Halt or backoff with operator alert | Fix disk/ledger; never “soft allow” |
| In-flight duplicate | same as first | same idempotency key | Do not start a **second** forward | Wait / reuse key | — |
| Streaming in flight (`FORWARDED`) | n/a mid-stream | — | n/a | **No mid-stream budget kill**; wait for settle; next call gated | — |
| Provider rate limit | provider `429` (pass-through) | upstream body | Per provider policy — **not** BurnBrake exhaust | Distinguish from `BUDGET_EXHAUSTED` | — |
| Provider 5xx / disconnect after forward | upstream / transport | — | Only with **idempotency key**; else risk double bill | Prefer kill-run or cautious retry | Check log: settle if usage known else expect **DEBIT_RESERVED** |
| Partial upstream + usage known | settle path | — | n/a | Continue per settle | Debt if settle > reserve |
| Upstream success | `200` | — | n/a | Continue | — |

**Hard rules:** `BUDGET_EXHAUSTED` is never “treat like 429 and retry.” Never open a second ungated `baseURL` to “work around” BurnBrake. Once forwarded, BurnBrake will not mid-stream kill for budget.

---

## FAQ (DR3 honesty)

**Can I still overspend one call?** Yes — one already-forwarded completion may settle above reserve or debit-on-crash. BurnBrake rejects the **next** call when reserve+debt cannot cover the conservative estimate. Do not market “never overspend.” **No claim** that BurnBrake will outrun OpenAI forever.

**Does BurnBrake stop clients that never pointed at the sidecar?** No. Fix dual clients; see troubleshooting #1.

**Why was my long completion truncated / denied early?** If you omitted `max_tokens`, sidecar injected a default ceiling for estimate. Set your own `max_tokens` for long jobs; a high value reserves more and may deny earlier (correct).

---

## What founding customers get (least surface)

### Included
1. **START_HERE** — localhost sidecar → `X-BurnBrake-Key` → baseURL → dual-client check → first allow → first reject in ≤15 min.  
2. **Reject contract + decision table v2** — `BUDGET_EXHAUSTED` fields, draft `402`, SDK mapping, halt / no mid-stream kill / 5xx settle matrix.  
3. **60s demo script** — mock upstream proof.  
4. **Operator runbook** — balances (incl. debt), decisions log, kill run, adjust caps, auth rotation ([`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md)).  
5. **Known limits** — not Autumn; not org-limit replacement; OpenAI-shaped routes only at MVP; hosted tenancy later; one-call overshoot honesty; P2 list in [`MVP_SCOPE.md`](./MVP_SCOPE.md).  
6. **Honesty** — Autumn/Stigg hard-block gap called out so wrong-fit buyers walk to billing EMS instead of opening feature tickets.  
7. **Bind/auth poison labels** — `0.0.0.0` without ACL + auth = fund drain; provider key ≠ BurnBrake key.

### Explicitly not included
- Building the buyer’s agent product or prompt graph.  
- Debugging live provider keys or PCI questions.  
- Invoice/tax/dunning/entitlement packaging / “credit wallets.”  
- On-call for buyer’s agent loops in production.  
- Soft-WTP outreach or “free forever upgrades.”  
- Custom multi-provider adapters beyond documented MVP routes.  
- Making BurnBrake stop clients that never pointed at the sidecar.  
- Magical zero overspend on already-forwarded calls.

---

## Docs that replace the founder

| Doc / surface | Job |
| --- | --- |
| **START_HERE** | Happy path above (localhost + auth + dual-client check first) |
| **DEMO_60S** | Timed mock-upstream reject proof |
| **Reject / status contract + decision table v2** | Exhaust vs upstream; halt vs retry; streaming/5xx |
| **Troubleshooting top 10** | **#1 dual ungated client / baseURL not used**; provider key sent as BurnBrake auth (or reverse); auth missing; bind `0.0.0.0` drain; estimate undercount → debt; price-table stale; reservation TTL **debit** surprise; injected `max_tokens` UX; day boundary UTC; unpriced model deny; idempotency / timeout double-forward |
| **Out-of-scope auto-reply** | Invoicing / Autumn clone / credits portal / Soft-WTP / live-key dump / “make my agent smarter” / “fail open when ledger down” / “stop my other client that never hit the sidecar” / “guarantee zero overspend on in-flight calls” |
| **Glossary** | Reserve ≠ charge · reject ≠ refund · debt ≠ invoice · BurnBrake gate ≠ OpenAI org limit · free-release only pre-forward · one in-flight overshoot possible · replay N/A (not HookSteel) |

---

## Money & listing hygiene

- Product prices stay **USD**. Founder may track costs in INR privately; do not India-localize the wedge.  
- Polar listing **dark** until zip/SHA/[`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md); this doc does **not** claim Polar-ready.  
- Refund/cancel policy for the **kit SKU** written before charging; do not conflate with budget “release reservation” / debt language.

---

## Kill clocks

1. Support >2 h/week sustained with no doc gap closed → pause sales.  
2. Buyers demand billing EMS / credits portal as “minimum support” → refuse; point to Autumn/Stigg/OpenMeter — do not build it.  
3. Secret-in-ticket culture → close with template; do not debug live keys.  
4. Strangers treat design “Polar candidate” as listed product → correct with DARK honesty; founder owns go-live.  
5. “BurnBrake lied — I still overspent one call” without FAQ/honesty copy → fix docs before more sales.

*Last updated: 2026-09-27 ET — founder commercial lock ([`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)); 60-day Issues, no SLA; Polar dark; not Polar-ready.*
