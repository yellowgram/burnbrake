# BurnBrake — Design Pass 1 (narrative)

**Status:** **Design Pass 3 absorbed (DR×3 complete)** — remediations from [`DR3_ATTACKS.md`](./DR3_ATTACKS.md) folded in; still narrative, not code  
**Product:** BurnBrake — request-path spend governor for agent loops  
**Promise:** budget per user / per run / per day → atomic reserve → **reject the next completion** before it hits the model provider when reserve (including **debt**) cannot cover the **conservative estimate**. Honesty: **one already-forwarded call may still overshoot**; debt gates the next call — **not** magical zero overspend.  
**Not:** billing SoR, entitlement EMS, credit wallet, or Soft-WTP desk  
**Pricing (USD, founder lock):** **$199 once** self-host one-org license (primary) · **$59/mo** hosted optional · see [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)  
**Contact:** hello@yellowgram.dev  
**Polar:** listing **DARK — not Polar-ready** (see [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md); no zip/SHA artifacts yet)  
**Date:** 2026-09-26 ET — DR×3 complete; **no code**, no Polar listing, Soft-WTP OFF  

Companion locks: [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md) · [`MVP_SCOPE.md`](./MVP_SCOPE.md) · [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) · [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md) · [`DR3_ATTACKS.md`](./DR3_ATTACKS.md) · [`DR2_ATTACKS.md`](./DR2_ATTACKS.md) · [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md) · [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md)

Standing fences: Soft-WTP / cold invoices **FORBIDDEN** · stay **dumber than Autumn** (cap + kill only) · **LaunchGate 4th DR → implement → CR×3 → LaunchGate 4th CR** · MINIMUM_SUPPORT + OPERATOR_NEEDS before Polar-ready.

**Gate process:** ordinary design/code gates go to **LaunchGate** (independent 4th DR / 4th CR). Escalate to **founder** only for irreversible product decisions: price, refunds, Polar go-live, Soft-WTP, spending money, or scope creep into Autumn/billing EMS.

---

## 1. One-paragraph product

One runaway agent loop can burn the founder’s OpenAI (or Anthropic) bill before the monthly invoice arrives. OpenAI org/project hard limits are coarse and not instantaneous; billing platforms meter toward invoices; entitlements platforms gate *customer* features. BurnBrake sits **in front of the model client** as a local **pre-call spend gate**: scopes (user / run / day), atomic reserve, and a fail-closed **reject** of the next completion when the conservative estimate cannot be covered (including outstanding debt). **One in-flight (already forwarded) completion may still settle above reserve or debit-on-crash** — that is acknowledged; the next call is gated. Polar/Stripe exist only for optional commerce of the BurnBrake **kit/SKU itself** — never as in-path metering of OpenAI, and never as the job BurnBrake replaces.

---

## 2. Job to be done

| | |
| --- | --- |
| **Buyer** | Indie / tiny-team builders shipping agent loops (coding agents, chat wrappers, batch runners) who hold the **provider API key** and eat the bill |
| **Moment** | Overnight retry storm, context-window growth, sub-agent fan-out — cost explodes between dashboard refreshes |
| **Job** | Stop the **next** provider call when budget cannot cover the conservative estimate — not alert after the fact |
| **Anti-job** | Sell plans to end users, invoice overage, package entitlements, migrate Stripe, promise magical zero overspend on in-flight calls |

---

## 3. Competitive skim (hard-block gap called out)

### 3.1 Autumn ([useautumn.com](https://www.useautumn.com/), [docs](https://docs.useautumn.com/welcome))

**What they are:** Open-source pricing & billing control layer on Stripe. Core triad `attach` / `check` / `track`. SoR for plans, credits, entitlements, usage → Stripe invoices.

**Hard-block gap (explicit):**

| Mode | Does Autumn reject the next completion? |
| --- | --- |
| **Default usage-based feature** | **No hard block.** `check` returns `allowed: true` past included balance; usage accumulates; **invoice at period end**. Classic “bill arrives after burn.” |
| **Prepaid / included balance exhausted (no overage)** | `check` can return `allowed: false` — **if** the app calls `check` before every call. |
| **Spend limits** ([docs](https://docs.useautumn.com/documentation/modelling-pricing/spend-limits)) | **Opt-in.** With `overage_limit` enabled, `check` → `allowed: false` and `track` will not deduct beyond the cap. Without a spend limit, overage is unlimited. |
| **Usage alerts** | Webhooks at thresholds — **meter / notify**, not a request-path kill by themselves. |

**Verdict:** Autumn *can* hard-block when configured (prepaid, max purchase, or spend limits) **and** when the buyer wires `check` on every hot path. It does **not** default to “reject the next OpenAI completion for *my* runaway agent.” Default path is **meter → entitle → invoice**. Becoming Autumn (plans, Stripe lifecycle, credit systems) kills BurnBrake’s wedge — stay dumber: **cap + kill only**.

### 3.2 Stigg ([stigg.io](https://www.stigg.io/product/entitlements))

**What they are:** Upmarket entitlements / monetization EMS (plans, metered features, credits, sidecar/edge SDKs). Check → gate → report usage.

**Hard-block gap (explicit):**

| Mode | Does Stigg reject the next completion? |
| --- | --- |
| **Hard limit (default on metered entitlements)** | **Yes, as entitlement gate:** `hasAccess` / `isGranted` false when `requestedUsage` would exceed limit (`RequestedUsageExceedingLimit`) — **if** the app checks before the action. |
| **Soft limit** | **No.** Access continues; overage tracked for CS/upsell. |
| **Product center of gravity** | Customer **feature entitlements** + packaging UI + metering for monetization — not “protect founder’s provider key from agent loops.” |

**Verdict:** Stigg **does** hard-block *customer entitlements* by default (soft is optional). That is still the wrong product: EMS priced for Pro/enterprise packaging (~$399/mo class aggregates), not a dumb local governor on the founder’s own OpenAI bill. Steal the *discipline* (check with prospective usage before the call; report after) — do **not** steal the catalog/credits/widgets surface.

### 3.3 Close peers (note, do not chase)

| Peer | Role vs BurnBrake |
| --- | --- |
| **OpenAI org/project spend alerts & hard limits** | Coarse; enforcement not instantaneous; no per-user / per-run granularity inside a shared project |
| **OpenMeter / Lago / Orb / Metronome** | Usage → access/billing suites; heavy; complement at most |
| **Agentic SpendGuard / agentctl-style budgets** | Closest *shape* (request-path reserve + deny). Differentiate by staying thinner, Polar-shaped kit price, no crypto-audit theater unless demanded |
| **Credit-ledger kits / Autumn DIY** | Customer prepaid credits for *end users* — adjacent, different buyer job |
| **MayDo (sister)** | `allow(actor, action)` after Stripe/Polar paid — entitlements decision, not provider-spend kill |

### 3.4 Differentiation one-liner

> Autumn/Stigg **meter and entitle** (and only hard-block when you opt into their monetization model and call check). BurnBrake **rejects the next completion** on a local user/run/day cap — before the provider call — without becoming a billing platform. It does **not** claim zero overspend on an already-forwarded call.

---

## 4. Primary shape (locked; DR3 first-SKU + auth)

**Primary: OpenAI-compatible sidecar** (self-host first).

- Buyer sets `OPENAI_BASE_URL` (or equivalent) to the sidecar.
- Sidecar holds budget ledger; on each `/v1/chat/completions` (and documented siblings): **estimate → reserve → forward or reject → settle**.
- Multi-process / multi-pod agents share one ledger without in-process counters lying.

**Network & auth (DR2 P0 + DR3 tighten):**

- **Default bind `127.0.0.1`**. Non-loopback requires explicit `BURNBRAKE_ALLOW_PUBLIC_BIND=1` **and** app→sidecar auth still required (cannot disable auth when public-bound).
- **App→sidecar auth required by default.** Preferred header: **`X-BurnBrake-Key`** (alt: `Authorization: Bearer` with value prefixed **`bb_…`**). `user_id` / `run_id` accepted **only** from authenticated callers. Unauthenticated → **reject**.
- **Never reuse the provider API key as the BurnBrake secret** (and never send the BurnBrake secret upstream). Provider key stays on sidecar→provider hop only. Sidecar auth ≠ provider key.
- One secret per deploy (shared across agents on that deploy); rotation = env/CLI reload + agents pick up new key (blast radius documented). Multi-secret = Later.
- `/health` exposes listen address, `auth.required`, `ledger.writable`, `fail_closed=true`, price-table `version`/`priced_at`, `estimate.default_max_tokens` — **never** echoes secrets.

**Secondary: thin SDK wrapper** (TypeScript first) for non-HTTP or non-OpenAI-shaped clients — same reserve/settle protocol talking to the same ledger (local process or sidecar).

**First cash SKU (founder lock):** **$199 once** self-host one-org license (Polar **shape** after ready gate + **founder** go-live). **Hosted $59/mo** = optional later / **not** day-1 primary. Month-2 platform caps are expected; the buyer keeps the zip. Pack is **not Polar-ready** today. Checklist: [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md). Price: [`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md).

Rationale: stranger happy path is “point the base URL”; sidecar survives process crash better than a lone in-memory SDK counter; stays dumber than building Autumn; self-host proof before tenancy.

Detail locks: [`MVP_SCOPE.md`](./MVP_SCOPE.md).

---

## 5. Core request-path loop (DR2 SM + DR3 honesty / inject / settle)

```
before provider call:
  authenticate app→sidecar via X-BurnBrake-Key / bb_… (fail → REJECT, no forward)
  estimate cost CONSERVATIVELY:
    input estimate + output ceiling:
      use request max_tokens if present
      ELSE inject sidecar default (never silently lower a buyer-supplied higher ceiling)
    + documented vision/tool surcharges if those fields present
    unpriced model / unknown surcharge path → DENY (no silent $0)
  optional idempotency key: if same key in RESERVED/FORWARDED → do not double-forward
  atomic RESERVE across scopes (user ∧ run ∧ day), including any outstanding DEBT
  if any scope cannot cover → REJECT (no upstream call)
  else → mark FORWARDED → forward to provider
  NOTE: once FORWARDED, no mid-stream budget reject (next-call gate only)

after response (or failure):
  SETTLE actual usage when known; release unused reservation
  if settle > reserve → record DEBT; next reserve must cover debt
  upstream 5xx / disconnect after forward:
    settle if usage known; else DEBIT_RESERVED (assume estimate spent)
  client retry after forward failure: only with idempotency key

crash / TTL:
  if still RESERVED (never forwarded) → RELEASE (free)
  if FORWARDED (upstream may have billed) → DEBIT_RESERVED (assume spent)
    NEVER free-release after forward began
  operator force-release only for audited proven no-charge stuck rows
```

**Lexicon (DR2 + DR3 scrub):** speak **caps / remaining / reserve / settle / reject / debt** only on the spend path. Prefer **“pre-call spend gate”** over bare “hard cap.” Do **not** say credits, entitlements, or invoice overage in MVP surfaces. Later SKU name = **hosted sidecar/ledger tenancy** (not “hosted meter”).

**Reject path (buyer-visible):**

| Surface | Behavior |
| --- | --- |
| Sidecar HTTP | Non-2xx with stable body: `code=BUDGET_EXHAUSTED`, scope that failed, remaining, requested |
| SDK | Typed error / exception `BudgetExhausted` (same fields) |
| Agent loop | Must treat reject as **terminal for spend** — non-retryable halt; retries that re-hit the gate do not burn provider $; **do not** open a second ungated baseURL |

**HTTP status (draft → LaunchGate freeze):** working draft **`402`** for `BUDGET_EXHAUSTED`. Provider upstream errors pass through unchanged — never conflate BurnBrake exhaust with provider `429`. LaunchGate 4th DR may confirm `402` or pick alternate; **decision-table halt semantics stay** either way. See [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md).

**Fail closed (DR2 P0 — held):** ledger missing / unwritable / corrupt → refuse reserves **and** refuse forward (prefer refuse-start if ledger cannot open). **No MVP flag** for soft-allow-overage or warn-only. Soft alerts, if ever later, never replace reject.

---

## 6. Budgets (day-1)

| Scope | Meaning | Exhaustion |
| --- | --- | --- |
| **per-run** | One agent execution / session id | Stop that run’s further completions |
| **per-user** | End-user or internal actor id from **authenticated** app | Stop that actor across runs |
| **per-day** | **UTC day** default (ledger store clock); buyer TZ optional later | Soft calendar backstop |

All configured scopes AND together: deny if **any** would go negative (including debt). Units: **USD micros** with a **static versioned** price table (`version` + `priced_at`) for known models; unpriced models → **deny by default** (token-only only if explicitly configured — never silent $0). Stale table → **warn** in health/operator (draft threshold 30 days — LaunchGate freezes); never fail-open because stale.

**Production note:** per-run alone is washable by minting run ids; operators **must** set per-user and/or per-day for a real fence.

Cap raises: config / operator CLI only in MVP. Polar/Stripe commerce sells the BurnBrake kit — not in-path OpenAI metering.

---

## 7. What we refuse (fences; DR3 reinforced)

- Plan packaging studio, Stripe subscription lifecycle, invoice send, dunning, tax  
- Soft-WTP, cold invoices, waitlist monetization  
- Becoming Autumn/Stigg/Schematic/OpenMeter  
- MVP lexicon of “credits / entitlements / invoice overage” on the spend path  
- Marketing “never overspend” / magical zero burn after install  
- Claiming we replace OpenAI org hard limits, stop ungated second clients, or outrun OpenAI forever  
- Polar public listing / “Polar-ready” claims before zip/SHA/deliverables + founder go-live  
- Soft-only “alerts without reject” or fail-open ledger as MVP  
- Default bind `0.0.0.0` or auth-optional public proxy  
- Day-1 hosted multi-tenant as co-equal first SKU  

---

## 8. Support & operator readiness (before Polar)

Strangers must reproduce: start sidecar (localhost) → auth (`X-BurnBrake-Key`) → set base URL → under-budget call succeeds → over-budget call **rejects without upstream** → operator can see spent/remaining/debt and force-kill a run. **60s demo** with mock upstream required for ready-gate. Spec: [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md), [`OPERATOR_NEEDS.md`](./OPERATOR_NEEDS.md), [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md).

---

## 9. Kill criteria (draft)

1. Cannot demo reject-of-next-completion in ≤60s (mock upstream) without a sales call → do not list.  
2. Roadmap pressure to add plans/invoices/credit wallets as “minimum” → refuse or kill product; do not Soft-WTP.  
3. Autumn ships a **default** dumb hard-block sidecar for provider keys at free/cheap and eats the wedge → reassess (profile: “why it dies”).  
4. Support > thin band in [`MINIMUM_SUPPORT.md`](./MINIMUM_SUPPORT.md) with no doc fix → pause sales.  
5. Fail-open or free-release-after-forward ships → treat as product-breaking P0; do not sell.  
6. Pack or listing claims “never overspend” contrary to one-call honesty → treat as P0 honesty break; fix copy before sell.

---

## 10. Open questions → LaunchGate 4th DR

Paste-ready brief: [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md).

| Open (design) | Owner |
| --- | --- |
| Exact HTTP status + error schema freeze (`402` draft vs alternate) — keep halt semantics | LaunchGate 4th DR |
| Price-table SoT (pack: static versioned YAML) + stale warn threshold | LaunchGate 4th DR |
| First cash SKU (founder lock: **$199 once** self-host one-org; hosted **$59/mo** optional later / not day-1) | Shape was LaunchGate; **price is founder-locked** ([`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)) |
| Anthropic / other providers: day-1 OpenAI-shaped only vs multi-provider | LaunchGate 4th DR |
| Reservation TTL **numeric** default (state machine locked; draft 15m) | LaunchGate 4th DR |
| Default injected `max_tokens` value (policy locked; draft 4096) | LaunchGate 4th DR |
| Day TZ default (pack draft: UTC) | LaunchGate 4th DR |
| Idempotency key optional vs required on SDK happy path | LaunchGate 4th DR |
| Auth header final name (`X-BurnBrake-Key` draft) | LaunchGate 4th DR |

### Escalate to founder only
- **Price** is locked at **$199 once** / **$59/mo** hosted optional ([`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)); refund window stays founder  
- **Polar go-live** (listing light) — LaunchGate may approve ready-gate docs; founder owns flipping public  
- **Soft-WTP** / cold invoices (forbidden; any exception is founder)  
- **Spend** (paid infra, ads, contractors)  
- **Scope creep into Autumn** (plans, invoices, entitlement EMS) — refuse by default; founder if contested  

*Pass-1 narrative + DR2 + **DR3** remediations absorbed. **DR×3 complete.** Implement stays blocked until **LaunchGate 4th DR APPROVE**. Merge stays blocked until **CR×3 + LaunchGate 4th CR APPROVE**.*

*Last updated: 2026-09-27 ET — founder commercial lock ([`COMMERCIAL_LOCK.md`](./COMMERCIAL_LOCK.md)); exhaust unchanged; Polar dark; not Polar-ready.*
