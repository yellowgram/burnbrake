# BurnBrake — Design Review ×2 (DR2) Attack Log

**Pass:** progressive adversarial expert design iteration **#2 of 3**  
**Date:** 2026-09-26 ET  
**Stance:** three blades in one pass — (A) security/ops, (B) OSS DX/support, (C) agent-integrator buyer  
**Rule:** attacks that would kill a stranger buy **or** burn provider $  
**Outcome:** P0/P1 remediations absorbed into pack (`DESIGN_PASS_1.md`, `MVP_SCOPE.md`, `MINIMUM_SUPPORT.md`, `OPERATOR_NEEDS.md`). P2 left as known limits with LaunchGate/founder visibility.  
**Not done:** product code · PRs · LaunchGate contact · Soft-WTP · Polar light

Process quality borrowed from Guard checklist discipline (decision table, localhost bind, fail-loud misconfig, honesty non-goals) — **wallet Guard ≠ BurnBrake scope**.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Stranger-buy killer or provider-$ burn under intended use / common misconfig — **must design-close before DR×3** |
| **P1** | Support-bleed or false-safety that becomes P0 under load — **design-close in this pass** |
| **P2** | Real limit; document + LaunchGate/founder visibility; do not pretend closed |

---

## Attack catalog

### Attack 1 — Crash / TTL free-release after forward (double-spend of budget)

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Security/ops |
| **Evidence** | Pass-1 loop: “crash/TTL → auto-release reservation (no permanent lock).” Free-release after the sidecar has already forwarded burns provider $ while the ledger restores remaining — next call reserves again → **overspend despite “hard cap.”** Permanent lock is the lesser evil; free-release after forward is fund-loss. |
| **Failure mode** | Reserve → forward → process crash / network drop before settle → TTL releases full reserve → actual tokens already billed by OpenAI → budget lies high. |
| **Required design change** | **Reservation state machine (absorb):** `RESERVED` → reject/pre-forward failure → **RELEASE**; after upstream forward begins → `FORWARDED` → settle actual **or** upstream confirmed no-charge → release unused; on crash/TTL while `FORWARDED` → **DEBIT_RESERVED** (assume estimate spent), never free-release. Operator audited “force-release” only for proven no-charge stuck rows. |
| **Absorbed in** | DESIGN_PASS_1 §5 · MVP_SCOPE In · OPERATOR_NEEDS §3–4 |

---

### Attack 2 — Estimate undercount (streaming / tools / vision / unset max_tokens)

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Security/ops + buyer |
| **Evidence** | Pass-1: “estimate cost (tokens×price table OR fixed per-call ceiling)” with no ceiling mandate. Streaming completions, tool loops, vision parts, and missing `max_tokens` make prompt-only estimates lie low → reserve passes → settle overshoots → “hard cap” already breached. |
| **Failure mode** | Agent sets no `max_tokens`; model streams 8k completion; vision/tools add uncounted tokens; reserve was input-only → provider bill exceeds remaining. |
| **Required design change** | **Conservative estimate (absorb):** input estimate + **required output ceiling** (`max_tokens` from request **or** sidecar-injected default ceiling from config) × output price + documented vision/tool surcharges when those request fields present; unpriced / unknown surcharge paths → **deny** (no silent $0). Streaming: hold `FORWARDED` until final usage; settle actual. **Overshoot → debt** against scopes; next reserve fails until debt cleared or caps raised. Honesty: hard cap = pre-call gate + debt, not magical zero-overshoot. |
| **Absorbed in** | DESIGN_PASS_1 §5–6 · MVP_SCOPE In/Reject · OPERATOR_NEEDS §4 · MINIMUM_SUPPORT troubleshooting |

---

### Attack 3 — Identity spoofing (`user_id` / `run_id` headers)

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Security/ops |
| **Evidence** | Pass-1 budgets keyed on buyer-passed ids with no auth model. Any client that can reach the sidecar can mint fresh `run_id`s (reset per-run), spoof a fat `user_id`, or burn another actor’s remaining. |
| **Failure mode** | Malicious or buggy agent sets `x-user-id: other-tenant` or rotates `run_id` every call → per-run caps never bind; shared-user budgets drained. |
| **Required design change** | **App→sidecar auth required by default** (shared secret / Bearer). Accept `user_id`/`run_id` **only** from authenticated callers. Unauthenticated → **reject** (prefer) or single locked global bucket — do not trust raw headers from the open network. Document: per-run freshness is intentional; **per-user ∧ per-day** backstops rotation abuse; operators must set those. Optional later: signed identity tokens — not MVP. |
| **Absorbed in** | DESIGN_PASS_1 §4–5 · MVP_SCOPE In · OPERATOR_NEEDS §3 · MINIMUM_SUPPORT |

---

### Attack 4 — Sidecar as open proxy (`0.0.0.0` + no auth)

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Security/ops (Guard process analogue: localhost bind) |
| **Evidence** | Pass-1 never locks bind address. Misbound sidecar + buyer provider key in env = anyone on the network burns the founder’s OpenAI bill through BurnBrake (or around the ledger if auth missing). |
| **Failure mode** | Docker `-p 8080:8080` + default `0.0.0.0` on a VPS; crawler or coworker hits `/v1/chat/completions`; fund drain. |
| **Required design change** | **Default bind `127.0.0.1`**. Non-loopback bind requires explicit `BURNBRAKE_ALLOW_PUBLIC_BIND=1` **and** app→sidecar auth still required (auth cannot be disabled if public bind). `/health` shows listen address + `auth.required=true`. README poison-labels public bind. |
| **Absorbed in** | DESIGN_PASS_1 §4 · MVP_SCOPE In · OPERATOR_NEEDS · MINIMUM_SUPPORT START_HERE / troubleshooting |

---

### Attack 5 — Soft-only / fail-open ledger slipping into MVP

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Buyer + ops |
| **Evidence** | Promise is reject-before-provider. Soft alerts “optional later,” status freeze deferred, and no explicit “ledger down ⇒ reject” lock. A fail-open path (DB lock, disk full, “degraded mode”) silently becomes Soft-WTP-adjacent: burn continues, bill arrives later. |
| **Failure mode** | Ledger unwritable → sidecar forwards “so agents keep working” → overnight drain; or config flag `soft_allow_overage=true` ships “for DX.” |
| **Required design change** | **Fail closed everywhere on the spend path:** ledger missing/unwritable/corrupt → **refuse reserves and refuse forward** (prefer refuse-start if ledger cannot open). **No MVP config** for soft-allow-overage / warn-only. Soft alerts, if ever, are additive and never replace reject. Health must expose `ledger.writable` and `fail_closed=true` truthfully. |
| **Absorbed in** | DESIGN_PASS_1 fences · MVP_SCOPE Out · OPERATOR_NEEDS safety · MINIMUM_SUPPORT |

---

### Attack 6 — Missing agent decision table + 402 vs 429 ambiguity → retry storms / support load

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | OSS DX/support + buyer (Guard process: agent decision table) |
| **Evidence** | Pass-1 defers HTTP status to LaunchGate with “prefer 402 or 429” and no mapping table. Integrators treat 429 as retryable → agent loops hammer rejects (noisy) or, worse, fall back to a second ungated client. Founder becomes the decision brain. |
| **Failure mode** | “Why is my agent stuck / why did it bypass?” tickets; dual-client bypass after “rate limit” interpretation. |
| **Required design change** | **Draft decision table in pack now** (LaunchGate still freezes final status code). Working draft: **`402`** + `code=BUDGET_EXHAUSTED` for exhaust (non-retryable **halt**); upstream provider errors pass through unchanged; never conflate BurnBrake exhaust with provider 429. Ship one-pager: halt loop / surface to human / raise cap / do not open second baseURL. |
| **Absorbed in** | DESIGN_PASS_1 §5 · MVP_SCOPE Reject · MINIMUM_SUPPORT docs table · OPERATOR_NEEDS |

---

### Attack 7 — In-flight client retry / no request idempotency → double forward

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Buyer + ops |
| **Evidence** | Agent HTTP client times out waiting on a long completion, retries; first forward still running → two upstream calls, one reservation (or two if first settle released). |
| **Failure mode** | Timeout → retry → 2× provider $ for one logical step; settle races corrupt remaining. |
| **Required design change** | Support optional **`x-burnbrake-request-id` / Idempotency-Key`**: same key while `FORWARDED`/`RESERVED` returns in-flight semantics without a second upstream forward. Decision table: client timeouts mid-call → **do not blind-retry** without idempotency key; prefer kill-run or wait. Document as integrator contract in MINIMUM_SUPPORT. |
| **Absorbed in** | MVP_SCOPE In · DESIGN_PASS_1 §5 · MINIMUM_SUPPORT decision table / troubleshooting |

---

### Attack 8 — Autumn / billing EMS scope creep via “credits / top-ups / hosted meter” language

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Buyer + founder fence |
| **Evidence** | Pass-1 mentions optional Polar/Stripe top-ups and hosted meter ~$29. Without a hard lexicon fence, implementers and buyers read “credits,” “entitlements,” “overage invoice.” Wedge dies; support tickets demand Autumn. |
| **Failure mode** | README says “credit balance”; stranger files “where is customer portal?”; roadmap slides into plans. |
| **Required design change** | **Lexicon fence:** MVP speaks **caps / remaining / reserve / settle / reject** only. Ban credits/entitlements/invoice-overage from MVP surfaces. Cap raises = config/CLI (operator). Polar/Stripe = selling the **BurnBrake kit/SKU**, never in-path metering of OpenAI. Hosted meter = **Later**, not day-1 Polar SKU. Any contested EMS feature → refuse; founder if contested. |
| **Absorbed in** | DESIGN_PASS_1 §7 · MVP_SCOPE Out/Later · MINIMUM_SUPPORT out-of-scope |

---

### Attack 9 — Dishonest Polar-ready / “listing candidate” theater

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | OSS DX + founder fence |
| **Evidence** | Pack prices ~$149 as “Polar candidate” while zip/SHA/POLAR_DELIVERABLES/happy-path proof do not exist. Strangers (or future self) treat design prose as sellable. |
| **Failure mode** | Soft-launch pressure; refunds; support before product. |
| **Required design change** | Every pack header: **Polar listing DARK — not Polar-ready.** “Candidate” means shape only after ready-gate checklist green + **founder** go-live. No zip/SHA claims until artifacts exist. LaunchGate may approve ready-gate docs; founder flips public. |
| **Absorbed in** | All four pack headers · MVP_SCOPE ready gate · MINIMUM_SUPPORT money hygiene |

---

### Attack 10 — Day-boundary / multi-pod clock skew (partial undercount of day scope)

| | |
| --- | --- |
| **Severity** | **P2** |
| **Blade** | Ops |
| **Evidence** | Pass-1 allows “UTC or buyer TZ” without locking ledger clock source. Multi-pod sidecars with skewed clocks can split day buckets. |
| **Failure mode** | Brief double day-budget near midnight; or early reset. |
| **Required design change** | **Document as known limit:** single ledger clock (store-side UTC day key); one default TZ documented (UTC); multi-writer must share one ledger store. Full multi-region clock story = LaunchGate later / not MVP polish. Visibility: MVP_SCOPE Known limits + LaunchGate open Q. |
| **Absorbed in** | MVP_SCOPE Known limits · DR2 open Q list (below) |

---

### Attack 11 — Client bypass of sidecar (ungated second client)

| | |
| --- | --- |
| **Severity** | **P2** |
| **Blade** | Buyer honesty |
| **Evidence** | Product cannot cryptographically force all process memory to use the sidecar. Dual clients (one gated, one raw `api.openai.com`) defeat the promise. |
| **Failure mode** | “BurnBrake didn’t stop the burn” when agent SDK ignored baseURL. |
| **Required design change** | Honesty non-goal: **complement, don’t claim org-limit replacement.** Operator checklist: after deploy, confirm no ungated clients (OPERATOR_NEEDS). Demo proves reject only on gated path. Not a code fix in MVP. |
| **Absorbed in** | MVP_SCOPE Known limits · OPERATOR_NEEDS checklist · MINIMUM_SUPPORT glossary |

---

### Attack 12 — Fresh `run_id` rotation within authenticated app (per-run cap wash)

| | |
| --- | --- |
| **Severity** | **P2** |
| **Blade** | Security (residual after Attack 3) |
| **Evidence** | Even with auth, a buggy agent that mints a new run per completion defeats per-run only. |
| **Failure mode** | Per-run=$1 looks safe; 1000 runs → $1000. |
| **Required design change** | Document: **AND semantics** mean per-user and per-day must be set for production; per-run alone is session hygiene, not a global fence. Operator Needs: warn when only per-run configured. |
| **Absorbed in** | MVP_SCOPE Known limits · OPERATOR_NEEDS · MINIMUM_SUPPORT Known limits |

---

## Severity tally

| Sev | Count | IDs |
| --- | --- | --- |
| **P0** | **5** | 1, 2, 3, 4, 5 |
| **P1** | **4** | 6, 7, 8, 9 |
| **P2** | **3** | 10, 11, 12 |
| **Total** | **12** | |

All P0/P1 have design remediations absorbed into the pack in this pass. P2 = Known limits (MVP_SCOPE + visibility here).

---

## Top design deltas absorbed this pass

1. **Reservation state machine** — never free-release after forward; TTL/crash while forwarded → debit reserved.  
2. **Conservative estimate + debt** — output ceiling required/injected; vision/tool surcharges or deny; overshoot gates next call.  
3. **Auth + localhost bind** — Bearer required; default `127.0.0.1`; public bind opt-in cannot disable auth.  
4. **Fail-closed ledger** — no soft-allow-overage; ledger down ⇒ no forward.  
5. **Agent decision table (draft)** — `402` + `BUDGET_EXHAUSTED` = non-retryable halt; idempotency key; lexicon/Polar honesty fences.

---

## LaunchGate open questions (still — after DR×3, 4th DR)

Ordinary freezes → **LaunchGate**. Founder only for price / refunds / Polar go-live / Soft-WTP / spend / Autumn creep.

| # | Open | Notes from DR2 |
| --- | --- | --- |
| LG-1 | Exact HTTP status freeze | Pack **drafts `402`** for exhaust; LaunchGate may confirm or pick `429`+reason — must keep decision-table halt semantics |
| LG-2 | Price-table SoT (static YAML vs live feed) | Unpriced = deny default (locked in pack) |
| LG-3 | Hosted meter vs self-host-only first cash SKU | Pack: self-host first; hosted = Later; **founder** if price ladder changes |
| LG-4 | Anthropic / multi-provider day-1 | Pack: OpenAI-shaped only MVP |
| LG-5 | Reservation TTL default numeric | State machine locked; **value** (e.g. 15m) still LaunchGate |
| LG-6 | Default injected `max_tokens` ceiling value | Policy locked; number still LaunchGate |
| LG-7 | Day TZ default | Pack draft **UTC**; confirm |
| LG-8 | Idempotency key required vs optional | Pack: optional but documented; LaunchGate may require for SDK happy path |

### Founder-only (unchanged)
Price · refunds · Polar public listing · Soft-WTP · paid spend · Autumn/EMS scope exceptions.

---

## P2 visibility checklist (do not “fix” in marketing)

- [ ] Day-boundary / clock skew across writers  
- [ ] Ungated second client bypass  
- [ ] Authenticated `run_id` rotation washes per-run-only setups  
- [ ] Streaming/tool-graph estimate polish gap (conservative ceiling + debt mitigates, does not eliminate all overshoot)  
- [ ] Not Polar-ready until ready-gate green + founder go-live  

*DR×2 complete. Next: DR×3 (pass 3 of 3), then LaunchGate 4th DR — do not implement yet.*
