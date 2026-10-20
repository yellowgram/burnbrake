# Changelog

## 0.3.0 (2026-10-19)

Streaming is now real pass-through, and Anthropic streams are charged correctly.

- **Input estimate floor.** Input tokens are now the larger of bytes / 3 and the pre-tokenizer piece count, so text made of very short words ("a b c …", digits, punctuation) is no longer under-counted (30,000 single letters: 30,007 tokens reserved, was 20,004).
- **Refused, not unpriced:** Anthropic `mcp_servers` and `container`, and Anthropic-defined client tools (`bash_*`, `text_editor_*`, `computer_*`), which now get a message saying to define a custom tool instead.
- The npm package no longer ships source maps that point at `src/` files it doesn't include.
- **Fixed: streams were buffered.** A streamed reply used to be read in full (up to 2 MB) before the first byte reached the client, and anything larger failed. BurnBrake now passes bytes through as they arrive, reads usage on the way past, and settles when the stream ends. There is no size limit on a stream.
- **Fixed: Anthropic streams were always charged the full estimate.** End-of-stream detection only knew OpenAI's `data: [DONE]`. BurnBrake now recognises Anthropic's `message_stop` and reads usage from `message_start` and `message_delta`.
- **Fixed: `stream_options` was sent to Anthropic.** It is now added only on OpenAI routes.
- Anthropic prompt-cache tokens are now charged: reads at 0.1x the input price (a few newer models charge less; BurnBrake uses the higher rate), 5-minute writes at 1.25x, 1-hour writes at 2x (2x when the breakdown is missing).
- If the client disconnects mid-stream, BurnBrake closes the provider connection and charges the estimate. Decision rows use `CLIENT_CLOSED` or `UPSTREAM_STREAM_BROKEN` for these cases.
- A stream that finished cleanly and is under 1.5 MB is stored for idempotent replay; others get 409 `ALREADY_TERMINAL` on retry rather than a second provider call.
- **Fixed: input in tool loops was under-estimated.** Tool definitions, earlier tool calls and their arguments, tool results and thinking blocks are now counted, as UTF-8 bytes / 3 (was characters / 4 of text only).
- **Fixed: provider-billed tools passed with only the tool floor.** Anthropic web search is priced per search (reserved at `max_uses`, charged at the reported count); other server tools, OpenAI `web_search_options` and non-function OpenAI tools are refused with `UNKNOWN_SURCHARGE`.
- **Fixed: an Anthropic stream with no final `message_delta` usage was charged one output token.** It is now charged the estimate.
- OpenAI streams always get `stream_options.include_usage: true`, even when the client sent `false`.
- A client that hangs up before the provider answers cancels the provider call; the provider has 10 minutes to send response headers.
- `npm pack` builds `dist` first, so a fresh clone packs a working package.
- The installed `burnbrake` command did nothing: npm installs bins as symlinks and the CLI did not resolve them, so `burnbrake --help` printed nothing and `burnbrake serve` exited at once with code 0. It now resolves the real path. The pack check asserts that the installed bin prints usage and that `serve` keeps running.
- The offline mock now streams the real Anthropic event sequence.
- Non-streamed bodies may be up to 8 MB (was 2 MB).
- `GET /health`: `deploy.hosted.hosted_monthly_sku` is removed; `deploy.hosted.note` is reworded.
- Docs rewritten in plain language with a quickstart and a limits section. Internal planning docs and old release checksums are removed.

## 0.2.0 (2026-10-19)

- Relicensed to MIT; no longer sold. `LICENSE` is the MIT License (Copyright (c) 2026 yellowgram). The commercial grant and the sales, pricing, refund and support-window docs, the release pack script, and internal review logs were removed from the tree (they remain in git history). Releases before 0.2.0 were published under the previous license.
- package.json: `license` MIT, adds `repository`, `homepage`, `bugs`, `author` for npm.

## Before 0.2.0

Changes made between 0.1.1 and 0.2.0, in short: a one-time operator allowance; the Anthropic `/v1/messages` route; a shorter replay-body TTL and optional encryption at rest; a heartbeat route; minimum reserves for vision and tool calls; constant-time key comparison with key rotation; an advisory single-writer lease; startup refusal of soft-halt or fail-open settings; and production mode requiring a user or day cap.

## 0.1.1

License change only, to a source-available license. Superseded by the MIT relicense in 0.2.0. No code changes.

## 0.1.0

First release: the sidecar, ledger, caps and SDK.

- Brake curve: optional pre-cap delay in the sidecar. Exhaust stays HTTP 402 `BUDGET_EXHAUSTED`, halt, not retryable, never 429. `brake.enabled` defaults to false. One-shot allowance is not in this change.
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
