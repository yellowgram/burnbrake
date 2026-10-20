# BurnBrake

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

BurnBrake puts a hard dollar cap on LLM calls made by agents. It is a small proxy that sits between your agent and OpenAI or Anthropic. Before each call it estimates the worst-case cost, holds that amount against the user, run and daily budgets, and refuses the call with HTTP 402 if the budget can't cover it. After the call it charges the real cost from the provider's usage numbers and gives back the rest.

Use it when an agent loop could run away with your API bill and you want a stop that the agent cannot argue with.

- Works with OpenAI-shaped `/v1/chat/completions` and `/v1/completions`, and Anthropic `/v1/messages`, streamed or not.
- Budgets per user, per run and per UTC day, kept in one SQLite file.
- A refused call never reaches the provider.
- Streams pass straight through as they arrive; BurnBrake reads the usage on the way past and settles when the stream ends.
- On Anthropic, and on OpenAI-compatible servers that report usage while streaming, a stream that would spend past the budget is cut mid-way: the provider connection is closed, your agent gets one well-formed error event, and the call is charged its real input plus its whole output allowance ([mid-stream kill](#mid-stream-kill)). A stream inside its own reservation is never cut. On `api.openai.com` itself the cut never fires; see [known limit](#mid-stream-kill).

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

1. **Estimate.** Input tokens from everything the provider bills as input (messages, tool definitions, earlier tool calls and their arguments, tool results, thinking blocks), counted as the larger of UTF-8 bytes / 3 and the number of pre-tokenizer pieces (runs of letters, up to three digits, runs of punctuation), so code, JSON, non-Latin text and text made of very short words aren't under-counted. Plus the output ceiling (`max_tokens`, times `n` or `best_of`), priced from `prices/openai.yaml` or `prices/anthropic.yaml`. If you leave out `max_tokens`, BurnBrake sets it to 4096 and tells the provider; a higher value you set is never lowered. Models missing from the price table are refused, never priced at $0.
2. **Reserve.** The estimate is held against every configured scope (user, run, day). If any scope can't cover it, including debt from earlier overshoots, the answer is 402 `BUDGET_EXHAUSTED` and nothing is sent upstream.
3. **Forward.** The request goes to the provider. For streams, events go back to your agent as they arrive, and BurnBrake meters what each one consumes (see [mid-stream kill](#mid-stream-kill)).
4. **Settle.** BurnBrake reads the provider's usage (OpenAI `usage`, or Anthropic `message_start` and `message_delta` usage, including prompt-cache tokens) and charges the real cost. If the provider never reported usage, or the stream broke off, the full hold is charged. A stream BurnBrake cut for budget is charged its real input and tool calls so far plus all of `max_tokens`.

For OpenAI streams BurnBrake sets `stream_options.include_usage: true` (even if the client sent `false`) so the provider reports usage at the end; the client gets one extra chunk with empty `choices`. Anthropic streams always report usage, so nothing is added.

## Mid-stream kill

On by default; `BURNBRAKE_STREAM_KILL=0` turns it off (`GET /health` shows `stream_kill.enabled`).

The reservation already holds the input estimate plus the whole output ceiling (`max_tokens`, which BurnBrake always sends), and a provider can't generate past `max_tokens`. So output alone never needs a cut, and **a stream inside its own reservation is never cut**. What can still run past the reservation is everything the estimate can't know in advance: the real prompt can be bigger than estimated (the estimate is a floor only for the text kinds listed under [limits](#limits-and-threat-model), and Anthropic's tokenizer isn't public) and prompt-cache writes cost more than plain input. Server tools are not among them: BurnBrake reserves `max_uses` uses, and Anthropic refuses a use past `max_uses` (`max_uses_exceeded`) without billing it. Without the kill, that difference became debt after the stream ended.

While BurnBrake proxies a stream it cuts the provider's bytes into server-sent events and keeps a running count of what the call has consumed:

- **Anthropic** (`/v1/messages`): the real input count from `message_start` (prompt-cache tokens converted as at settle), output from `content_block_delta` text, thinking and tool-input JSON and `tool_use` names, the provider's own cumulative count in `message_delta.usage`, and `server_tool_use` blocks as billed tool calls, counted up to the tool's reserved `max_uses` (a block past it is a refused, unbilled use; the provider's own `server_tool_use` count is not capped). Anthropic streams have no `[DONE]`; they end with `message_stop`.
- **OpenAI-style** (`/v1/chat/completions`, `/v1/completions`): output from each choice's text, refusal, reasoning text, tool-call name and arguments (at least one token per choice per chunk), and the provider's `usage` when a chunk carries it. Input is the estimate until the provider reports it. OpenAI itself reports the prompt only in the last chunk, so on OpenAI a cut needs a server that reports usage as it goes; otherwise the stream runs to its end and any input overrun becomes debt, as in 0.3.0 (see the known limit below).
- Generated text is counted the way input is (the larger of bytes / 3 and the pre-tokenizer piece count), so the count errs high, by up to about 2× for short deltas. It is therefore **capped at the output the reservation covers** (`max_tokens` × choices): counting alone can't push a stream past its reservation. The provider's own count is never capped, and wins when it is higher.

Before each event is forwarded, BurnBrake prices the consumption so far. While that is within the call's hold, nothing happens (no ledger write). When it would pass the hold, BurnBrake tries to grow the hold by the difference from the budget that is still free, in one ledger transaction across every scope (user, run, day). Concurrent streams on the same budget therefore can't spend the same headroom twice. If the budget can't cover it, or spend has been paused for the run or globally, the stream is cut **before** that event:

1. the provider connection is closed, so generation stops;
2. the call is charged its real input and server-tool calls so far, including the event that crossed (the provider has already billed it), **plus its whole output allowance** (`max_tokens`). The output allowance is charged because a provider bills output it never streams: Claude's summarized or redacted thinking, OpenAI's hidden reasoning tokens, and tokens generated in the moment after the connection closes. All of that is within `max_tokens`, so the charge covers the provider's bill; the call's final usage report, which would have given the exact figure, is what the cut throws away;
3. your agent gets the events before the crossing one, then one terminal error event, then the end of the response. For `/v1/messages` it is Anthropic's own error shape, `event: error` with `{"type":"error","error":{"type":"budget_exhausted","code":"BUDGET_EXHAUSTED",…}}`, and no `message_stop`. For OpenAI-style routes it is a `data: {"error":{"type":"budget_exhausted","code":"BUDGET_EXHAUSTED",…}}` chunk and no `data: [DONE]`. Both SDKs raise these as errors. The error object has the usual `scope`, `remaining_micros`, `halt: true`, `retryable: false`, plus `stream_cut: true` and `charged_micros`. A paused run gives `spend_paused` / `SPEND_PAUSED`.

**How far past the budget a cut goes.** Each cut stream bills at most one crossing event beyond what the budget had free, plus the part of its `max_tokens` it hadn't streamed yet (charged on purpose, above). That debt blocks the next call. With several streams cut at once, each adds its own. The crossing event is usually a few tokens or one tool call; when it is Anthropic's `message_start`, it is the whole difference between the real prompt and the estimate (0.3.0 turned the same difference into debt at settle).

The decision row's code is `STREAM_CUT_BUDGET_EXHAUSTED` (or `STREAM_CUT_SPEND_PAUSED`). A cut stream is never stored for replay: a retry with the same idempotency key gets 409 `ALREADY_TERMINAL`. Events that only report final usage (OpenAI's last usage chunk, Anthropic's final `message_delta`) never cause a cut, because generation is already over; the call settles at the reported usage as before. An event that grows past 4 MB without ending can't be metered, so the stream is cut (`UPSTREAM_STREAM_BROKEN`) and charged its hold.

**Known limit (P3): no cut on `api.openai.com`.** OpenAI reports the prompt only in the stream's last usage chunk, and a final usage report never cuts. Output can't pass the reservation (it is capped at `max_tokens`), so on stock OpenAI the kill never fires: an input overrun there becomes debt at settle, which blocks the next call, exactly as in 0.3.0 and for non-streamed calls. The debt is bounded per stream by that call's input-estimate error (real prompt minus estimate), which is zero or less for the text kinds where the estimate is a floor (see [limits](#limits-and-threat-model)). The kill does fire on Anthropic and on OpenAI-compatible servers that report usage while streaming.

**What a cut costs on the ledger.** A cut stream is charged its real input and tool calls plus its whole `max_tokens`, which is the worst case of letting it finish. On the ledger, cutting a stream costs the same as letting it run to `max_tokens`. What the kill buys is the real provider spend it stops (generation ends at the cut, so the provider bills less than BurnBrake charged) and the halt signal your agent gets right away.

Lines ending in a bare `\r` (allowed by the SSE spec, not used by OpenAI or Anthropic) are not recognised as event boundaries. With the kill off, streams are passed through chunk for chunk exactly as in 0.3.0.

**Server tools.** Tools that run on the provider's side and are billed per use are refused unless the price table prices them. `prices/anthropic.yaml` prices Anthropic web search (`server_tools.web_search`); such a request must set `max_uses`, BurnBrake reserves `max_uses` searches, and at settle it charges the searches the provider reports. OpenAI `web_search_options` and any OpenAI tool that isn't `function` or `custom` are refused. Anthropic `document` (PDF) blocks are refused because their size in tokens can't be estimated from the request. Anthropic-defined client tools (`bash_*`, `text_editor_*`, `computer_*`) are refused too: Anthropic adds a hidden system prompt and tool definition for them whose size isn't published, so define the tool as a custom tool instead. Requests with `mcp_servers` (MCP connector) or `container` (code execution) are refused because their tool definitions and runtime aren't priced.

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
| Stream cut for budget | **200**, then a terminal error event in the stream | `BUDGET_EXHAUSTED` / `SPEND_PAUSED` with `stream_cut: true` | **No** | Halt. The partial answer is incomplete; it was charged its real input plus its whole output allowance. |
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
- **Overshoot on the call in flight.** The cap is checked before a call. A non-streamed call is never cut off: its real cost can exceed the estimate (the token count is an estimate, and images are priced with flat floors), and the difference becomes debt that blocks the next call. The overshoot is bounded by the estimate's error on each call in flight, not by a whole call: with several calls in flight at once, each can exceed its own estimate. A streamed call is metered as it runs and cut when it would pass the budget; each cut stream bills at most one crossing event beyond the budget, plus the unstreamed rest of its `max_tokens` (see [mid-stream kill](#mid-stream-kill)). An OpenAI stream whose server reports the prompt only at the end can't be cut for it; its input overrun becomes debt as for a non-streamed call. The input estimate is a floor (at least the real count) only where tests prove it against real GPT tokenizers (cl100k_base and o200k_base, `test/estimate-floor.test.ts`): numbers (space-separated, decimals; counted exactly), CSV, logs, markdown tables, English, code, URLs, UUIDs, whitespace, Japanese, Chinese and Russian. It is **not** a floor for base64 or other random strings (about half the real count), emoji (down to about half), math and other symbols, runs of punctuation (o200k), hex, Korean, Arabic and Hindi (cl100k), and JSON can come out a token or so low. Anthropic's tokenizer is not public, so no floor is claimed for it.
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
