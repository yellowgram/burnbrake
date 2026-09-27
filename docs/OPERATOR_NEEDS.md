# BurnBrake — Operator Needs (pre-call spend gate, safely)

**Product:** BurnBrake — request-path spend governor  
**Audience:** founding-customer operator (founder-CTO or the eng who owns the provider key)  
**Date:** 2026-09-26 ET — Design Pass 3 absorbed ([`DR3_ATTACKS.md`](./DR3_ATTACKS.md); DR×3 complete)  
**Polar:** kit ready for CoS publish after founder GO; the listing is not live ([`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) is in the git repository, not the buyer zip)  

Operators must answer four questions without pinging yellowgram: **What’s left? What was denied? Can I stop a runaway run now? Did we accidentally call the provider after a reject?**

Honesty reminder: BurnBrake gates the **next** call. One already-forwarded call may still overshoot (settle > reserve → debt, or debit-on-crash). Do not promise teammates “never overspend.”

---

## 1. Budgets & balances (see / do)

### Must see
- Current **remaining**, **spent**, **debt**, and **active reservations** for user / run / day.  
- Cap values + reset boundary for day (**UTC** default; ledger store clock).  
- Price-table **`version`** + **`priced_at`** (so “why was this estimate?” is answerable; warn when stale — draft 30d).  
- `estimate.default_max_tokens` in effect (inject only when request omits `max_tokens`).  
- Warning when **only per-run** is configured (run-id rotation washes the fence — set user and/or day).

### Must do
- Set / raise / lower caps without redeploying app code (config reload or CLI).  
- Pause **all** spend (global kill) and pause **one run_id**.  
- Never: open Net-term invoices, edit Stripe prices, “soft allow overage,” or fail-open when ledger is down.

### Safety rule
Any scope at zero **or** outstanding debt that blocks cover → next reserve **fails closed**. Soft alerts (optional later) never replace reject. Ledger unwritable → **no forward**.

---

## 2. Decision log (see / do)

### Must see
- Append-only (or time-bounded) log: timestamp, user_id, run_id, decision (`ALLOW`/`DENY`), requested micros, remaining after, debt delta, model route, latency bucket, idempotency key if present, **`price_table_version`**.  
- Filter: deny-only (support’s #1: “why did the agent stop?”).  
- Proof field or correlated counter: **upstream_forwarded** true/false (deny must be false).  
- Reservation terminal reason: `SETTLED` | `RELEASE_PRE_FORWARD` | `DEBIT_TTL_OR_CRASH` | `DEBIT_UPSTREAM_UNKNOWN` | `FORCE_RELEASE_AUDITED`.

### Must do
- Export a window for one `run_id` / `user_id` (JSON/CSV) for postmortems.  
- Retention policy documented (buyer-owned self-host).

### Must not
- Turn the log into a full product-analytics suite.  
- Log raw prompts/completions by default (opt-in only; off in MVP docs).  
- Speak “credits / entitlements / invoice” in operator UI copy.

---

## 3. Runaway controls (see / do)

### Must see
- Top runs by spend in the last 1h/24h.  
- Reservation age / TTL pressure (stuck `FORWARDED` rows → expect **debit**, not silent free-release).  
- Sidecar health: process up, **listen address**, `auth.required`, `ledger.writable`, `fail_closed`, price-table freshness, upstream error rate vs BurnBrake denies.

### Must do
- **Kill run:** refuse further reserves for `run_id` immediately.  
- **Force-release stuck reservation** only when audited proven **no upstream charge** — rare; default TTL path **debits** after forward.  
- **Rotate BurnBrake auth** (`X-BurnBrake-Key` / `bb_…`) per runbook — **not** the provider key. Expect all agents on the deploy to pick up the new key (one secret per deploy; blast radius = whole deploy).  
- Confirm bind stays localhost unless `BURNBRAKE_ALLOW_PUBLIC_BIND=1` **and** auth on; treat public bind as poison without ACL.  
- After agent deploy: confirm `baseURL` → sidecar; BurnBrake auth header present; **no dual ungated clients**.

### Health = green when
- Denies never show `upstream_forwarded=true`.  
- Ledger durable across sidecar restart; fail-closed if not writable.  
- Global kill flips deny within one request.  
- `auth.required=true` and listen address match operator intent.  
- Price-table not silently ancient without a warn flag.

---

## 4. Estimate vs settle (see / do)

### Must see
- Per decision: estimated micros vs settled micros; overshoot events (settle > reserve) → **debt**.  
- Policy on overshoot: **debt gates next reserve** until cleared by remaining headroom or cap raise (document one; no silent forgive).  
- Output ceiling source: request `max_tokens` vs sidecar-injected default (inject **only if missing**; never silent down-clamp).  
- Upstream 5xx/partial after forward → settle if usage known else debit-reserved.

### Must do
- Update price table when provider pricing changes (version bump + `priced_at`).  
- Handle unpriced models per MVP policy (**deny default**) without silent $0.  
- Teach teammates: high `max_tokens` ⇒ larger reserve (may deny earlier — correct); omit ⇒ injected default.

---

## Operator daily / weekly checklist

| Cadence | Check |
| --- | --- |
| Daily | Deny rate; top runs by spend; global kill not left on; debt backlog |
| After agent deploy | `baseURL` → sidecar; `X-BurnBrake-Key` present; **no raw provider client** left in tree |
| After incident | Export run decision log; verify zero upstream on denies; check TTL **debits** vs unexpected free-releases; adjust caps |
| Weekly | Day-boundary UTC sanity; **price-table freshness** (`priced_at`); reservation TTL metrics; bind/auth health fields |
| Before any public bind | Auth on; ACL/firewall; understand open-proxy fund-drain risk |
| On key rotation | Rotate BurnBrake secret; restart/reload agents; never rotate by swapping in the provider key |

---

## UI vs CLI (shape)

MVP can ship **CLI + minimal read UI** or logs-only — must cover balances (incl. debt), decision log, kill run, set caps, health truth, auth rotation notes.

| Surface | Minimum viable control |
| --- | --- |
| Balances | Show user/run/day remaining + caps + debt + active reserves |
| Decisions | List / filter denies / export; terminal reason; price_table_version |
| Kill | Pause run + global pause |
| Caps | Set scopes (warn if only per-run) |
| Proof | `upstream_forwarded` on each decision |
| Health | listen, auth.required, ledger.writable, fail_closed, priced_at, default_max_tokens |

---

## Brake curve (shipped)

Operator surface: `burnbrake brake show|set` and `/v1/operator/brake` (operator key only; spend key stays rejected). See [`DESIGN_BRAKE_CURVE.md`](./DESIGN_BRAKE_CURVE.md) and [`OPERATOR.md`](./OPERATOR.md) (**BB_BRAKE_CURVE_1**). `brake.enabled` defaults to false and is not a halt-off switch. A black delay is a pre-402 pause only; waiting does not change the exhaust verdict.

---

## Non-goals for operators (deflect)

- Building Autumn-style plans or Stigg packaging / credit portals.  
- Customer entitlement portals.  
- Replacing OpenAI’s org billing dashboard.  
- Soft-WTP collection workflows.  
- “Please fail open so my demo doesn’t break.” → refuse; fix ledger or raise caps.  
- “Guarantee zero overspend including in-flight calls.” → refuse; explain next-call gate + debt.  
- “Stop the other client that never hits the sidecar.” → refuse; dual-client checklist.

*Last updated: 2026-09-27 ET — operator surface is in the v0.1.0 kit. Polar listing is not live; Suthirth solutions publishes after founder GO. Soft-WTP off. Exhaust unchanged.*
