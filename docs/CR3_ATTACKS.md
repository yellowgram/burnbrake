# BurnBrake — Code Review ×3 (CR3) Attack Log

**Pass:** progressive adversarial review **#3 of 3** (final before LaunchGate 4th CR)
**PR:** https://github.com/yellowgram/burnbrake/pull/1 (`cursor/burnbrake-mvp-c71b`)
**Date:** 2026-09-26
**Stance:** residual risk and ship-readiness. Do not re-open CR1/CR2 theater. Attack free-release after `FORWARDED`, decision-table honesty, the stranger install path, the 60s demo, the SDK surface, secret logs, and settle racing a TTL reclaim.
**Outcome:** no new P0. New P1s are honesty and hermetic-demo gaps. Fixed on this branch. P2 left open below.

---

## CR1 / CR2 fix scorecard

| Fix | Score | CR3 note |
| --- | --- | --- |
| Distinct `BURNBRAKE_OPERATOR_KEY` (CR1) | **HELD** | Spend key is still 401 on `/v1/operator/*`. Demo still asserts that before the 402. |
| `n` / `best_of` multiplies the output ceiling (CR1) | **HELD** | Not rewritten. |
| Usage `input_tokens` / `output_tokens`; JSON not scanned as SSE (CR1) | **HELD** | Unfinished streams still debit (CR2). |
| Terminal idempotency key is not reserved again (CR1) | **HELD** | `409 ALREADY_TERMINAL` is now a decision-table row. |
| `PRAGMA busy_timeout` (CR1) | **HELD** | Same-connection settle and sweep are separate `BEGIN IMMEDIATE` transactions. |
| Docker image default bind `127.0.0.1` (CR2) | **HELD** | Compose still publishes `127.0.0.1:8787` and is now documented as reading `config.example.env`. |
| Budget identity is the header, not OpenAI `user` (CR2) | **HELD** | START_HERE now says the example caps require those headers. |
| Ledger mode `0600`; replay bodies blanked after 24h (CR2) | **HELD** | |
| Unfinished stream debits; abort after forward does not release (CR2) | **HELD** | TTL reclaim then settle true-ups to actual. It does not free-release and it does not stack the estimate. |
| Demo locks the operator/spend split (CR2) | **HELD / tighten** | The script still asserts the 401. It now also ignores ambient fail-open, price-table, TTL, and provider-key settings (P1-4). |

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Provider funds or the cap can be bypassed under intended use. |
| **P1** | A stranger following the kit gets a different HTTP result than the docs promise, or a dirty shell can break the 60s demo. Fixed in this pass. |
| **P2** | Real limit. Documented. Not code-closed here. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 5 | 5 | 0 |
| P2 | 4 | 0 | 4 |

CR1 and CR2 P2s are still open. They are not recounted here.

---

## Attack catalog

### P1-1 — Decision table did not match the HTTP the sidecar returns

| | |
| --- | --- |
| **Blade** | DX / ship-readiness |
| **Evidence** | README listed budget, pause, unpriced, 401, a single 503 `LEDGER_UNAVAILABLE`, 503 `NO_BUDGET_CONFIGURED`, 409 `REQUEST_IN_FLIGHT`, provider 429, and 502 disconnect. `handleGoverned` also returns 400 `IDENTITY_REQUIRED`, 400 `BAD_REQUEST`, 413 `BODY_TOO_LARGE`, 409 `IDEMPOTENCY_MISMATCH`, 409 `ALREADY_TERMINAL`, 404 `ROUTE_NOT_GOVERNED`, 503 `UPSTREAM_NOT_CONFIGURED`, and **502** `LEDGER_UNAVAILABLE` when settle fails after forward. Operator HTTP with no operator key is 403 `OPERATOR_KEY_REQUIRED`. |
| **Failure mode** | An agent that only knew the old table treats a 400 identity miss as a bug, or treats every `LEDGER_UNAVAILABLE` as "no forward, safe to mint a new call." After forward, that 502 means the debit stands and the retry must reuse the idempotency key. |
| **Remediation** | **Fixed in the table, not by relabeling halts.** 402 stays the halt family: `BUDGET_EXHAUSTED`, `SPEND_PAUSED`, `UNPRICED_MODEL`, `UNKNOWN_SURCHARGE`, never 429. Other failures keep their own statuses. The pre-forward ledger refuse stays 503. The post-forward ledger failure stays 502. |

### P1-2 — START_HERE example caps require headers the steps did not send

| | |
| --- | --- |
| **Blade** | DX |
| **Evidence** | The install block exports `BURNBRAKE_CAP_USER_USD` and `BURNBRAKE_CAP_RUN_USD`. `reserveUnlocked` returns 400 `IDENTITY_REQUIRED` when a configured scope has no `x-burnbrake-user-id` or `x-burnbrake-run-id`. Step 5 said under budget → 200. The OpenAI `user` field does not satisfy the check (CR2, still held). |
| **Failure mode** | A stock client pointed at the sidecar, with the example caps, never gets the promised 200. That looks like a broken gate. It is a missing header, and nothing is forwarded. |
| **Remediation** | **Fixed.** README START_HERE and `docs/START_HERE.md` show the curl with both headers and say the example caps make them required. |

### P1-3 — Compose and the CLI do not read the file the example told you to copy

| | |
| --- | --- |
| **Blade** | Security/ops, DX |
| **Evidence** | `config.example.env` said "Copy to .env and edit." `loadConfig` reads `process.env` only. `docker-compose.yml` sets `env_file: config.example.env`. `.env` is gitignored and unused. |
| **Failure mode** | A stranger rotates keys in `.env`, runs compose, and the process still has `bb_replace_me` / `bb_operator_replace_me` from the example. Those placeholders are in the repo. The publish is localhost-only, so this is not a public fund-drain, but it is not the file the operator edited. |
| **Remediation** | **Fixed in the docs.** The example, README, compose comment, and operator runbook say compose reads `config.example.env` and `burnbrake serve` does not load `.env`. Placeholder keys stay public and stay on `127.0.0.1`. |

### P1-4 — `npm run demo` inherited a dirty shell

| | |
| --- | --- |
| **Blade** | DX |
| **Evidence** | `startSidecar` copies `process.env` and then `options.env`. The demo set host and `BURNBRAKE_ALLOW_PUBLIC_BIND` only. `BURNBRAKE_FAIL_OPEN`, `BURNBRAKE_SOFT_ALLOW`, `BURNBRAKE_SOFT_ALLOW_OVERAGE`, `BURNBRAKE_PRICE_TABLE`, `BURNBRAKE_RESERVATION_TTL_MS`, and `OPENAI_API_KEY` still came from the shell. Fail-open flags throw at start. A garbage price-table path throws. A 1ms TTL can debit the allow before settle. An `OPENAI_API_KEY` equal to `bb_demo_key` or `bb_demo_operator` refuses start. |
| **Failure mode** | The 60s promise (one 200, spend key 401 on caps, then 402 with forward count unchanged) fails for a reason that is not the gate. |
| **Remediation** | **Fixed.** The demo pins the package price table, the 15-minute TTL, empty fail-open flags, and an empty provider key. Test boots do the same so the suite is not ambient either. `docs/DEMO_60S.md` now includes `operator_http` and the spend-key 401 step the script already asserts. |

### P1-5 — Demo clock in the doc lagged the script

| | |
| --- | --- |
| **Blade** | DX |
| **Evidence** | `docs/DEMO_60S.md` stopped at health `fail_closed` and did not mention `operator_http` or the spend-key 401. `scripts/demo-60s.ts` asserts both, then the 402. |
| **Failure mode** | A reviewer comparing the doc to the script cannot tell whether the privilege split is part of the promise. |
| **Remediation** | **Fixed.** The clock table matches the script. Folded into P1-4's doc edit; counted here so the gap is not lost. |

---

## Checked and held

| Attack | Result |
| --- | --- |
| Free-release after `FORWARDED` | **Held.** `release` throws unless the row is `RESERVED`. `releaseNoCharge` no-ops on `DEBIT_RESERVED` and `SETTLED`. Client abort after forward still does not take `RELEASE_PRE_FORWARD` (CR2). |
| Settle racing TTL reclaim | **Held.** Sweep of an expired `FORWARDED` row debits the estimate and releases the hold once. A later `settle` from `DEBIT_RESERVED` adds `actual - estimate` and does not release the hold again. A second sweep does not touch `SETTLED`. Spent equals actual, not estimate plus actual. `test/ledger.test.ts`. |
| Fail-open the ledger | **Held.** `BURNBRAKE_FAIL_OPEN`, `BURNBRAKE_SOFT_ALLOW`, and `BURNBRAKE_SOFT_ALLOW_OVERAGE` refuse start. Corrupt YAML refuses start. Unwritable ledger refuses start. `failClosed` is the constant `true`. |
| 402 only as the halt family | **Held.** Budget, pause, and unpriced are 402 with distinct `error.code`. They are not 429. Auth, identity, bad request, in-flight, terminal key, missing upstream, and ledger failures use 401, 400, 409, 403, 404, 413, 502, or 503. Provider 429 is passed through. |
| SDK surface toward Autumn | **Held.** `package.json` `exports` is only `"."` → `dist/sdk`. Public types are the client, `BudgetExhausted`, `SpendPaused`, `BurnBrakeError`, `IdempotencyKeyRequired`, and `isBudgetExhausted`. No credits, customers, entitlements, or invoices. |
| Secrets in logs | **Held.** `console.error` / `console.warn` print `err.message` or the stale-table sentence. They do not print `BURNBRAKE_KEY`, `BURNBRAKE_OPERATOR_KEY`, or `OPENAI_API_KEY`. Health does not echo secrets. |
| Force-release | **Not a bypass.** It requires the operator key and `attest_no_charge`, and it only applies to `RESERVED` or `FORWARDED`. A false attestation is operator misuse (P2). The spend key cannot call it. |
| Polar | **Dark.** `docs/POLAR_DELIVERABLES.md` is still a design checklist. No zip, no SHA, boxes unchecked. This pass does not list it. |
| LaunchGate freezes | **Held.** See below. |

## P2 — known limits (not code-closed)

1. **Force-release with a false attestation** drops the hold on a forwarded row. That is the audited operator exception. The spend key cannot do it. A lie in the attestation is misuse of the operator key, not a client bypass.
2. **TTL/crash debit reports `debt_delta_micros` 0** on the decision row even when the debit crosses the cap. `balances` is the source of truth (`debt_micros`). The next reserve still denies.
3. **An idempotency key is stored in the ledger.** Logs do not print it, but a caller who puts a secret in the key has written that secret to the sqlite file (mode `0600`, body blanked after 24h, key row kept).
4. **CR1/CR2 limits still apply:** CLI is operator control of the file; header rotation without a day cap; 24h replay bodies; buffered streams and one-call overshoot; `safeEqual` length leak; ungated second client; single-date day cap; clock skew; not Polar-ready. Soft-WTP stays off.

## LaunchGate freezes

| Freeze | Still held |
| --- | --- |
| Budget exhaust is **402** `BUDGET_EXHAUSTED`, never 429 | Yes. Pause and unpriced are also 402, with different codes. |
| Reservation TTL **15 minutes** | Yes. Demo and test boots pin it against the shell. |
| Crash/TTL while `FORWARDED` → `DEBIT_RESERVED` | Yes. Later settle true-ups to actual. |
| Never free-release after `FORWARDED` | Yes. Force-release is the attested operator exception. |
| Inject `max_tokens=4096` only when omitted | Yes. |
| Day boundary **UTC** | Yes. |
| Auth `X-BurnBrake-Key` or Bearer `bb_…` | Yes. Operator HTTP uses a different `bb_` key. |
| SDK idempotency required before fetch | Yes. |
| Fail-closed ledger | Yes. |
| Static YAML, unpriced = deny | Yes. |
| Default bind `127.0.0.1` | Yes. Compose publish stays localhost. |

Polar was not lit. Soft-WTP was not added. This pass does not squash-merge.
