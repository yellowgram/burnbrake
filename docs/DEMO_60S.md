# 60s demo (mock upstream)

No live provider key and no provider spend. From the repo:

```bash
npm install
npm run demo
```

Preconditions the script sets for you: sidecar on `127.0.0.1`, mock upstream on, BurnBrake key set, user/run/day caps set, run cap large enough for one short allow.

| Clock | Step | Pass |
| --- | --- | --- |
| 0–10s | `GET /health` | listen `127.0.0.1`, `auth.required=true`, `fail_closed=true`, `ledger.writable=true` |
| 10–25s | One under-budget `POST /v1/chat/completions` | HTTP 200, mock forward count = 1, spent increases |
| 25–45s | Lower the run cap to what was spent, send the next completion | HTTP **402** `BUDGET_EXHAUSTED`, mock forward count unchanged, decision `upstream_forwarded=0` |
| 45–60s | Print balances | Debt/overshoot fields visible. Honesty line: one in-flight call may still overshoot; this reject did not call upstream. |

The script exits non-zero if any step fails or if it takes 60 seconds or more.
