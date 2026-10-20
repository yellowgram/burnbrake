# BurnBrake

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

BurnBrake puts a hard dollar cap on LLM calls made by agents. It is a small proxy that sits between your agent and OpenAI or Anthropic. Before each call it estimates the worst-case cost, holds that amount against the user, run and daily budgets, and refuses the call with HTTP 402 if the budget can't cover it. After the call it charges the real cost from the provider's usage numbers and gives back the rest.

Use it when an agent loop could run away with your API bill and you want a stop that the agent cannot argue with.

- Works with OpenAI-shaped `/v1/chat/completions` and `/v1/completions`, and Anthropic `/v1/messages`, streamed or not.
- Budgets per user, per run and per UTC day, kept in one SQLite file.
- A refused call never reaches the provider.
- Streams pass straight through as they arrive; BurnBrake reads the usage on the way past and settles when the stream ends.

## Five-minute quickstart

Needs Node 22.13 or newer. Nothing here calls a real provider or spends money.

```bash
git clone https://github.com/yellowgram/burnbrake && cd burnbrake
npm ci
npm run demo        # offline: health, one allowed call, then a 402 with no upstream call
```

Run it yourself against the built-in mock provider:

```bash
npm run build
export BURNBRAKE_KEY=bb_replace_me               # the key your agent sends to BurnBrake
export BURNBRAKE_OPERATOR_KEY=bb_operator_me     # a different key, for changing caps
export BURNBRAKE_CAP_USER_USD=10 BURNBRAKE_CAP_RUN_USD=1 BURNBRAKE_CAP_DAY_USD=5
export BURNBRAKE_MOCK_UPSTREAM=1                 # drop this and set OPENAI_API_KEY for real calls
node dist/cli.js serve                           # listens on 127.0.0.1:8787
```

In another shell:

```bash
curl -sS http://127.0.0.1:8787/v1/chat/completions \
  -H "content-type: application/json" \
  -H "X-BurnBrake-Key: bb_replace_me" \
  -H "x-burnbrake-user-id: alice" -H "x-burnbrake-run-id: run-1" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":16}'

node dist/cli.js balances --user alice --run run-1 --ledger data/burnbrake.sqlite
```

To use it from an existing OpenAI client, point the client at the proxy and send the BurnBrake key instead of the provider key:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
```

The provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) lives only in the BurnBrake process. Your agent never needs it.

## How a call is handled

1. **Estimate.** Input tokens from everything the provider bills as input (messages, tool definitions, earlier tool calls and their arguments, tool results, thinking blocks), counted as UTF-8 bytes / 3 so code, JSON and non-Latin text aren't under-counted. Plus the output ceiling (`max_tokens`, times `n` or `best_of`), priced from `prices/openai.yaml` or `prices/anthropic.yaml`. If you leave out `max_tokens`, BurnBrake sets it to 4096 and tells the provider; a higher value you set is never lowered. Models missing from the price table are refused, never priced at $0.
2. **Reserve.** The estimate is held against every configured scope (user, run, day). If any scope can't cover it, including debt from earlier overshoots, the answer is 402 `BUDGET_EXHAUSTED` and nothing is sent upstream.
3. **Forward.** The request goes to the provider. For streams, bytes go back to your agent as they arrive.
4. **Settle.** BurnBrake reads the provider's usage (OpenAI `usage`, or Anthropic `message_start` and `message_delta` usage, including prompt-cache tokens) and charges the real cost. If the provider never reported usage, or the stream was cut off, the full estimate is charged.

For OpenAI streams BurnBrake sets `stream_options.include_usage: true` (even if the client sent `false`) so the provider reports usage at the end; the client gets one extra chunk with empty `choices`. Anthropic streams always report usage, so nothing is added.

**Server tools.** Tools that run on the provider's side and are billed per use are refused unless the price table prices them. `prices/anthropic.yaml` prices Anthropic web search (`server_tools.web_search`); such a request must set `max_uses`, BurnBrake reserves `max_uses` searches, and at settle it charges the searches the provider reports. OpenAI `web_search_options` and any OpenAI tool that isn't `function` or `custom` are refused. Anthropic `document` (PDF) blocks are refused because their size in tokens can't be estimated from the request.

## When a call is refused

`BUDGET_EXHAUSTED` means stop. It is HTTP 402, never 429, and it has no `Retry-After`. Retrying it just gets another 402.

| Signal | HTTP | Code | Retry the spend call? | Agent action |
| --- | --- | --- | --- | --- |
| Budget exhausted | **402** | `BUDGET_EXHAUSTED` | **No** | Halt the loop. Surface scope, remaining, requested. |
| Run or global pause | **402** | `SPEND_PAUSED` | **No** | Halt. Resume or raise caps from the operator CLI. |
| Unpriced model or unknown surcharge | **402** | `UNPRICED_MODEL` / `UNKNOWN_SURCHARGE` | **No** | Halt. Add the model or content type to the price table. |
| Auth failure | **401** | `AUTH_REQUIRED` | No | Halt. Fix `X-BurnBrake-Key`. Do not fall back to `api.openai.com`. Do not paste the provider key here. The spend key on an operator route is also 401. |
| Missing budget identity | **400** | `IDENTITY_REQUIRED` | No | The example caps turn user and run on. Send `x-burnbrake-user-id` and `x-burnbrake-run-id`. The OpenAI `user` field does not count. No forward. |
| Bad request or body too large | **400** / **413** | `BAD_REQUEST` / `BODY_TOO_LARGE` | No | Includes disagreeing `Idempotency-Key` and `x-burnbrake-request-id`. No forward. |
| Ledger unavailable before forward | **503** | `LEDGER_UNAVAILABLE` | No | Halt. Fix the ledger file. There is no fail-open mode. No upstream call. |
| Writer lease not held | **503** | `WRITER_LEASE_REQUIRED` | No | Halt. One writer on this store. No upstream call. |
| No caps configured | **503** | `NO_BUDGET_CONFIGURED` | No | Halt. Set a user, run, or day cap. |
| Production without user or day | **503** | `PRODUCTION_SCOPE_REQUIRED` | No | Halt. Set a user and/or day cap. Run-alone is refused. No forward. |
| Upstream not configured | **503** | `UPSTREAM_NOT_CONFIGURED` | No | Set `OPENAI_API_KEY`, or `BURNBRAKE_MOCK_UPSTREAM=1`. No forward. |
| Operator HTTP with no operator key | **403** | `OPERATOR_KEY_REQUIRED` | No | Set `BURNBRAKE_OPERATOR_KEY`. This is not a spend-path code. |
| In-flight duplicate | **409** | `REQUEST_IN_FLIGHT` | Do not start a second forward | Wait. Reuse the same idempotency key. |
| Same idempotency key, different user or run | **409** | `IDEMPOTENCY_MISMATCH` | No | `halt` is false. No forward. |
| Terminal key, no stored body | **409** | `ALREADY_TERMINAL` | **No** | This key will not forward again. A new logical attempt needs a new key. |
| Other `/v1/*` route | **404** | `ROUTE_NOT_GOVERNED` | No | Not proxied. |
| Provider rate limit | provider **429** (passed through) | upstream body | Per the provider, not this gate | Do not confuse this with `BUDGET_EXHAUSTED`. |
| Provider 5xx or disconnect after forward | upstream / **502** | `UPSTREAM_ERROR` or the upstream body | Only with the **same idempotency key** | Expect settle if usage is known, otherwise `DEBIT_RESERVED`. |
| Stream cut off mid-way | the stream just ends | (no end marker) | Only with the **same idempotency key** (you get 409 `ALREADY_TERMINAL`) | The estimate is debited. Treat the partial output as incomplete. |
| Ledger failure after forward | **502** | `LEDGER_UNAVAILABLE` | Only with the **same idempotency key** | Distinct from the pre-forward 503. The debit stands. |
| Upstream success | **200** | — | — | Continue. |

The SDK throws `BudgetExhausted` on 402 with the same fields (`scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`).

## Retries and idempotency

Send an `Idempotency-Key` header (the SDK makes it mandatory). A retry with the same key never makes a second provider call: you get the stored response back, or 409 `ALREADY_TERMINAL` if there is nothing to replay. Streams are stored for replay when they finished cleanly and are under 1.5 MB. Bigger or broken streams still pass through in full; they just aren't replayable. Without a key, a retry after BurnBrake has forwarded can start a second, separately charged provider call.

Stored bodies are deleted after 24 hours by default (`BURNBRAKE_IDEMPOTENCY_BODY_TTL_MS`, never longer). Set `BURNBRAKE_REPLAY_KEY` to encrypt them at rest.

## SDK

```ts
import { BurnBrake, BudgetExhausted } from "burnbrake";

const bb = new BurnBrake({ baseURL: "http://127.0.0.1:8787", apiKey: process.env.BURNBRAKE_KEY! });

try {
  await bb.chat.completions.create(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 256 },
    { idempotencyKey: "step-1", userId: "alice", runId: "run-1" },
  );
} catch (err) {
  if (err instanceof BudgetExhausted) {
    // Stop the loop. Do not retry, and do not switch to another base URL.
  }
  throw err;
}
```

## Caps

| Env | Meaning |
| --- | --- |
| `BURNBRAKE_CAP_USER_USD` or `_MICROS` | Default cap for each `x-burnbrake-user-id` |
| `BURNBRAKE_CAP_RUN_USD` or `_MICROS` | Default cap for each `x-burnbrake-run-id` |
| `BURNBRAKE_CAP_DAY_USD` or `_MICROS` | Cap for everything in one UTC day |

Every configured scope must cover the call. The 402 names the first one that couldn't (user, then run, then day). Identity comes from the two `x-burnbrake-*` headers only; the OpenAI `user` field is passed through and ignored for budgets. Because the caller picks those headers, a run cap alone can be dodged by inventing new run ids. Always set a user or day cap; with `NODE_ENV=production` or `BURNBRAKE_PRODUCTION=1`, BurnBrake refuses to start without one.

Optional slow-down before the cap: [docs/BRAKE_CURVE.md](docs/BRAKE_CURVE.md).

## Operating it

```bash
burnbrake balances --user alice --run run-1
burnbrake decisions --deny-only --run run-1 --format csv
burnbrake kill --run run-1          # and: resume, pause --global
burnbrake caps set --scope day --usd 5
burnbrake top-runs --window 1h
burnbrake allowance grant ...       # let one more call through on a scope, once
```

The CLI works on the ledger file directly. The same controls are on `/v1/operator/*` and need `BURNBRAKE_OPERATOR_KEY`, which must differ from the spend key and the provider key. `GET /health` reports the setup without echoing secrets. Full runbook: [docs/OPERATOR.md](docs/OPERATOR.md).

Install from npm with `npm install burnbrake` and run `npx burnbrake serve`. A Docker image and `docker-compose.yml` are included; compose publishes only `127.0.0.1:8787`.

## Limits and threat model

What BurnBrake protects against: an agent (buggy, looping, or prompt-injected) that keeps making model calls through the proxy. It cannot raise its own caps, because the spend key cannot reach operator routes.

What it does not protect against:

- **Calls that don't go through it.** A second client pointed straight at `api.openai.com` bypasses every cap, and so does anyone holding the provider key. `GET /health` says so (`deploy.stops_all_spend: false`). After each deploy, check that no other provider client is left in the code.
- **Overshoot on the call in flight.** The cap is checked before a call. Once forwarded, a call is never cut off. Its real cost can exceed the estimate (the token count is an estimate, and images are priced with flat floors), and the difference becomes debt that blocks the next call. The overshoot is bounded by the estimate's error on each call in flight, not by a whole call: with several calls in flight at once, each can exceed its own estimate.
- **Slow providers.** BurnBrake waits up to 10 minutes for a provider's response headers (and the whole body of a non-streamed reply), then gives up and charges the estimate. A client that hangs up before the provider answers cancels the provider call.
- **Client disconnects.** If your agent hangs up mid-stream, BurnBrake closes the provider connection and charges the full estimate, because providers bill for tokens already generated and don't report them on a cancelled stream.
- **Stale prices.** Prices are a static table you maintain. Health warns when `priced_at` is more than 30 days old; enforcement continues with the old prices.
- **Caller-chosen identity.** User and run ids are headers the caller sets. A day cap is the only fence that survives header games.
- **One process, one file, one tenant.** The ledger is a single SQLite file with the process clock as the day boundary. It is not a multi-pod or multi-tenant ledger ([docs/SINGLE_STORE.md](docs/SINGLE_STORE.md)). Whoever can write the file can change caps; it is created with mode 0600.
- **Stored responses.** Replay bodies sit in the ledger for up to 24 hours, in plain text unless `BURNBRAKE_REPLAY_KEY` is set. Prompts are not written to the decision log.

More detail: [docs/DEPLOY_INVARIANTS.md](docs/DEPLOY_INVARIANTS.md), [docs/EXHAUST_CONTRACT.md](docs/EXHAUST_CONTRACT.md).

## Development

```bash
npm ci
npm run typecheck
npm test
```

CI runs the same on Node 22. Releases before 0.2.0 were published under a different license; 0.2.0 and later are MIT.

Bugs: GitHub Issues. Security reports: [SECURITY.md](SECURITY.md). There is no paid support.

## License

MIT. See [LICENSE](LICENSE).

---

Part of yellowgram open source tools: https://www.yellowgram.dev/oss
