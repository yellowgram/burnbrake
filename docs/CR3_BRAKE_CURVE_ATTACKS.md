# BurnBrake — Code Review ×3 (CR3) Attack Log — BB_BRAKE_CURVE_1

**Pass:** adversarial review **#3 of 3** before LaunchGate CR4
**PR:** https://github.com/yellowgram/burnbrake/pull/3 (`cursor/brake-curve-8f2f`)
**Date:** 2026-09-27
**Stance:** third independent set. Ledger death during a delay, pause and kill during a delay, UTC day flip, unpriced models, stale price tables, bind and compose, client-supplied zone headers, two callers on one idempotency key after a shared amber wait, disabled-brake exhaust bytes, and Soft-WTP / allowance / `Retry-After` / 429. CR1 and CR2 catalogs are not re-opened.
**Outcome:** No new P0 or P1. Two P2 limits below. **CR×3 is ready for LaunchGate CR4.** Do not squash-merge. Soft-WTP off. Polar dark.

**Refund docs:** deferred. `origin/main` is still `6bba67e` (commercial lock $199 / $49). The founder 14-day refund window on the $199 kit is not on main yet. This pass does not invent that text and does not invent Soft-WTP.

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
| P2 | 2 | 0 | 2 |

---

## Attack catalog

No new P0 or P1. A miss here would have been a forward after the ledger died, a forward after pause or kill during the wait, a black day verdict that spent the next UTC day, an unpriced model that slept and then forwarded, a stale table that failed open, a client `X-BurnBrake-Zone` that the sidecar obeyed, or two forwards for one idempotency key. None of those reproduced.

---

## P2 — known limits (not code-closed)

1. **The UTC day key is read again at reserve, after the delay.** A black verdict on the arrival day stays 402 even if midnight passes and the new day has room. An amber or red call that still covers after midnight is reserved on the new day. The arrival day is not the day that is charged when the wait crosses `00:00:00Z`. The window is at most `max_delay_ms` (15000).
2. **A ledger that dies during the delay cannot record a decision row.** The client still gets **503** `LEDGER_UNAVAILABLE`, halt, not retryable, and the sidecar does not forward.

---

## Checked and held

| Claim | Result |
| --- | --- |
| Ledger close during an amber delay | **503**, `forwardCount` 0, no `Retry-After`, not 429. |
| Run kill and global pause during an amber delay | **402** `SPEND_PAUSED`, halt, not retryable, zone black on the body, no reservation, no forward. A client `X-BurnBrake-Zone: green` is not copied onto the response. |
| Black delay, then the clock crosses UTC midnight and the day cap is raised | Still **402** `BUDGET_EXHAUSTED` on day. No reservation. |
| Amber delay, then the new UTC day is capped at 0 | Reserve denies **402** on that new day. No forward. |
| Unpriced model with the curve on and a 5s black delay | **402** `UNPRICED_MODEL` before any sleep. No zone header. Not 429. |
| Stale `priced_at` (2020-01-01) with the curve on | Health reports `stale: true` and `fail_closed: true`. A priced model still reserves and returns 200 with the curve zone. An unknown model is still 402. The startup log says still enforcing. |
| `docker-compose.yml` | Unchanged by the curve. Host publish stays `127.0.0.1:8787`. In-container `0.0.0.0` still requires `BURNBRAKE_ALLOW_PUBLIC_BIND=1`. Auth stays on. |
| Public bind and soft-allow | `BURNBRAKE_HOST=0.0.0.0` without the flag refuses start even if brake delays are set. `BURNBRAKE_SOFT_ALLOW`, `BURNBRAKE_SOFT_ALLOW_OVERAGE`, and `BURNBRAKE_FAIL_OPEN` refuse start with the brake env set. No allowance key is read. |
| Client zone / delay / remaining / scope headers | Ignored. Disabled brake exhaust body keys stay the pre-curve list: `code`, `message`, `scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`, `halt`, `retryable`. |
| Two callers, one idempotency key, shared amber delay, cap large enough for both | Statuses 200 and 409 `REQUEST_IN_FLIGHT`. `forwardCount` 1. The 200 zone is the server’s amber, not the client’s green. |
| Curve 402s in this pass | No `Retry-After`. Status is never 429. `retryable` is false. |

Exhaust stays 402 / halt / not retryable. `brake.enabled` default remains false. This pass does not squash-merge.
