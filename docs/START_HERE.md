# START_HERE

Canonical copy: the repository [README](../README.md) section **START_HERE**. This page is the short path.

From the v0.1.1 zip (`burnbrake-0.1.1.zip`, archive directory `burnbrake-0.1.1/`): confirm the SHA-256 against `checksums/burnbrake-0.1.1.sha256` in git, unzip, `cd burnbrake-0.1.1`, then `npm ci`. Node 22.13+. `dist/` is already in the zip. `npm run demo` needs devDependencies (do not pass `--omit=dev`). A git checkout has no `dist/`; run `npm run build` there before `serve`. Release `v0.1.1` is on GitHub (`burnbrake-0.1.1.zip`, SHA-256 matches `checksums/burnbrake-0.1.1.sha256`). Tag `v0.1.0` is the historical kit and is not this archive. The software is source-available commercial: PolyForm Noncommercial 1.0.0 plus the BurnBrake commercial grant (`docs/COMMERCIAL_GRANT.md`). OSI open source: false. The $199 self-host kit Polar listing is **LIVE** (PolyForm + BurnBrake commercial grant; CoS/www sell it). There is no checkout URL here. Soft-WTP is off. Exhaust is HTTP **402** `BUDGET_EXHAUSTED` (halt, not retryable). Legal seller: Suthirth Solutions, operating as yellowgram. Contact: hello@yellowgram.dev.

1. `BURNBRAKE_KEY=bb_…` and caps for **user and/or day**, plus run if you want it. Default listen `127.0.0.1`. Operator HTTP uses a different `BURNBRAKE_OPERATOR_KEY`. The spend key cannot change caps.
2. `OPENAI_BASE_URL=http://127.0.0.1:8787/v1` (SDK `baseURL` without `/v1`).
3. Header `X-BurnBrake-Key` or `Authorization: Bearer bb_…`. Never the provider key. Budget identity is `x-burnbrake-user-id` / `x-burnbrake-run-id`, not the OpenAI `user` field. The README example sets user and run caps, so both headers are required. Omitting one is **400** `IDENTITY_REQUIRED` and does not forward. `burnbrake serve` does not load `.env`. Compose reads `config.example.env`.
4. Search the app for a second client aimed at `api.openai.com`. BurnBrake only sees calls that hit the sidecar.
5. Under budget → 200. Over budget → **402** `BUDGET_EXHAUSTED`, and the mock/provider forward count does not move.
6. Halt on 402. It is not a rate limit. Do not retry. Do not open another base URL.
7. Set `max_tokens` yourself for long jobs. `4096` is injected only when you omit it, and a higher value you set is not clamped down.

Sealed offline smoke: [Quick start](../README.md#quick-start) (`npm ci`, then `npm run demo`). The script sets `mockUpstream: true` and clears `OPENAI_API_KEY`.

Promise: the next call is rejected when the reserve cannot cover the estimate, including debt. One already-forwarded call may still overshoot.
