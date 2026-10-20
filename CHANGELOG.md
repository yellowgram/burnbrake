# Changelog

## 0.4.0 (2026-10-20)

**Mid-stream kill.** A streamed response can no longer run past the budget before it settles.

- While a stream is proxied, BurnBrake cuts it into server-sent events and meters what the call has consumed: Anthropic's real input count from `message_start` (prompt-cache tokens converted as at settle), text, thinking and tool-input deltas, the cumulative `message_delta` usage and `server_tool_use` blocks (up to the tool's reserved `max_uses`: Anthropic refuses and doesn't bill a use past it, so server tools never cause a cut); OpenAI-style choice deltas (text, refusal, tool-call arguments; at least one token per choice per chunk) and any `usage` a chunk carries. Generated text is counted with the input estimator's floor and capped at the reserved output (`max_tokens` × choices), so a stream inside its own reservation is never cut; the provider's own count wins when higher.
- When the consumption would pass the call's hold, the hold is grown from the free budget in one ledger transaction across all scopes, so concurrent streams on one budget can't spend the same headroom. If it can't be grown (budget exhausted, or the run or deploy paused), the provider stream is closed before the crossing event, the call is charged its real input and server-tool calls (including that event) plus its whole output allowance, which covers output the provider bills but never streamed (hidden thinking or reasoning, tokens after the close), and the client gets one terminal error event: Anthropic's `event: error` shape on `/v1/messages` (no `message_stop`), an OpenAI-style `data: {"error":…}` chunk elsewhere (no `[DONE]`). The error has `code` `BUDGET_EXHAUSTED` or `SPEND_PAUSED`, `stream_cut: true` and `charged_micros`. Decision codes `STREAM_CUT_BUDGET_EXHAUSTED` / `STREAM_CUT_SPEND_PAUSED`. Cut streams are not stored for replay.
- Final usage events never cut (generation is over). An SSE event over 4 MB without an end is cut as `UPSTREAM_STREAM_BROKEN` and charged its hold.
- On by default; `BURNBRAKE_STREAM_KILL=0` restores 0.3.0's uncut pass-through. An unreadable value refuses to start. `GET /health` reports `stream_kill.enabled`.
- Ledger: reservations gain `extended_micros` (added automatically to a 0.3.0 file). Debits on broken or abandoned streams charge the whole hold (estimate plus extension); overshoot is measured against the hold.
- Each cut stream bills at most one crossing event beyond the budget, plus the unstreamed rest of its `max_tokens`. On the ledger a cut costs the same as letting the stream finish at `max_tokens`; the kill saves real provider spend and stops the agent at once.
- Known limit: on `api.openai.com` the kill never fires (the prompt is reported only in the final usage chunk, which never cuts); an input overrun there becomes settle debt, bounded per stream by the input-estimate error, as in 0.3.0.
- **Fixed: input estimate under real for some text.** The input estimate is now a floor on GPT tokenizers. The piece split no longer joins a space to a digit run, so "1 2 3 … 10" counts 19 tokens, as GPT tokenizers do (3,000 space-separated numbers were 37% under). Non-ASCII runs, base64-like runs, hex-like runs and letter+digit runs of 2+ characters (AWS key IDs, ULIDs, base32 secrets, base36 ids, k8s pod hashes) count one token per UTF-8 byte; digits exactly; punctuation and control characters per character; whitespace per run; each word at the larger of its bytes / 3 and one token per uncommon letter pair, with letter runs that repeat a unit of 1–6 letters ("llll", "abab") at one token per letter; plus one token of margin per text part. Before, base64 was 0.47× the real count, emoji 0.49×, AWS key IDs 0.70×, random letters 0.55×. Checked against real cl100k and o200k counts (js-tiktoken, devDependency only) by 40 pinned fixture classes and a seeded fuzz test. A one-off sweep of 3.12 million cases (8 blocks of 10,000 seeds starting at 1, 3,000,001, 13,000,001, 14,000,001, 15,000,001, 16,000,001, 17,000,001 and 900,000,001) had one case under, by one token: a random run-together lowercase string ("kxioroeesicetrrp", 15 vs 16 on cl100k), now pinned; random letter-only strings are a measured heuristic, not a proven floor. The hold for non-Latin input is larger (up to about 4.1× for Chinese, Japanese and Russian; released at settle), so near the cap such a call can be refused.
- `burnbrake reconcile-holds` repairs scope holds left behind if 0.3.0 was run against a ledger with an extended reservation in flight (see OPERATOR, "Going back to 0.3.0").

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
