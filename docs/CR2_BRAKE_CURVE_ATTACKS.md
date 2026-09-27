# BurnBrake — Code Review ×2 (CR2) Attack Log — BB_BRAKE_CURVE_1

**Pass:** adversarial review **#2 of 3** before LaunchGate CR4
**PR:** https://github.com/yellowgram/burnbrake/pull/3 (`cursor/brake-curve-8f2f`)
**Date:** 2026-09-27
**Stance:** fresh angles after CR1. Config lifetime, zone boundaries, multi-scope debt, `enabled` toggles, the delay ceiling, operator auth, SDK shape, streaming settle, and client timeouts during amber/red. CR1’s two P1s are regression checks only.
**Outcome:** No new P0 or P1. P2 limits below stay open. Commercial lock on this branch is unchanged ($199 once / $49/mo). Soft-WTP off. Polar dark.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Provider funds or the cap can be bypassed under intended use. |
| **P1** | Under-count, stuck retry, false halt, or a forward the client already abandoned. |
| **P2** | Real limit. Documented. Not code-closed here. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 |
| P2 | 4 | 0 | 4 |

---

## Attack catalog

No new P0 or P1. Each fresh angle was executed against this tree. A miss would have been a forward without a covering reserve, a hold left in `RESERVED` or `FORWARDED`, a 402 that became a 200, a second SDK sleep, or a spend key that wrote the brake. None of those reproduced.

---

## P2 — known limits (not code-closed)

1. **The open zone is the lowest `remaining_pct`, with ties kept in user → run → day order.** It is the tightest percent among scopes that still cover the estimate, which can be a later scope even when an earlier scope has fewer micros left. Exact `amber_pct` is amber. Exact `red_pct` is red. A covering 0% (the estimate still fits) is red. `amber_pct` of 100 leaves no green band, because green is strict `remaining_pct > amber_pct`. Ratios that are not exact integer percents use IEEE division. An exact `remaining_micros * 100 === pct * cap_micros` stays on that inclusive side of the line.
2. **A client that leaves during the delay produces no decision row.** The attempt also takes no reservation. The operator log does not show the abandoned wait.
3. **Environment brake values apply at process start.** Startup writes that snapshot over the ledger. A running process does not re-read `BURNBRAKE_BRAKE_*`. Live changes are `brake set` and `POST /v1/operator/brake`, and they hit the next reserve.
4. **Time to first byte includes the sidecar delay.** The upstream body is still buffered before the client sees it. An unfinished event stream after that delay becomes one `DEBIT_RESERVED` at the estimate. The delay does not create a second hold.

---

## Checked and held

| Claim | Result |
| --- | --- |
| A brake set during a pre-reserve sleep does not rewind that attempt. The next reserve uses the new config. | Held. The in-flight amber response still carries the zone and delay it started with. The following call, after `enabled` was set false during that sleep, has no zone headers and does not sleep. |
| `enabled` false → true is also next-reserve. A `FORWARDED` call is not delayed when the curve is turned on underneath it. | Held. Existing in-flight forward test, plus the toggle test above. |
| Exact amber and red boundaries match the design (`>` green, `≤ amber_pct` amber, `≤ red_pct` red). | Held. `classifyOpenZone` cases for 30/100, 31/100, 10/100, and covering 0. |
| Debt is subtracted before the percent, and AND order is user then run then day. | Held. User overshoot with a healthy run and day stays black on user (`remaining_micros` negative). The preview does not take a new hold. |
| `max_delay_ms` above 15000, and a patch that would make `amber_pct <= red_pct`, are rejected and not stored. Env `BURNBRAKE_BRAKE_MAX_DELAY_MS=15001` still refuses load. | Held. Operator POST returns 400 and the stored brake stays at the defaults. |
| Spend key on `POST /v1/operator/brake` is 401 and does not enable the curve. | Held. |
| SDK does not sleep again on a live black 402. `BudgetExhausted` stays `halt: true`, `retryable: false`, HTTP 402, and has no `delay_ms` or `zone` field. | Held. Elapsed time tracks the sidecar delay only. |
| A client timeout during a real red delay does not forward and does not leave `RESERVED` or `FORWARDED`. | Held. Stream body, `AbortSignal.timeout`, `red_delay_ms` 250, `forwardCount` 0. The seed settle row is the only reservation. |
| An unfinished event stream after an amber delay debits once. | Held. One upstream hit, state `DEBIT_RESERVED`. |
| CR1 black-wait idempotency seal, and abort-after-body with no reserve, still hold. | Held. Those tests are unchanged and still in `test/brake.test.ts`. |

`brake.enabled` stays off by default. Exhaust stays 402 / halt / not retryable. This pass does not squash-merge.
