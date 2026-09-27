# BurnBrake — Design amendment: brake curve (BB_BRAKE_CURVE_1)

**Packet:** CoS design amendment · `schema_version: 1` · `packet_type: design_amendment`  
**Depends on:** [`MVP_SCOPE.md`](./MVP_SCOPE.md), [`LAUNCHGATE_DR4_VERDICT.md`](./LAUNCHGATE_DR4_VERDICT.md)  
**Date:** 2026-09-27 ET  
**Status:** Implemented on this PR (curve only). Exhaust contract bytes are unchanged. Founder PQ1–PQ3 stay locked (2026-09-26 ET): `brake.enabled` default `false`, `black_delay_ms` default `0`, one-shot allowance later.  
**Soft-WTP:** OFF · **Polar:** stays dark · **Do not** reseal zip / light listing because this curve shipped.

This is **approach policy only**. It does **not** reopen exhaust.

---

## Standing locks (unchanged)

| Lock | Value |
| --- | --- |
| Exhaust HTTP | **402** |
| Exhaust code | `BUDGET_EXHAUSTED` |
| Exhaust halt | **true** |
| Exhaust retryable | **false** |
| Retry-After on exhaust | **forbidden** |
| 429 on exhaust | **forbidden** |
| In-flight `FORWARDED` | never rewritten by a policy change |
| Dual client | buyer-owned |
| Soft-WTP | off |

There is **no** `exhaust.retryable` flag. If a change request shrinks this amendment into “make halt configurable,” **REJECT** it. `brake.enabled` is **not** a halt-off switch.

---

## Purpose

Screen-Time-style approach: **warn / slow BEFORE the cap**. At the cap, still **halt**. Delay on black is a **pre-402 pause only** — wait does not change the verdict.

---

## Founder questions (PQ1–PQ3)

| Id | Ask | Recommendation | Silence means |
| --- | --- | --- | --- |
| **PQ1** | Hosted default for `brake.enabled` — off (halt-only listing) or on with zero delays? | `false` (off). Clip stays 402-only until listed. | treat as `false`. Do not enable delays on founding hosted. |
| **PQ2** | Allow a non-zero default `black_delay_ms` on hosted? | `0` | `0` |
| **PQ3** | One-shot allowance grant this design slice or later? | later. Curve + exhaust lock this PR. Allowance is a follow-on. | later |

**Founder answers (2026-09-26 ET):** PQ1 = `false` · PQ2 = `0` · PQ3 = later. Locked; silence defaults match.

---

## Curve zones

| Zone | When | Default | HTTP if reserve OK | Notes |
| --- | --- | --- | --- | --- |
| **green** | `remaining_pct > amber_pct` | floor 30% (amber trigger) | 200 | Forward as today. Remaining headers only. `delay_ms` 0. |
| **amber** | `red_pct < remaining_pct ≤ amber_pct` | `amber_pct` 30, `amber_delay_ms` 0 | 200 | Optional wait, then reserve+forward. **Not** a 429. |
| **red** | `0 < remaining_pct ≤ red_pct` **and** reserve still covers estimate | `red_pct` 10, `red_delay_ms` 0 | 200 | Longer optional wait, then reserve+forward if it still fits. |
| **black** | reserve cannot cover estimate (including debt) **or** paused/killed | `black_delay_ms` 0 | **402** | Configurable **WAIT**, then 402. Wait does not change verdict. No Retry-After. No 429. Agent must halt. Large `black_delay_ms` → client timeouts; those retries are buyer-owned and still 402 on the next reserve. |

### `remaining_pct` definition

For the **first** scope that would fail (user, then run, then day):

```text
remaining_pct = remaining_micros / cap_micros * 100
```

- If that scope has no cap, skip it.
- If no caps at all, existing `NO_BUDGET_CONFIGURED` **503** stands — curve does **not** apply.
- Debt reduces remaining **before** the pct is computed.

---

## Defaults (`brake_defaults`)

| Key | Default |
| --- | --- |
| `enabled` | `false` |
| `amber_pct` | `30` |
| `red_pct` | `10` |
| `amber_delay_ms` | `0` |
| `red_delay_ms` | `0` |
| `black_delay_ms` | `0` |
| `max_delay_ms` | `15000` |
| `green_delay_ms` | `0` |

If never configured: use these defaults exactly.

---

## Config surface

### Env / file

- `brake.enabled`
- `brake.amber_pct`
- `brake.red_pct`
- `brake.amber_delay_ms`
- `brake.red_delay_ms`
- `brake.black_delay_ms`
- `brake.max_delay_ms`

### Operator

- CLI: `burnbrake brake show | set`
- HTTP: `/v1/operator/brake` (operator key only; spend key → 401)

### Real-time

A set takes effect on the **NEXT** reserve. A `FORWARDED` in-flight call is **not** delayed, aborted, or rewritten.

### Validation

- `amber_pct > red_pct > 0`
- `amber_pct ≤ 100`
- all `delay_ms ≥ 0`
- each `delay_ms ≤ brake.max_delay_ms`
- `brake.max_delay_ms ≤ 15000` unless founder raises the ceiling in a later lock
- **Reject** any `exhaust.retryable` / `exhaust.http` / `halt_mode` keys if anyone adds them

---

## Wire format (do not bikeshed names in implement)

### Response headers on 200

- `X-BurnBrake-Zone: green|amber|red`
- `X-BurnBrake-Remaining-Micros`
- `X-BurnBrake-Delay-Ms`
- `X-BurnBrake-Scope: user|run|day`

### Response on black (402)

Body fields **unchanged**:

- `error.code` — `BUDGET_EXHAUSTED` | `SPEND_PAUSED` | …
- `halt` — `true`
- `retryable` — `false`
- `scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`

Extra **allowed**:

- `zone: black`
- `delay_ms` — what was slept before the 402

**Forbidden:**

- `Retry-After`
- converting to 429
- `retryable: true`

### SDK

- `BudgetExhausted` unchanged
- Delay is **sidecar-side**
- Do **not** sleep again in the SDK on 402

---

## Out of this amendment

- One-shot allowance grant (PQ3 → later)
- Making 402 retryable
- Per-request client override of delays
- Portkey routing / Helicone traces
- Rewriting `FORWARDED` calls
- SeatTruth / MayDo work

---

## Do not

- Treat `brake.enabled` as a halt-off switch
- Ship founding hosted with `enabled: true` unless PQ1 is an **explicit** yes
- Add `Retry-After` on 402
- Delay above `max_delay_ms`
- Reopen exhaust from this packet. The curve PR implements the delay only; halt bytes stay as specified above
- Reseal zip / list Polar because a curve doc landed

---

## Process gates

| Gate | Value |
| --- | --- |
| `approve_design_direction` (packet) | `true` — freeze still holds |
| `approve_implement_now` | **this PR** — curve only; exhaust bytes unchanged |
| Next | CR×3 then LaunchGate CR4. Founder PQ1–PQ3 stay locked. Soft-WTP off. Polar stays dark. |

*Amendment id: `BB_BRAKE_CURVE_1`. Implemented on this PR. Exhaust contract bytes unchanged.*
