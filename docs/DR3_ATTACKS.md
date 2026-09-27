# BurnBrake — Design Review ×3 (DR3) Attack Log

**Pass:** progressive adversarial expert design iteration **#3 of 3 (FINAL before LaunchGate 4th DR)**  
**Date:** 2026-09-26 ET  
**Stance:** attack what DR2 *fixed poorly* or left open — not theater rehash of DR2 P0s  
**Rule:** attacks that would kill a stranger buy, burn provider $, or fail a 60s demo  
**Outcome:** P0/P1 remediations absorbed into pack (`DESIGN_PASS_1.md`, `MVP_SCOPE.md`, `MINIMUM_SUPPORT.md`, `OPERATOR_NEEDS.md`) + new [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) + [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md). P2 = known limits with LaunchGate visibility.  
**Not done:** product code · PRs · LaunchGate/agent messaging · Soft-WTP · Polar light

---

## DR2 fix scorecard (held vs tighten)

| DR2 fix | Score | DR3 note |
| --- | --- | --- |
| Reservation SM: never free-release after forward; crash→DEBIT_RESERVED | **HELD** | Correct lesser evil. Residual: **one in-flight call can still overspend estimate** — promise honesty was soft (Attack A). |
| Conservative estimate + debt | **HELD / tighten** | Ceiling+debt works; injected `max_tokens` can revolt buyers (Attack B); price-table staleness undercuts estimate (Attack E). |
| App→sidecar Bearer + localhost bind | **HELD / tighten** | Auth model sound; header/key confusion + rotation + shared-secret blast radius incomplete (Attack C). |
| Fail-closed ledger; no soft-allow | **HELD** | No reopen. |
| Decision table draft (`402` + halt) | **HELD / incomplete** | Missing streaming mid-flight, partial upstream, settle-on-5xx matrix (Attack F). |
| Lexicon / Polar DARK honesty | **PARTIAL** | Credits ban held on spend path; **“hosted meter”** Autumn-adjacent SKU name lingered; Polar zip/SHA checklist missing (Attacks G, I). |
| Idempotency key optional | **HELD** | Still optional; LG freezes required-vs-optional. |
| Ungated second client (DR2 P2) | **elevate honesty** | Still not code-fixable; support-bleed if warnings quiet (Attack D). |

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Stranger-buy killer, provider-$ under intended use, or dishonest promise → refund/support death — **must design-close before LaunchGate 4th DR** |
| **P1** | Support-bleed / UX revolt / incomplete contract that becomes P0 under load — **design-close in this pass** |
| **P2** | Real limit; document + LaunchGate visibility; do not pretend closed |

---

## Attack catalog

### Attack A — Promise dishonest: one in-flight call still overspends (debt / debit-on-crash)

| | |
| --- | --- |
| **Severity** | **P0** |
| **Blade** | Buyer honesty / refund risk (attacks DR2 “hard cap = gate + debt” buried as P2) |
| **Evidence** | DR2 fixed free-release-after-forward correctly, but pack headers still lead with “hard cap” and “reject the next completion” without a **prominent** one-call caveat. Within a single `FORWARDED` call: (1) settle can exceed reserve → debt; (2) crash/TTL → `DEBIT_RESERVED` of *estimate* while actual provider bill may differ; (3) streaming holds until final usage — dollars already leave. Stranger hears “hard cap,” overnight sees debt + OpenAI bill > remaining, files “BurnBrake lied.” |
| **Failure mode** | Refund / 1-star / support “why did I still overspend?”; Soft-WTP-adjacent pressure to “make it never overspend.” |
| **Required design change** | **Lock promise language (absorb):** BurnBrake guarantees **pre-call reject of the next completion** when reserve (incl. debt) cannot cover the **conservative estimate** — **not** magical zero overshoot on an already-forwarded call. One in-flight completion may settle above reserve or debit-on-crash; debt gates the next call. Put the caveat in DESIGN one-liner, MVP_SCOPE Known limits #1 slot, MINIMUM_SUPPORT FAQ, and 60s demo (must show debt or debit path once). Ban marketing “never overspend” / “zero burn after install.” |
| **Absorbed in** | DESIGN_PASS_1 §1/§5 · MVP_SCOPE Known limits · MINIMUM_SUPPORT FAQ · OPERATOR_NEEDS §4 |

---

### Attack B — Injected `max_tokens` ceiling breaks legitimate long completions / streaming UX

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Agent-integrator buyer revolt (DR2 conservative estimate fixed poorly for UX) |
| **Evidence** | DR2 requires output ceiling via request `max_tokens` **or** sidecar-injected default. A low injected default (or silent rewrite of buyer’s high `max_tokens`) truncates long agent dumps / tool JSON / streaming UX → “BurnBrake broke my agent.” A sky-high default reopens undercount. Pack never locks inject-only-when-missing vs always-clamp. |
| **Failure mode** | Buyer removes sidecar; dual-client bypass; support tickets “completions cut off.” |
| **Required design change** | **Inject policy (absorb):** inject default ceiling **only when request omits `max_tokens`** (or equivalent). **Never silently lower** a buyer-supplied higher ceiling. Document: high buyer `max_tokens` ⇒ larger reserve (may deny earlier — correct). Config key for default; `/health` or operator view shows `estimate.default_max_tokens`. START_HERE warns: set your own `max_tokens` for long jobs. Numeric default still **LaunchGate** (LG-6). Streaming: forward holds `FORWARDED` until final chunk/usage; no mid-stream budget kill (see Attack F). |
| **Absorbed in** | DESIGN_PASS_1 §5 · MVP_SCOPE In · MINIMUM_SUPPORT START_HERE / troubleshooting · OPERATOR_NEEDS §4 |

---

### Attack C — Bearer auth: provider-key confusion, rotation, multi-agent shared secret

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Security/ops + support (DR2 auth P0 held; ops story thin) |
| **Evidence** | Pack says “Bearer / shared secret” and “sidecar auth ≠ provider key” once. Buyers commonly put `OPENAI_API_KEY` in the wrong hop, or send the provider key as BurnBrake Bearer (or vice versa). One shared secret across many agent processes = rotate-pain and blast radius. No mandatory distinct header name or rotation runbook. |
| **Failure mode** | Misconfig → 401 loops → fall back to `api.openai.com` (bypass); leaked sidecar secret → local proxy abuse; can’t rotate without restarting every agent. |
| **Required design change** | **Auth contract (absorb):** dedicated header **`X-BurnBrake-Key`** (preferred) or `Authorization: Bearer` with value prefixed `bb_…` — document **never** reuse provider key as BurnBrake secret. Provider key only on sidecar→upstream hop. START_HERE poison-labels both confusions. Operator: rotate sidecar key (CLI/env reload); agents must pick up new key (document blast radius: one secret per deploy, not per agent — multi-secret = Later). `/health` never echoes secret; tickets forbid pasting either key. |
| **Absorbed in** | DESIGN_PASS_1 §4 · MVP_SCOPE In · OPERATOR_NEEDS §3 · MINIMUM_SUPPORT auth / troubleshooting |

---

### Attack D — SDK / baseURL bypass: buyers forget sidecar (honesty + support)

| | |
| --- | --- |
| **Severity** | **P1** (elevated from DR2 Attack 11 P2 for support-bleed) |
| **Blade** | OSS DX / buyer honesty |
| **Evidence** | DR2 correctly marked ungated second client as non-code-fixable P2. MINIMUM_SUPPORT mentions dual client in troubleshooting list but lacks a **loud** START_HERE / demo gate. Strangers will ship, leave a raw OpenAI client in tree, burn $, blame BurnBrake. |
| **Failure mode** | “BurnBrake didn’t stop the burn” tickets; refunds; founder becomes forensics. |
| **Required design change** | **Honesty + prove-gated-path (absorb):** keep Known limit (cannot cryptographically force process memory). Elevate docs: START_HERE step “confirm no second client”; post-deploy checklist mandatory; troubleshooting #1 = dual client. Demo/ready-gate: prove reject on **gated** path only; README one-liner “BurnBrake only governs traffic that hits the sidecar.” Out-of-scope auto-reply: “make it stop my other client” → refuse; point to checklist. Do **not** claim org-limit replacement. |
| **Absorbed in** | MVP_SCOPE Known limits · MINIMUM_SUPPORT START_HERE / troubleshooting / out-of-scope · OPERATOR_NEEDS checklist · DESIGN §7 |

---

### Attack E — Price-table staleness → under-estimate → debt spiral

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Ops + buyer (DR2 estimate held; SoT freshness missing) |
| **Evidence** | Pack: versioned price table + unpriced→deny. No stale-age policy. Provider raises output price; table weeks old → reserve undercounts → settle debt → agent dead until caps raised → “BurnBrake randomly stopped us” / debt spiral from many near-miss calls. |
| **Failure mode** | Silent under-reserve → debt backlog → support; or operator never bumps table. |
| **Required design change** | **Freshness policy (absorb):** price table carries `version` + `priced_at` (UTC). `/health` and operator balances show both. **Warn** when age > documented threshold (draft **30 days** — LaunchGate may freeze). Unpriced / unknown model still **deny**. Stale does **not** fail-open. Operator weekly checklist: bump table when provider pricing changes; decision log includes `price_table_version`. SoT shape (static YAML vs live feed) still **LaunchGate** (LG-2); pack locks **static versioned YAML for MVP**. |
| **Absorbed in** | MVP_SCOPE In · OPERATOR_NEEDS §1/§4/checklist · MINIMUM_SUPPORT troubleshooting · DESIGN §6 |

---

### Attack F — Decision table incomplete: streaming mid-flight, partial upstream, 5xx

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | OSS DX / integrator (DR2 table held but gapped) |
| **Evidence** | Table covers exhaust, auth, ledger, idempotency, provider 429/5xx at high level. Missing: (1) can BurnBrake reject **mid-stream** after forward? (2) upstream returns partial body then dies — settle? debit? (3) upstream 5xx after bytes — usage unknown. Integrators invent retry storms. |
| **Failure mode** | Double-forward; debt surprise; “why didn’t it kill mid-stream?” feature tickets. |
| **Required design change** | **Expand decision table (absorb):** Once `FORWARDED`, **no mid-stream budget reject** (dollars may already be in flight) — next-call gate only. Streaming success → settle usage from final chunk / usage field. Upstream **5xx / disconnect after forward** → prefer settle if usage known; else **DEBIT_RESERVED** (same crash honesty); client retries **only** with idempotency key. Partial success with usage → settle actual. Document in MINIMUM_SUPPORT table + glossary. |
| **Absorbed in** | MINIMUM_SUPPORT decision table · DESIGN §5 · MVP_SCOPE state machine notes |

---

### Attack G — Polar kit contents vague (no zip/SHA/POLAR_DELIVERABLES)

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Founder fence / OSS DX (DR2 Attack 9 partial — DARK held, checklist absent) |
| **Evidence** | Pack says “no zip/SHA/POLAR_DELIVERABLES yet” but never drafts what must be in them. LaunchGate/founder cannot ready-gate against a void. |
| **Failure mode** | Fake Polar-ready pressure; incomplete kit; refunds. |
| **Required design change** | **Write [`POLAR_DELIVERABLES.md`](./POLAR_DELIVERABLES.md) (design only):** dark-listing checklist — zip contents, SHA256, START_HERE, version pin, mock-upstream demo script, license, support boundary, refund policy placeholder (founder), explicit **not** included. No artifact claims until files exist. |
| **Absorbed in** | POLAR_DELIVERABLES.md · MVP_SCOPE ready gate · all pack Polar pointers |

---

### Attack H — Hosted vs self-host first SKU still fuzzy

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Product shape / Autumn creep |
| **Evidence** | Headers still say “~$29/mo hosted meter **and/or** ~$149 self-host.” DR2 leaned self-host first but pricing line keeps both co-equal. Implementers build tenancy early; strangers expect SaaS day-1. |
| **Failure mode** | Scope creep into hosted multi-tenant before self-host proof; support for tenancy; Autumn-shaped roadmap. |
| **Required design change** | **Pass-3 recommendation LOCK:** **First cash SKU = self-host kit only (~$149 draft).** Hosted multi-tenant sidecar/ledger (**rename off “meter”**) = **Later** after self-host proof — not day-1 Polar SKU. LaunchGate confirms shape (LG-3); **founder** if price ladder changes. Remove “and/or” co-equal framing from headers. |
| **Absorbed in** | DESIGN_PASS_1 header/§4 · MVP_SCOPE pricing · MINIMUM_SUPPORT · LAUNCHGATE_DR4_BRIEF |

---

### Attack I — Autumn lexicon still in pack (“hosted meter”, soft “hard cap”)

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | Founder fence (DR2 Attack 8 incomplete scrub) |
| **Evidence** | Spend-path credits ban held. Residual: product SKU name **“hosted meter”** appears in DESIGN/MVP/MINIMUM headers; OPERATOR title “hard cap, safely” without one-call caveat invites Attack A misread. Competitive skim may keep Autumn words when describing **them** — OK if labeled competitor. |
| **Failure mode** | Buyers ask for metering portal; implementers name modules `MeterService`. |
| **Required design change** | **Scrub (absorb):** rename Later SKU to **“hosted sidecar / hosted ledger tenancy.”** Spend-path lexicon remains caps/remaining/reserve/settle/reject/debt. “Hard cap” only with honesty clause or prefer **“pre-call spend gate.”** Competitive sections may say credits/meter when naming Autumn/Stigg. |
| **Absorbed in** | All pack headers · DESIGN lexicon · OPERATOR_NEEDS title |

---

### Attack J — Stranger 60s demo still unscripted (ready-gate failure)

| | |
| --- | --- |
| **Severity** | **P1** |
| **Blade** | OSS DX / Polar ready-gate |
| **Evidence** | Kill criteria require ≤60s reject demo; happy path is 15 min install. No timed **60s demo script** with mock upstream, auth, allow→reject proof, and `upstream_forwarded=false`. Without mock, demo needs live OpenAI $ — fails offline / founder-dependent. |
| **Failure mode** | Cannot demo without sales call → kill criterion #1; not Polar-ready. |
| **Required design change** | **60s demo script in MINIMUM_SUPPORT (absorb):** preconditions (sidecar already up, mock upstream, tiny run cap); clocked steps: health → under-budget allow → exhaust → reject `BUDGET_EXHAUSTED` + proof no upstream → optional debt/debit mention. Ready-gate checkbox references this script. Mock upstream **In** for kit demo path. |
| **Absorbed in** | MINIMUM_SUPPORT · MVP_SCOPE ready gate · POLAR_DELIVERABLES |

---

### Attack K — Multi-writer day-boundary residual (carry P2)

| | |
| --- | --- |
| **Severity** | **P2** |
| **Blade** | Ops |
| **Evidence** | DR2 Attack 10 documented; no new closure without distributed ledger clock product. |
| **Failure mode** | Brief double day-budget near midnight across skewed writers. |
| **Required design change** | Keep Known limit; single ledger store + UTC day key. No pretend fix. |
| **Absorbed in** | MVP_SCOPE Known limits (unchanged class) |

---

### Attack L — Authenticated run_id rotation residual (carry P2)

| | |
| --- | --- |
| **Severity** | **P2** |
| **Blade** | Security residual |
| **Evidence** | DR2 Attack 12; operator warn when only per-run set — held. |
| **Required design change** | Keep Known limit + operator warning. |
| **Absorbed in** | MVP_SCOPE Known limits · OPERATOR_NEEDS |

---

## Severity tally

| Sev | Count | IDs |
| --- | --- | --- |
| **P0** | **1** | A |
| **P1** | **9** | B, C, D, E, F, G, H, I, J |
| **P2** | **2** | K, L |
| **Total** | **12** | |

All P0/P1 design-closed in this pass. P2 remain Known limits.

---

## Top design deltas absorbed this pass

1. **Honest promise** — pre-call gate + debt; one in-flight call may overshoot; ban “never overspend.”  
2. **`max_tokens` inject-only-when-missing** — never silent down-clamp; document long-job UX.  
3. **Auth header contract** — `X-BurnBrake-Key` / `bb_…`; never reuse provider key; rotation blast radius.  
4. **Bypass honesty elevated** — START_HERE + troubleshooting #1 dual-client; prove gated path only.  
5. **Price-table freshness** — version + `priced_at`; warn when stale; static YAML MVP; unpriced still deny.  
6. **Decision table v2** — no mid-stream reject; 5xx/partial → settle-or-DEBIT_RESERVED; idempotent retry only.  
7. **First SKU lock** — self-host kit only; hosted ledger tenancy Later; scrub “hosted meter.”  
8. **POLAR_DELIVERABLES + 60s demo script** — dark listing checklist; mock-upstream demo.

---

## LaunchGate open questions (hand to 4th DR)

Ordinary freezes → **LaunchGate**. Founder only for price / refunds / Polar go-live / Soft-WTP / spend / Autumn creep.

| # | Open | Pack draft | Needs |
| --- | --- | --- | --- |
| LG-1 | Exact HTTP status for exhaust | **`402`** + `BUDGET_EXHAUSTED`; halt semantics locked | APPROVE `402` or REJECT→alt with same halt |
| LG-2 | Price-table SoT | **Static versioned YAML**; unpriced=deny; freshness warn ~30d | APPROVE static vs live feed |
| LG-3 | First cash SKU | **Self-host kit only**; hosted tenancy Later | APPROVE shape (**founder** if price ladder) |
| LG-4 | Anthropic / multi-provider day-1 | OpenAI-shaped only | APPROVE / REJECT expand |
| LG-5 | Reservation TTL numeric | State machine locked; value e.g. **15m** draft | Freeze number |
| LG-6 | Default injected `max_tokens` | Policy locked (inject if missing); number e.g. **4096** draft | Freeze number |
| LG-7 | Day TZ default | **UTC** | Confirm |
| LG-8 | Idempotency key | Optional but documented | Optional vs required on SDK happy path |
| LG-9 | Stale price-table threshold | Warn at **30 days** draft | Freeze threshold / warn-vs-deny-stale |
| LG-10 | Auth header final name | Draft **`X-BurnBrake-Key`** (Bearer `bb_…` alt) | Freeze |

### Founder-only (unchanged)
Price · refunds · Polar public listing · Soft-WTP · paid spend · Autumn/EMS scope exceptions.

---

## P2 visibility checklist (do not “fix” in marketing)

- [ ] Day-boundary / multi-writer clock skew  
- [ ] Ungated second client bypass (docs elevated; not code-forced)  
- [ ] Authenticated `run_id` rotation washes per-run-only  
- [ ] One in-flight overshoot / debit-on-crash residual (promise now honest)  
- [ ] Estimate polish gap beyond ceiling + debt  
- [ ] Not Polar-ready until ready-gate green + founder go-live  

*DR×3 complete. Next: **LaunchGate 4th DR** — do not implement until APPROVE. See [`LAUNCHGATE_DR4_BRIEF.md`](./LAUNCHGATE_DR4_BRIEF.md).*
