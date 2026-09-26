# LaunchGate 4th CR — paste brief

**PR:** https://github.com/yellowgram/burnbrake/pull/1
**Branch:** `cursor/burnbrake-mvp-c71b`
**Date:** 2026-09-26
**Contact:** hello@yellowgram.dev
**Ask:** **APPROVE** this implementation for LaunchGate 4th CR. **REJECT** Polar listing and go-live.

Do not squash-merge. Do not light Polar. Soft-WTP stays off. No zip and no SHA exist. Founder owns price, refunds, and any later go-live.

---

## What shipped

Self-host kit only (Node 22 sidecar + SQLite ledger + thin TypeScript SDK + operator CLI/HTTP + 60s mock demo).

- Governed routes: `POST /v1/chat/completions`, `POST /v1/completions`. Any other `/v1/*` is `404 ROUTE_NOT_GOVERNED` and is not proxied.
- Estimate → reserve → forward or reject → settle. Caps AND across user, run, and UTC day. Debt gates the next call. One already-forwarded call may overshoot.
- HTTP **402** halt family: `BUDGET_EXHAUSTED`, `SPEND_PAUSED`, `UNPRICED_MODEL`, `UNKNOWN_SURCHARGE`. Never 429 for those. Other failures use their own statuses (see the README decision table).
- Static `prices/openai.yaml`. Unpriced denies. Stale `priced_at` (>30 days) warns and still prices.
- Auth: `X-BurnBrake-Key` or `Bearer bb_…`. Operator HTTP uses a different `BURNBRAKE_OPERATOR_KEY`. The spend key cannot change caps. Default bind `127.0.0.1`. Compose publishes `127.0.0.1:8787` and reads `config.example.env`.
- Reservation TTL 15 minutes. `RESERVED` expiry releases. `FORWARDED` expiry debits the estimate. A later settle true-ups to actual usage. `release()` refuses any non-`RESERVED` row.
- SDK export is `"."` only. `idempotencyKey` is required before `fetch`.

Attack logs: `docs/CR1_ATTACKS.md`, `docs/CR2_ATTACKS.md`, `docs/CR3_ATTACKS.md`.

## Freezes held

| ID | Freeze | Held |
| --- | --- | --- |
| LG-1 | 402 `BUDGET_EXHAUSTED`, halt, not 429 | Yes |
| LG-2 | Static versioned YAML; unpriced = deny; not a live feed | Yes |
| LG-3 | Self-host kit first SKU; hosted ledger later; price stays founder | Yes |
| LG-4 | OpenAI-shaped HTTP only | Yes |
| LG-5 | Reservation TTL 15 minutes | Yes |
| LG-6 | Inject `max_tokens=4096` only when omitted; never silent down-clamp | Yes |
| LG-7 | UTC day boundary | Yes |
| LG-8 | Idempotency required on the SDK happy path; raw HTTP optional and loud; retries after forward carry the key | Yes |
| LG-9 | Stale warning at 30 days; still not fail-open | Yes |
| LG-10 | `X-BurnBrake-Key` (Bearer `bb_…` allowed) | Yes |
| — | Never free-release after `FORWARDED` | Yes |
| — | Fail-closed ledger; no soft-allow | Yes |
| — | Cap + kill only. No Autumn / credits / entitlements / invoice lexicon on the spend path | Yes |
| — | Soft-WTP off | Yes |
| — | Polar listing dark | Yes |

Design-pack docs under `docs/` still name Autumn and Stigg as competitors. That language stays. It is not the product surface.

## CR×3 scorecard

| | P0 | P1 | P2 |
| --- | --- | --- | --- |
| CR1 | 1 fixed (spend key was the operator key) | 4 fixed | left open |
| CR2 | 0 | 5 fixed (bind, body `user`, ledger mode/retention, unfinished streams, demo privilege split) | left open |
| CR3 | **0** | **5 fixed** | **4 left open** (plus the earlier P2s) |

CR3 P1s, all closed on this branch:

1. Decision table now matches the statuses the sidecar returns, including 400 `IDENTITY_REQUIRED` and **502** `LEDGER_UNAVAILABLE` after forward (pre-forward ledger refuse stays 503).
2. START_HERE shows the identity headers the example caps require.
3. Compose / CLI file story matches the code: compose reads `config.example.env`; the CLI does not load `.env`.
4. `npm run demo` pins fail-closed flags, the package price table, the 15-minute TTL, and an empty provider key.
5. `docs/DEMO_60S.md` includes `operator_http` and the spend-key 401.

Held under attack and not changed: no free-release after forward; settle-after-TTL true-up (spent equals actual); no fail-open flag; SDK has no Autumn surface; logs do not print the BurnBrake key, the operator key, or the provider key.

## Known P2 limits

- Force-release can drop a forwarded hold only with the operator key and `attest_no_charge`. A false attestation is operator misuse.
- A TTL/crash debit logs `debt_delta_micros` 0. Balances still show debt. The next reserve still denies.
- Do not put a secret in an idempotency key. The key is stored in the ledger. Logs do not print keys.
- Still true from CR1/CR2: CLI is filesystem operator control (file mode `0600`); header rotation without a day cap; replay bodies for 24h; buffered streams and one-call overshoot; comparison returns early when key lengths differ; an ungated second client is invisible; a single-date day cap does not roll; skewed clocks can split the UTC bucket.

## APPROVE / REJECT

**APPROVE** the implementation for LaunchGate 4th CR.

Freezes above are held. CR×3 P0 is zero. CR×3 P1s are fixed. `npm test` and `npm run demo` are the proof commands (mock upstream, no provider spend). Promise honesty: one already-forwarded call may overshoot; debt gates the next call; a deny shows `upstream_forwarded=false`.

**REJECT** Polar listing and go-live.

`docs/POLAR_DELIVERABLES.md` is still a design checklist. No zip. No SHA256. Ready-gate boxes for SHA, zip, and founder go-live stay unchecked. This brief does not fill them. Listing stays dark until a founder says otherwise.
