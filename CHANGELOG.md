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
- Operator CLI and HTTP for balances, decisions, kill/pause, and caps
- Offline mock-upstream demo

Polar listing stays dark. Not Polar-ready. Soft-WTP is off.
