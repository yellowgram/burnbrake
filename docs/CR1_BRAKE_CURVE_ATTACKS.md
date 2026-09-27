# BurnBrake — Code Review ×1 (CR1) Attack Log — BB_BRAKE_CURVE_1

**Pass:** adversarial review **#1 of 3** before LaunchGate CR4
**PR:** https://github.com/yellowgram/burnbrake/pull/3 (`cursor/brake-curve-8f2f`)
**Date:** 2026-09-27
**Stance:** falsify the curve against `docs/DESIGN_BRAKE_CURVE.md` and the LaunchGate exhaust freeze. Blades: (1) delay-before-reserve vs `BEGIN IMMEDIATE` and idempotency, (2) exhaust bytes (402 / halt / not retryable / never 429 / never `Retry-After`), (3) operator and SDK surfaces that could smuggle halt-off, Soft-WTP, or a second sleep.
**Outcome:** P0 none. Both P1s fixed on this branch. P2 left as known limits.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Provider funds or the cap can be bypassed under intended use. |
| **P1** | Under-count, stuck retry, false halt, or a forward the client already abandoned. Fixed in this pass. |
| **P2** | Real limit. Documented. Not code-closed here. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 8 | 0 | 8 |

---

## Attack catalog

### P1-1 — Black wait seals a 402 over a key claimed during the delay

| | |
| --- | --- |
| **Blade** | Idempotency / false halt |
| **Evidence** | Black preview does not reserve. After `black_delay_ms` (up to 15s, outside the write lock) `respondDeny` called `rememberTerminal`. That helper updated any existing row with `state = 'pending'` or a null body (`src/ledger.ts`). A second caller can `reserve()` the same idempotency key during the sleep once a cap covers. |
| **Failure mode** | The claim is `RESERVED` and in flight, but the row becomes a completed 402. The next reserve replays `BUDGET_EXHAUSTED` and never reports `in_flight`. The agent halts on a key that already holds budget. Window is the whole black delay. |
| **Remediation** | **Fixed.** `rememberTerminal` returns without writing when the row already has `reservation_id`. The waiter still responds **402** (the wait does not flip that attempt). The claimer keeps the pending row. |
| **Proof** | `test/brake.test.ts` — “does not seal a black 402 over an idempotency key claimed during the wait” (follow-up reserve is `in_flight`). “does not flip a black verdict when the cap is raised during the wait” still 402s with no reservation when nobody claims the key. |

### P1-2 — Abort during an amber delay still reserved and forwarded

| | |
| --- | --- |
| **Blade** | Delay-before-reserve |
| **Evidence** | The handler reads the body, then sleeps, then called `clientGone` which only checked `req.aborted`. After the body is consumed, Node leaves `aborted` false. A later `AbortController` abort destroys the response socket (`res.destroyed` / `res.closed` / `socket.destroyed`) and does not set `req.aborted`. `req.destroyed` is already true for a live client once the body has been read, so it cannot be the signal. |
| **Failure mode** | The client has gone away. The sidecar still takes a hold and forwards. That spends cap (and, with a real provider, funds) on a call whose caller will not read the result. The delay makes the window as long as `amber_delay_ms` or `red_delay_ms`. |
| **Remediation** | **Fixed.** After the sleep, the handler returns without reserving when the response socket is gone. Black uses the same check and does not seal a 402 for that abandoned attempt. |
| **Proof** | `test/brake.test.ts` — “does not reserve after the client aborts during an amber delay” (`forwardCount` 0, no reservation after the handler has finished the delay). |

---

## P2 — known limits (not code-closed)

1. **A stored black 402 stays a replay.** Same idempotency key replays 402 even if the cap is raised later. A new key sees the new cap. That is the pre-curve terminal-deny rule. While the cap is still exhausted, a client that times out during `black_delay_ms` and retries (same key or a new key) still gets 402, never 429, and no `Retry-After`. If the client aborted before a seal and an operator then raised the cap, a later attempt is a new decision and may forward. The abandoned attempt never received a verdict to flip.
2. **The sleep is not cancelled early.** After disconnect the handler still sits until the delay ends (`max_delay_ms` ≤ 15000). The gone-client check runs when the sleep returns.
3. **Zone headers are the preview snapshot.** They are not recomputed after the sleep. Idempotent replay sends `x-burnbrake-idempotent-replay` and does not reattach zone headers. Amber or red that loses coverage during the wait returns 402 with `delay_ms` equal to the color delay already slept. It does not add `black_delay_ms`.
4. **A brake set does not rewrite an in-progress sleep or a `FORWARDED` row.** The set applies on the next reserve. Process restart writes the env brake over a runtime `brake set`, same pattern as default caps.
5. **CLI `brake set` is ledger-file access.** It does not require the operator key. Operator HTTP does: the spend key is 401.
6. **`exhaust` as an array is refused as an unknown key `exhaust`.** Flat and nested-object `exhaust.retryable`, `exhaust.http`, and `halt_mode` are rejected by name. The set is not applied either way.
7. **Pause is checked before `NO_BUDGET_CONFIGURED`.** A paused deploy with no caps is 402 `SPEND_PAUSED`. With the curve on, that is a black delay, not 503. No caps and not paused stays 503 with no zone and no sleep.
8. **The waiter and the ledger can disagree for one response.** If a key is claimed during a black wait, that HTTP response is still 402 and that 402 is not stored. A retry sees `in_flight` or the claimer's body. Raw clients may also sleep again on `delay_ms`. The SDK does not. `BudgetExhausted.retryable` stays false.

---

## Checked and held

| Claim | Result |
| --- | --- |
| Exhaust is 402 `BUDGET_EXHAUSTED` or `SPEND_PAUSED`, `halt: true`, `retryable: false` | Held. Tests assert status, both booleans, `notEqual 429`, and `retry-after` null. Provider 429 is still the upstream status after a forward. |
| `brake.enabled=false` matches the pre-curve deny body | Held. Key list is `code`, `message`, `scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`, `halt`, `retryable`. No zone header. Configured delays do not sleep while disabled. |
| Amber/red sleep, then 200 only if the post-sleep reserve covers | Held. Drain during the amber sleep does not forward. |
| Black sleep, then 402. A cap raise during the wait does not forward | Held when the key is not claimed. Claiming the key is P1-1 and no longer seals a false replay. |
| Delay-before-reserve does not double-forward | Held. Two color callers sleep outside the lock; `BEGIN IMMEDIATE` admits one hold. |
| In-flight `FORWARDED` is not delayed, aborted, or rewritten by brake set | Held. |
| Operator HTTP brake rejects the spend key (401). Validation rejects `amber_pct <= red_pct`, delay above `max_delay_ms`, `max_delay_ms > 15000`, and exhaust/halt-off keys | Held. |
| SDK does not sleep again on 402. `BudgetExhausted` is unchanged (`retryable` hardcoded false) | Held. |
| Soft-WTP, one-shot allowance, and halt-off via `enabled` are not smuggled in | Held. Unknown keys and `allowance_micros` throw. `enabled: false` does not turn a 402 into a forward. |
| Debt reduces remaining before the pct. No caps → 503 `NO_BUDGET_CONFIGURED` | Held. Debt preview is black with negative `remaining_micros`. Uncapped preview is `skip`, then 503, no zone. |
| Large `black_delay_ms` plus a client timeout retry is still 402 while the cap is exhausted | Held. See P2-1. |

`brake.enabled` is not a halt-off switch. Soft-WTP stays off. Polar was not touched. Commercial price strings were not edited. This pass does not squash-merge.
