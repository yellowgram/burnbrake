# Changelog

## 0.1.0

Self-host MVP sidecar. Cap + kill on the request path.

- Brake curve (BB_BRAKE_CURVE_1): optional pre-cap delay in the sidecar. Exhaust stays HTTP 402 `BUDGET_EXHAUSTED`, halt, not retryable, never 429. `brake.enabled` defaults to false. One-shot allowance is not in this change.
- Self-host kit archive `burnbrake-0.1.0.zip` (tag `v0.1.0`): built `dist/`, price table, demo script, operator and support docs. SHA-256 is `checksums/burnbrake-0.1.0.sha256` in git and on the GitHub Release. The digest is not copied into this file. The Polar listing is not live in this repository. Suthirth solutions publishes it after founder GO. Soft-WTP is off.
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

Seller: Suthirth solutions. Primary SKU: $199 once (one organization). Refund: 14 days. Support: 60-day Issues, no SLA. Hosted $49/mo is optional and not in the zip. Soft-WTP is off.
