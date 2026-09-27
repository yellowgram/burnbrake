# BurnBrake — Code Review ×2 (CR2) Attack Log

**Pass:** progressive adversarial review **#2 of 3**
**PR:** https://github.com/yellowgram/burnbrake/pull/1 (`cursor/burnbrake-mvp-c71b`)
**Date:** 2026-09-26
**Stance:** attack what CR1 fixed poorly or left open, plus the new blades (operator vs spend, idempotency retention, multi-scope debt, streaming, price-table load, identity spoof, Docker bind, SDK idempotency, lexicon, demo honesty)
**Outcome:** no new P0. New P1s fixed on this branch. P2 left open below and in the README Known limits.

---

## CR1 fix scorecard

| CR1 fix | Score | CR2 note |
| --- | --- | --- |
| Distinct `BURNBRAKE_OPERATOR_KEY` | **HELD** | Spend key is still 401 on `/v1/operator/*`. Operator key is 401 on the spend path. Equal keys still refuse start. CLI on the sqlite file is still the local operator (P2, not a regression). |
| `n` / `best_of` multiplies the output ceiling | **HELD** | Not rewritten or injected. |
| Usage `input_tokens` / `output_tokens`; JSON not scanned as SSE | **HELD / tighten** | Parser held. An unfinished event stream could still settle a partial `usage` (P1-4). |
| Terminal idempotency key is not reserved again; debit is not released as no-charge | **HELD / tighten** | Replay held. Bodies were kept forever in a mode `0644` file (P1-3). |
| `PRAGMA busy_timeout` | **HELD** | Two-process reserve race still commits one hold. |

## Severity legend

| Sev | Meaning |
| --- | --- |
| **P0** | Provider funds or the cap can be bypassed under intended use. |
| **P1** | Under-count, silent cap wash, or a kit default that contradicts the bind freeze. Fixed in this pass. |
| **P2** | Real limit. Documented. Not code-closed here. |

## Tally

| Sev | Found | Fixed this pass | Left open |
| --- | --- | --- | --- |
| P0 | 0 | 0 | 0 |
| P1 | 5 | 5 | 0 |
| P2 | 6 | 0 | 6 |

---

## Attack catalog

### P1-1 — Docker image defaults to a public bind

| | |
| --- | --- |
| **Blade** | Security/ops |
| **Evidence** | `Dockerfile` set `ENV BURNBRAKE_HOST=0.0.0.0` and `ENV BURNBRAKE_ALLOW_PUBLIC_BIND=1`. README describes compose, which publishes `127.0.0.1:8787`. `docker run -p 8787:8787` publishes `0.0.0.0` on the host, and the image had already opted into a public bind. |
| **Failure mode** | The freeze is default listen `127.0.0.1`. The image default was the opposite. A published port plus the example `bb_replace_me` key is a fund-drain path the README does not describe. |
| **Remediation** | **Fixed.** The image no longer sets host or `BURNBRAKE_ALLOW_PUBLIC_BIND`. Compose still sets `0.0.0.0` inside the container and publishes `127.0.0.1:8787` only. README and `docs/OPERATOR.md` say not to use bare `docker run -p 8787:8787`. |

### P1-2 — OpenAI `user` was a budget identity

| | |
| --- | --- |
| **Blade** | Security/ops, DX |
| **Evidence** | `handleGoverned` used `x-burnbrake-user-id` or, if absent, `parsed.user`. Stock OpenAI clients set `user` per end user and do not send the BurnBrake header. |
| **Failure mode** | With a user cap and no day cap, each distinct `user` received a full new cap. That is a wash under intended use, not only under a caller who is trying to rotate headers. The operator key was not confused with the spend key (CR1 held); this is a different identity bug. |
| **Remediation** | **Fixed.** Budget identity is only `x-burnbrake-user-id` and `x-burnbrake-run-id` (`src/server.ts`). The JSON `user` field is still forwarded upstream. Missing header when the user scope is configured is `400 IDENTITY_REQUIRED` and does not forward. Identifiers and idempotency keys must be 1–200 characters with no control characters. `scopeWarning` fires when a user or run cap is set and the day cap is not. The SDK rejects an unsafe `userId` / `runId` / `idempotencyKey` before `fetch`. A key placed only on the JSON body does not count. |
| **Proof** | `test/sidecar.test.ts`, `test/sdk.test.ts`. |

### P1-3 — Idempotency bodies were world-readable and kept forever

| | |
| --- | --- |
| **Blade** | Security/ops |
| **Evidence** | `completeIdempotency` stored the upstream body (the completion). CR1 documented that and left retention open. `DatabaseSync` created the file with the process umask, typically `0644`. The CLI does not check `BURNBRAKE_OPERATOR_KEY`; anyone who can read the file can read those bodies, and anyone who can write it can change caps. |
| **Failure mode** | Completions sit in a world-readable sqlite file for the life of the deploy. Rotation of the HTTP keys does not shrink that. |
| **Remediation** | **Fixed, with a limit.** After a successful open, the ledger file and its `-wal` / `-shm` siblings are `chmod 0600` (`restrictLedgerPermissions`). Sweep blanks `response_body` on completed idempotency rows older than 24 hours (`IDEMPOTENCY_BODY_TTL_MS`) and clears `http_status`. The row stays completed, the reservation stays terminal, and a later retry is `409 ALREADY_TERMINAL` rather than a second reserve. Decision rows still do not store prompts. |
| **Not closed** | The CLI remains an unauthenticated operator on that file. That is the local control path. Protect the file. See P2. |
| **Proof** | `test/ledger.test.ts` (mode `0600`, body gone after 24h, spent unchanged, kind is not `reserved`). |

### P1-4 — Unfinished streams could settle a partial usage

| | |
| --- | --- |
| **Blade** | Ledger, DX |
| **Evidence** | `forwardToUpstream` buffered `response.text()` with no size cap. `parseUsageText` returns the last `usage` object in an event stream. A 200 body that includes an early usage and never sends `data: [DONE]` was settled at that partial figure. A client hangup after `FORWARDED` must not take the pre-forward release path. |
| **Failure mode** | Early disconnect or a truncated stream under-debits if a small usage arrived and `[DONE]` did not. A huge body can also exhaust memory and take the gate down for every caller. |
| **Remediation** | **Fixed.** `settleUsage` returns null for `text/event-stream` unless the body contains `data: [DONE]`. The existing no-usage path then debits the estimate (`DEBIT_RESERVED`). Upstream reads are capped at 2_000_000 bytes; over the cap the forward throws and the reservation is debited. `sendRaw` ignores a dead socket so a disconnect after settle does not become a fake `503`. A client abort after `FORWARDED` still settles or debits; it does not `RELEASE_PRE_FORWARD`. There is still no mid-stream reject. The response is buffered, then sent. |
| **Proof** | `test/upstream.test.ts` (usage present, no `[DONE]`, `settleUsage` is null). `test/sidecar.test.ts` (finished mock stream settles well below the 4000-token ceiling; abort after forward leaves spent > 0, held 0, not released). |

### P1-5 — Demo did not lock the operator/spend split

| | |
| --- | --- |
| **Blade** | DX |
| **Evidence** | After CR1 the demo called operator routes with `bb_demo_operator` but never showed that `bb_demo_key` cannot move a cap. A regression that accepted either key on `/v1/operator/*` would still pass. |
| **Failure mode** | The 402 proof stayed honest. The CR1 privilege split was invisible, so a bad merge could ship. |
| **Remediation** | **Fixed.** The demo asserts `operator_http`, asserts the spend key gets `401 AUTH_REQUIRED` on `POST /v1/operator/caps`, then lowers the cap with the operator key and still proves `402` with an unchanged mock forward count. |

---

## Checked and held

| Attack | Result |
| --- | --- |
| Multi-scope AND debt | **Held.** `settle` / `debitReserved` apply to every scope on the reservation. A day scope in debt denies the next reserve with `402` even when the user scope still has room. `test/ledger.test.ts`. |
| Corrupt price table | **Held fail-closed.** `loadPriceTable` throws. `startSidecar` does not listen. `test/sidecar.test.ts`. Stale `priced_at` still warns and still prices. |
| SDK idempotency on the happy path | **Held.** Missing, blank, body-only, and unsafe keys throw `IdempotencyKeyRequired` before `fetch`. Server also rejects an overlong key with `400` and does not forward. |
| Autumn / credits lexicon on the spend path | **Held.** `src/`, README, and the operator runbook do not use those words as product terms. Design-pack docs under `docs/` still name Autumn and Stigg as competitors. That language stays. |
| CR1 operator split | **Held.** See the scorecard. |
| LaunchGate freezes | **Held.** See below. |

## P2 — known limits (not code-closed)

1. **CLI / filesystem is operator control.** HTTP auth does not cover `BURNBRAKE_LEDGER_PATH`. The file is mode `0600`. Rotating `BURNBRAKE_KEY` or `BURNBRAKE_OPERATOR_KEY` does not replace that. Do not put the operator key in the agent.
2. **Header identity can still be rotated** when there is no day cap. The caller who holds the spend key chooses `x-burnbrake-user-id` and `x-burnbrake-run-id`. Health warns. A day cap is the backstop.
3. **Replay bodies exist for 24 hours.** After that the key cannot forward again, but the completion text is on disk until sweep. The file is a secret.
4. **Streams are buffered.** BurnBrake does not kill a call mid-stream. One in-flight call can still settle above the reserve. Tool and vision ceilings are flat allowances. Debt gates the next call.
5. **`safeEqual` returns before `timingSafeEqual` when lengths differ.** A local observer can learn the secret's length.
6. **Already documented and still true:** ungated second client, single-date day cap does not roll, multi-writer UTC clock skew, not Polar-ready. Soft-WTP stays off. Listing stays dark.

## LaunchGate freezes

| Freeze | Still held |
| --- | --- |
| Budget exhaust is **402** `BUDGET_EXHAUSTED`, never 429 | Yes. Provider 429 is passed through. |
| Reservation TTL **15 minutes** | Yes. |
| Crash/TTL while `FORWARDED` → `DEBIT_RESERVED` | Yes. Unfinished streams debit the same way. |
| Never free-release after `FORWARDED` | Yes. Client abort after forward does not release. |
| Inject `max_tokens=4096` only when omitted | Yes. |
| Day boundary **UTC** | Yes. |
| Auth `X-BurnBrake-Key` or Bearer `bb_…` | Yes. Operator HTTP uses a different `bb_` key. |
| SDK idempotency required before fetch | Yes. |
| Fail-closed ledger | Yes. Corrupt price table refuses start. No fail-open flag. |
| Static YAML, unpriced = deny | Yes. |

Polar was not lit. Soft-WTP was not added. This pass does not squash-merge.
