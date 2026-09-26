# Changelog

## 0.1.0

Self-host MVP sidecar. Cap + kill on the request path.

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
- Offline mock-upstream demo

Polar listing stays dark. Not Polar-ready. Soft-WTP is off.
