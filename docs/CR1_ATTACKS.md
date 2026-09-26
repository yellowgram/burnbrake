# BurnBrake — Code Review ×1 (CR1) Attack Log

**Pass:** progressive adversarial expert review **#1 of 3** before LaunchGate 4th CR
**PR:** https://github.com/yellowgram/burnbrake/pull/1 (`cursor/burnbrake-mvp-c71b`)
**Date:** 2026-09-26
**Stance:** three blades — (1) concurrency/ledger correctness, (2) security/ops (auth, bind, open proxy, key confusion), (3) agent-integrator DX (402 halt, idempotency, decision table, demo honesty)
**Outcome:** P0 and P1 fixed on this branch. P2 left as known limits in this file and in the README.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Provider funds or the cap can be bypassed under intended use. Fixed in this pass. |
| **P1** | Under-count, stuck retry, or a false halt that breaks the contract. Fixed in this pass. |
| **P2** | Real limit. Documented. Not code-closed here. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 1 | 1 | 0 |
| P1 | 4 | 4 | 0 |
| P2 | 6 | 0 | 6 |

---

## Attack catalog

### P0-1 — Spend key is the operator key

| | |
| --- | --- |
| **Blade** | Security/ops |
| **Evidence** | Before this pass, `handleOperator` in `src/server.ts` called `authenticate(req.headers, ctx.config.apiKey)`. `POST /v1/operator/caps`, `runs/kill`, `pause`, `resume`, and `force-release` all accepted `BURNBRAKE_KEY`. |
| **Failure mode** | The agent holds the spend key and does not hold the provider key. With that one secret it could raise its own cap or force-release a debited row, then keep calling through the sidecar. The sidecar still attaches `OPENAI_API_KEY` on the provider hop. |
| **Remediation** | **Fixed.** `/v1/operator/*` requires `BURNBRAKE_OPERATOR_KEY`, a `bb_…` secret that must differ from `BURNBRAKE_KEY` and from `OPENAI_API_KEY` (`src/config.ts`). Unset disables operator HTTP with **403** `OPERATOR_KEY_REQUIRED` (`src/server.ts` `handleOperator`, around the `operatorKey` check). The spend key on those routes is **401**. No localhost fallback. The CLI still opens the SQLite file directly. |
| **Proof** | `test/sidecar.test.ts` — spend key cannot raise a cap; operator key can; unset key returns 403 and does not write a cap. |

### P1-1 — Estimate ignores `n` and `best_of`

| | |
| --- | --- |
| **Blade** | Concurrency/ledger, DX |
| **Evidence** | `outputCeiling` in `src/estimate.ts` priced one completion. `n` and `best_of` were copied into the forwarded body and not multiplied. |
| **Failure mode** | A multi-choice call reserves one completion. If usage is missing, `DEBIT_RESERVED` under-counts the provider bill. If usage is present, the overshoot becomes debt only after the call, so the estimate was not conservative. |
| **Remediation** | **Fixed.** `choiceCount` / `scaleOutputTokens` multiply the output ceiling and the tools extra-output allowance by `max(n, best_of)` (default 1). Non-positive values are `BAD_REQUEST`. A product that is not a safe integer is `BAD_REQUEST`. `n` and `best_of` are not injected or rewritten. `max_tokens` is still injected only when both ceilings are omitted. |
| **Proof** | `test/estimate.test.ts` — same `max_tokens`, `n: 4` costs more; `best_of: 5` wins over `n: 2`; `n: 0` is denied. |

### P1-2 — Usage parser misses new token fields and treats JSON as SSE

| | |
| --- | --- |
| **Blade** | DX, ledger |
| **Evidence** | `parseUsageObject` in `src/upstream.ts` read only `prompt_tokens` and `completion_tokens`. `parseUsageText` entered the SSE scan for any body containing a raw newline plus `data:`, including `content-type: application/json`. |
| **Failure mode** | A 200 whose usage is only `input_tokens` / `output_tokens` failed to parse. The sidecar then debited the full ceiling (false halt) or, when the SSE scan latched onto a smaller decoy `data:` object, settled too low. |
| **Remediation** | **Fixed.** Prefer `prompt_tokens` / `completion_tokens` when those numbers are present (including 0); otherwise accept `input_tokens` / `output_tokens`. SSE scan runs for `text/event-stream`, or for a non-JSON body that looks like SSE. A JSON body is parsed as JSON; if a trailing `data:` line makes the whole body invalid JSON, the prefix before `\ndata:` is parsed. |
| **Proof** | `test/upstream.test.ts`. |

### P1-3 — Terminal idempotency key can forward again; no-charge throws after a debit

| | |
| --- | --- |
| **Blade** | Concurrency/ledger, DX |
| **Evidence** | `reserveUnlocked` returned `in_flight` whenever the idempotency row was `pending`, even after the reservation was `SETTLED`, `DEBIT_RESERVED`, `RELEASED`, or `FORCE_RELEASED`. `completeIdempotency` runs only after settle. A throw between debit and complete left the key pending forever. `releaseNoCharge` threw unless the state was `FORWARDED`, including after a TTL sweep had already moved the row to `DEBIT_RESERVED`. That throw hit the outer handler as a generic 503 and did not seal the key. A caller that then minted a new key could forward again. |
| **Failure mode** | One logical attempt becomes a second provider call, or a retry sits on `REQUEST_IN_FLIGHT` and the agent opens another key. A 4xx after a debit could also unwind the fail-closed path without a stored response. |
| **Remediation** | **Fixed.** `reserveUnlocked` replays a stored body. If the reservation is not `RESERVED` or `FORWARDED` and no body is stored, `sealTerminalReplay` completes the key as **409** `ALREADY_TERMINAL` and does not reserve again (`src/ledger.ts`). `releaseNoCharge` returns without changing `DEBIT_RESERVED`, `SETTLED`, `RELEASED`, or `FORCE_RELEASED` — the debit stands. A post-forward settle/release throw debits if the row is still `FORWARDED` and seals the idempotency key with **502**. The pre-upstream hook failure path does the same instead of falling through to a generic 503. |
| **Proof** | `test/ledger.test.ts` (terminal key is not `reserved`; spent stays at the estimate; `releaseNoCharge` after debit does not throw). `test/sidecar.test.ts` (hook failure debits, seals, replay does not forward). |

### P1-4 — Second process sees a lock as "not writable"

| | |
| --- | --- |
| **Blade** | Concurrency/ledger |
| **Evidence** | `Ledger` constructed `DatabaseSync` with `{ timeout: 5000 }`. On this Node (22.14) that option does not wait: a contended statement throws `database is locked` immediately. `isWritable()` treats any throw as read-only and the constructor refuses to start. Re-running the two-process reserve race failed that way before the pragma fix. |
| **Failure mode** | Two processes opening the same ledger (the supported race) can refuse start, or one side aborts, while the file is writable. Operators see a fail-closed outage that is really a missed busy wait. |
| **Remediation** | **Fixed.** The constructor runs `PRAGMA busy_timeout = 5000` before `journal_mode` and the schema (`src/ledger.ts` constructor). A lock waits. A still-locked or read-only file still refuses start. |
| **Proof** | `test/ledger.test.ts` reserve race: two processes, cap 1000, two 800 estimates, exactly one reserved, held = 800. Re-run twice after the pragma. |

---

## P2 — known limits (not code-closed)

1. **Idempotency retains upstream bodies.** The table stores response bodies for replay and has no retention window. Decision rows do not store prompts. The SQLite file is a secret.
2. **Tool and vision ceilings are flat allowances.** One in-flight call can still settle above the reserve. Debt gates the next call. This is not "never overspend."
3. **A day cap set on one UTC date does not roll forward.** `caps set` / HTTP caps without a key updates the default and today. A cap passed only with `--key` for a single date stops at that date.
4. **Filesystem access to the ledger is operator control.** The CLI has no key. Protect `BURNBRAKE_LEDGER_PATH`.
5. **Shared-secret length leak.** `safeEqual` in `src/auth.ts` returns before `timingSafeEqual` when the byte lengths differ. A local observer can learn the secret's length, not the secret.
6. **Already documented and still true:** an ungated second client, per-run id rotation, multi-writer UTC clock skew, and not Polar-ready. Soft-WTP stays off. Listing stays dark.

These are also listed under README **Known limits**.

---

## Checked and held (LaunchGate freezes)

| Freeze | Still held |
| --- | --- |
| Budget exhaust is **402** `BUDGET_EXHAUSTED`, never 429 | Yes. Provider 429 is passed through. Tests assert `notEqual 429`. |
| Reservation TTL **15 minutes** | Yes. `RESERVATION_TTL_MS`. Health reports `reservation_ttl_seconds` 900. |
| Crash/TTL while `FORWARDED` → `DEBIT_RESERVED` | Yes. Sweep test. |
| Never free-release after `FORWARDED` | Yes. `release()` throws. `releaseNoCharge` does not clear a debit. |
| Inject `max_tokens=4096` only when omitted | Yes. Explicit 8000 is not clamped. HTTP mock test. |
| Day boundary **UTC** | Yes. `toISOString().slice(0, 10)`. |
| Auth `X-BurnBrake-Key` or Bearer `bb_…` | Yes. `sk-` and missing key are 401 with forward count 0. Provider key is not forwarded. |
| SDK idempotency required before fetch | Yes. `IdempotencyKeyRequired`. |
| Fail-closed ledger | Yes. No caps → `NO_BUDGET_CONFIGURED`. Unwritable file refuses start. Fail-open env flags refuse start. |
| Static YAML, unpriced = deny | Yes. Unknown model is 402 `UNPRICED_MODEL` and does not forward. Stale `priced_at` warns and still prices. |

Demo (`npm run demo`) still shows one mock forward, then **402** `BUDGET_EXHAUSTED` with `upstream_forwarded=0` and an unchanged mock count. Operator calls in the demo use `BURNBRAKE_OPERATOR_KEY`, not the spend key.

Polar was not lit. Soft-WTP was not added. This pass does not squash-merge.
