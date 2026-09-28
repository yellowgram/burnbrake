# Changelog

## Unreleased

- Docs honesty: the $199 self-host kit Polar listing is **LIVE** (PolyForm Noncommercial 1.0.0 + BurnBrake commercial grant; CoS/www sell it). Soft-WTP, coupons, and cold invoices stay off. No Polar price change. No checkout URL added to README or zip-shipped stranger docs. Hosted $59/mo remains a separate live optional SKU and does not grant self-host production rights.
- Docs honesty: Release **v0.1.1** exists on GitHub with `burnbrake-0.1.1.zip` (SHA-256 `6406dd2d4c0e783273ebc98b028ac4c53dcd972de550d9995c3f26b4901a1f6c`, matches `checksums/burnbrake-0.1.1.sha256`). This change does not reseal the kit zip.

## 0.1.1

License fence only. Not a feature release. Exhaust stays HTTP 402 `BUDGET_EXHAUSTED`, halt, not retryable.

- Copyright is source-available commercial. `LICENSE` is the PolyForm Noncommercial License 1.0.0 (`PolyForm-Noncommercial-1.0.0`) plus the BurnBrake commercial grant (`docs/COMMERCIAL_GRANT.md`). OSI open source: false.
- The $199 once kit is that grant, the kit zip, and 60-day Issues (no SLA), for one organization and the named tag, perpetual for that tag. Legal seller: Suthirth Solutions, operating as yellowgram. Contact: hello@yellowgram.dev. Refund: 14 days on the $199 kit only.
- Hosted $59/mo stays a separate live optional SKU. It does not grant self-host production rights. The $199 self-host kit Polar listing is **LIVE** under this fence (PolyForm + BurnBrake commercial grant; CoS/www sell it). Soft-WTP, coupons, and cold invoices stay off.
- Kit archive for this fence: `burnbrake-0.1.1.zip`. SHA-256 is `checksums/burnbrake-0.1.1.sha256` in git. The digest is not copied into this file. Release `v0.1.1` is on GitHub with that zip (SHA-256 `6406dd2d4c0e783273ebc98b028ac4c53dcd972de550d9995c3f26b4901a1f6c`).
- Tag `v0.1.0` and `checksums/burnbrake-0.1.0.*` stay as the historical kit. They are not resealed. Health `version` for this kit is `0.1.1`.

## 0.1.0

Self-host MVP sidecar. Cap + kill on the request path.

- Brake curve (BB_BRAKE_CURVE_1): optional pre-cap delay in the sidecar. Exhaust stays HTTP 402 `BUDGET_EXHAUSTED`, halt, not retryable, never 429. `brake.enabled` defaults to false. One-shot allowance is not in this change.
- Self-host kit archive `burnbrake-0.1.0.zip` (tag `v0.1.0`): built `dist/`, price table, demo script, operator and support docs. SHA-256 is `checksums/burnbrake-0.1.0.sha256` in git and on the GitHub Release. The digest is not copied into this file. That tag is grandfathered MIT and is not resealed. Soft-WTP is off.
- OpenAI-shaped routes: `POST /v1/chat/completions`, `POST /v1/completions`
- SQLite ledger: estimate → reserve → forward or reject → settle
- HTTP 402 `BUDGET_EXHAUSTED` (halt). Never 429 for budget exhaust
- Reservation TTL 15 minutes. Crash or TTL while forwarded debits the estimate
- Static versioned price table. Unpriced models denied. Stale table warns at 30 days
- Default bind `127.0.0.1`. Auth `X-BurnBrake-Key` or Bearer `bb_…`
- Thin TypeScript SDK with a required idempotency key
- Operator CLI on the ledger file. Operator HTTP requires a distinct `BURNBRAKE_OPERATOR_KEY`
- Estimate multiplies the output ceiling by `n` / `best_of`. Usage accepts `input_tokens` / `output_tokens`
- A terminal idempotency key is not reserved again. A debit after forward is not released as no-charge
- Replay bodies expire after 24h. The ledger file is mode 0600. The Docker image binds 127.0.0.1 unless compose opts in
- Budget identity is the BurnBrake header, not the OpenAI `user` field. An unfinished event stream is debited, not settled from a partial usage
- Decision table lists the non-402 codes, including 400 `IDENTITY_REQUIRED` and 502 `LEDGER_UNAVAILABLE` after forward. Compose reads `config.example.env`. The 60s demo ignores ambient fail-open, price-table, and TTL settings
- Offline mock-upstream demo

Legal seller: Suthirth Solutions, operating as yellowgram. Primary SKU: $199 once (one organization). Refund: 14 days. Support: 60-day Issues, no SLA. Hosted $59/mo is optional and not in the zip. Soft-WTP is off.
