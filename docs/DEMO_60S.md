# 60s demo (mock upstream)

No live provider key and no provider spend. From a git checkout or from the unpacked `burnbrake-0.1.1/` kit (Node 22.13+):

```bash
npm ci
npm run demo
```

`npm ci` installs the TypeScript runner. Do not pass `--omit=dev` for this script. The v0.1.1 zip already contains `dist/` and `prices/openai.yaml`. The script below still runs from TypeScript source (`scripts/demo-60s.ts`). Exhaust on the deny step is HTTP **402** `BUDGET_EXHAUSTED`, halt, not retryable, not 429.

Preconditions the script sets for you: sidecar on `127.0.0.1`, mock upstream on, BurnBrake key set, user/run/day caps set, run cap large enough for one short allow.

The script pins listen address, fail-closed flags, the package price table, and the 15-minute reservation TTL. A shell that exports `BURNBRAKE_FAIL_OPEN`, a bad `BURNBRAKE_PRICE_TABLE`, or a tiny TTL does not change this run.

| Clock | Step | Pass |
| --- | --- | --- |
| 0–10s | `GET /health` | listen `127.0.0.1`, `auth.required=true`, `operator_http=true`, `fail_closed=true`, `ledger.writable=true` |
| 10–25s | One under-budget `POST /v1/chat/completions` with `x-burnbrake-user-id` and `x-burnbrake-run-id` | HTTP 200, mock forward count = 1, spent increases |
| 25–45s | Spend key `POST /v1/operator/caps` is **401** `AUTH_REQUIRED`. Operator key then lowers the run cap to what was spent. Next completion | HTTP **402** `BUDGET_EXHAUSTED`, not 429, mock forward count unchanged, decision `upstream_forwarded=0` |
| 45–60s | Print the deny decision | Honesty line: one in-flight call may still overshoot; this reject did not call upstream. |

The script exits non-zero if any step fails or if it takes 60 seconds or more.
