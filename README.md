# BurnBrake

Request-path spend governor for agent loops. The sidecar estimates a completion, reserves that amount against user, run, and day caps, and **rejects the next call** when the reserve (including debt) cannot be covered.

One already-forwarded call may still overshoot. Debt gates the next call. This is not a promise of zero spend on a call that already left the process.

Primary shape: OpenAI-compatible sidecar. Secondary: a thin TypeScript SDK. First cash SKU: self-host **one-org kit $199 once** (seller **Suthirth solutions**). The software is source-available commercial. [LICENSE](LICENSE) is the PolyForm Noncommercial License 1.0.0 (`PolyForm-Noncommercial-1.0.0`). OSI open source: false. Commercial production use of the self-host kit requires the [BurnBrake commercial grant](docs/COMMERCIAL_GRANT.md): one organization, the named tag, perpetual for that tag. The $199 purchase is that grant, this packaged kit, and 60-day Issues (no SLA). Hosted **$59/mo** is a separate optional SKU. It does not grant self-host production rights. Current kit archive: `burnbrake-0.1.1.zip`. Release **v0.1.1** is on GitHub (`burnbrake-0.1.1.zip`, SHA-256 `6406dd2d4c0e783273ebc98b028ac4c53dcd972de550d9995c3f26b4901a1f6c`, matches `checksums/burnbrake-0.1.1.sha256`). Tag `v0.1.0` and `checksums/burnbrake-0.1.0.*` stay as the historical kit and are not resealed. The $199 self-host kit Polar listing is **LIVE** (PolyForm Noncommercial 1.0.0 + BurnBrake commercial grant; CoS/www sell it). Hosted **$59/mo** remains a separate live optional SKU and does not grant self-host production rights. This file has no checkout URL. Soft-WTP is off. Pricing lock: [docs/COMMERCIAL_LOCK.md](docs/COMMERCIAL_LOCK.md).

Contact: hello@yellowgram.dev

## Quick start

Offline sealed smoke (fixture / mock upstream, no live keys, no provider spend):

```bash
npm ci
npm run demo
```

`npm run demo` runs `scripts/demo-60s.ts`. The script sets `mockUpstream: true` and clears `OPENAI_API_KEY` for that process. There is no live provider key and no provider spend.

Needs Node 22.13+ and a full `npm ci`. The demo uses the TypeScript runner, so do not pass `--omit=dev`. From the kit zip: unzip `burnbrake-0.1.1.zip`, `cd burnbrake-0.1.1`, then the same commands (`dist/` is already in the zip).

What it proves: health, then one under-budget allow, then **402** `BUDGET_EXHAUSTED` with the mock forward count flat. Soft-WTP is off.

Honesty: one already-forwarded call may still overshoot; the deny step is HTTP **402** `BUDGET_EXHAUSTED` (halt, not retryable, not 429) and does not call upstream.

Details: [docs/DEMO_60S.md](docs/DEMO_60S.md).

## START_HERE

BurnBrake only governs traffic that hits the sidecar. A second client pointed at `https://api.openai.com` bypasses every cap.

1. Install and start on localhost (auth required):

   ```bash
   npm ci
   npm run build
   export BURNBRAKE_KEY=bb_replace_me
   export BURNBRAKE_CAP_USER_USD=10
   export BURNBRAKE_CAP_RUN_USD=1
   export BURNBRAKE_CAP_DAY_USD=5
   export BURNBRAKE_MOCK_UPSTREAM=1
   node --disable-warning=ExperimentalWarning dist/cli.js serve
   ```

   Default listen is `127.0.0.1:8787`. `burnbrake serve` reads the process environment. It does not load `.env`. Docker Compose reads `config.example.env` directly; a copied `.env` does not override that file. Set **user and/or day** as well as run. A per-run cap alone is washable by minting new run ids. Operator HTTP (`/v1/operator/*`) needs a different `BURNBRAKE_OPERATOR_KEY`. The spend key cannot change caps.

   A git checkout has no `dist/`, so `npm run build` is required. The v0.1.1 zip already contains `dist/`. `npm ci` is still required: the `yaml` dependency is not in the archive. `npm run demo` needs the TypeScript runner from devDependencies, so do not pass `--omit=dev`. From the zip: `unzip burnbrake-0.1.1.zip && cd burnbrake-0.1.1` and then the same commands. The archive root directory is `burnbrake-0.1.1/`.

   The exports above turn on user, run, and day. A completion must send both identity headers or the sidecar returns **400** `IDENTITY_REQUIRED` and does not forward. The OpenAI `user` field is not a budget id.

   ```bash
   curl -sS http://127.0.0.1:8787/v1/chat/completions \
     -H "content-type: application/json" \
     -H "X-BurnBrake-Key: $BURNBRAKE_KEY" \
     -H "x-burnbrake-user-id: alice" \
     -H "x-burnbrake-run-id: run-1" \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":16}'
   ```

2. Send `X-BurnBrake-Key` (or `Authorization: Bearer bb_…`). Never put the provider API key in that header, and never send the BurnBrake key upstream. `OPENAI_API_KEY` is used only on the sidecar → provider hop.

3. Point the OpenAI client at the sidecar:

   ```bash
   export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
   ```

   SDK users set `baseURL` to `http://127.0.0.1:8787` (no `/v1`; the client appends the route).

4. Confirm the app has no second, ungated provider client.

5. Under budget, a completion returns 200 and the ledger moves reserve → settle. Over budget, the next completion returns **402** `BUDGET_EXHAUSTED` and the upstream call count stays flat.

6. Halt the agent loop on 402. Do not retry it as a rate limit, and do not open another base URL to get around it.

7. For long jobs, set your own `max_tokens`. The sidecar injects `max_tokens=4096` **only when you omit it**. It will not silently lower a higher ceiling you set. A high ceiling reserves more and can deny earlier. That is the gate working. `n` and `best_of`, when present, multiply that output ceiling. They are forwarded unchanged.

The sealed offline smoke is [Quick start](#quick-start).

## Dual-client bypass

BurnBrake cannot see a process that never calls it. After every agent deploy, check:

- `OPENAI_BASE_URL` (or the SDK `baseURL`) points at this sidecar
- requests carry `X-BurnBrake-Key` or `Bearer bb_…`
- the tree has no raw `api.openai.com` client left beside the gated one

If spend continues through a client that never hits the sidecar, the caps did not fail. The call never entered the gate.

## Decision table

`BUDGET_EXHAUSTED` is a halt. It is not HTTP 429. Do not retry the spend call.

HTTP **402** is the halt family. Budget, pause, and unpriced share that status and are distinguished by `error.code`. They are never **429**. Every other failure uses a different status.

| Signal | HTTP | Code | Retry the spend call? | Agent action |
| --- | --- | --- | --- | --- |
| Budget exhausted | **402** | `BUDGET_EXHAUSTED` | **No** | Halt the loop. Surface scope, remaining, requested. |
| Run or global pause | **402** | `SPEND_PAUSED` | **No** | Halt. Resume or raise caps from the operator CLI. |
| Unpriced model or unknown surcharge | **402** | `UNPRICED_MODEL` / `UNKNOWN_SURCHARGE` | **No** | Halt. Add the model or content type to the price table. |
| Auth failure | **401** | `AUTH_REQUIRED` | No | Halt. Fix `X-BurnBrake-Key`. Do not fall back to `api.openai.com`. Do not paste the provider key here. The spend key on an operator route is also 401. |
| Missing budget identity | **400** | `IDENTITY_REQUIRED` | No | The example caps turn user and run on. Send `x-burnbrake-user-id` and `x-burnbrake-run-id`. The OpenAI `user` field does not count. No forward. |
| Bad request or body too large | **400** / **413** | `BAD_REQUEST` / `BODY_TOO_LARGE` | No | Includes disagreeing `Idempotency-Key` and `x-burnbrake-request-id`. No forward. |
| Ledger unavailable before forward | **503** | `LEDGER_UNAVAILABLE` | No | Halt. Fix the ledger file. There is no fail-open mode. No upstream call. |
| No caps configured | **503** | `NO_BUDGET_CONFIGURED` | No | Halt. Set a user, run, or day cap. |
| Upstream not configured | **503** | `UPSTREAM_NOT_CONFIGURED` | No | Set `OPENAI_API_KEY`, or `BURNBRAKE_MOCK_UPSTREAM=1`. No forward. |
| Operator HTTP with no operator key | **403** | `OPERATOR_KEY_REQUIRED` | No | Set `BURNBRAKE_OPERATOR_KEY`. This is not a spend-path code. |
| In-flight duplicate | **409** | `REQUEST_IN_FLIGHT` | Do not start a second forward | Wait. Reuse the same idempotency key. |
| Same idempotency key, different user or run | **409** | `IDEMPOTENCY_MISMATCH` | No | `halt` is false. No forward. |
| Terminal key, no stored body | **409** | `ALREADY_TERMINAL` | **No** | This key will not forward again. A new logical attempt needs a new key. |
| Other `/v1/*` route | **404** | `ROUTE_NOT_GOVERNED` | No | Not proxied. |
| Provider rate limit | provider **429** (passed through) | upstream body | Per the provider, not this gate | Do not confuse this with `BUDGET_EXHAUSTED`. |
| Provider 5xx or disconnect after forward | upstream / **502** | `UPSTREAM_ERROR` or the upstream body | Only with the **same idempotency key** | Expect settle if usage is known, otherwise `DEBIT_RESERVED`. |
| Ledger failure after forward | **502** | `LEDGER_UNAVAILABLE` | Only with the **same idempotency key** | Distinct from the pre-forward 503. The debit stands. |
| Upstream success | **200** | — | — | Continue. |

SDK: a 402 `BUDGET_EXHAUSTED` is thrown as `BudgetExhausted` with the same fields (`scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`). `halt` is true and `retryable` is false. The SDK does not sleep on 402. A brake delay, when configured, happens in the sidecar before reserve.

Optional brake curve (default **off**): slow down before the cap, then the same 402 halt. `brake.enabled` is not a halt-off switch. While it is false, exhaust responses match the halt-only path (no zone headers, no `Retry-After`, never 429). Operator commands: `burnbrake brake show|set` and `/v1/operator/brake`. See [docs/OPERATOR.md](docs/OPERATOR.md).

Once a call is `FORWARDED`, BurnBrake does not reject it mid-stream. The next call is the gate.

## Idempotency

The TypeScript SDK **requires** `idempotencyKey` on every happy-path call. Raw HTTP may omit `Idempotency-Key` / `x-burnbrake-request-id`, but that is loud on purpose: a retry after the sidecar has forwarded, sent without that key, can start a second provider call. Retries after forward must carry the same key. The same key does not double-forward. A key whose reservation is already terminal is not reserved again: the stored response is replayed, or the retry gets **409** `ALREADY_TERMINAL` if no body was stored. A new logical attempt needs a new key (a stored 402 is replayed for the old key).

## Routes

Governed (estimated, reserved, then forwarded or rejected):

- `POST /v1/chat/completions`
- `POST /v1/completions`

Any other `/v1/*` route returns `ROUTE_NOT_GOVERNED` and is **not** proxied.

## Configure caps

| Env | Meaning |
| --- | --- |
| `BURNBRAKE_CAP_USER_USD` or `_MICROS` | Default cap for each `x-burnbrake-user-id` |
| `BURNBRAKE_CAP_RUN_USD` or `_MICROS` | Default cap for each `x-burnbrake-run-id` |
| `BURNBRAKE_CAP_DAY_USD` or `_MICROS` | Deploy-wide cap for the UTC day |

Scopes that are configured are AND-ed. The first scope that cannot cover the estimate (user, then run, then day) is the one named on the 402. Day buckets use the ledger clock in **UTC**. Outstanding debt (settle above reserve, or a negative remaining after a debit) blocks the next reserve until a cap raise or, for the day scope, the next UTC day leaves that bucket behind.

Identity headers are accepted only after auth: `x-burnbrake-user-id`, `x-burnbrake-run-id`. The OpenAI `user` field is forwarded to the provider and is **not** a budget id. A client that stamps a different `user` on each call does not mint a new cap. Without a day cap, those headers are caller-chosen and can be rotated.

## Operator

CLI talks to the SQLite ledger directly (`BURNBRAKE_LEDGER_PATH` or `--ledger`):

```bash
burnbrake balances --user alice --run run-1
burnbrake decisions --deny-only --run run-1 --format csv
burnbrake kill --run run-1
burnbrake resume --run run-1
burnbrake pause --global
burnbrake caps set --scope day --usd 5
burnbrake top-runs --window 1h
burnbrake force-release --reservation <id> --reason "provider confirmed no charge" --attest-no-charge
```

The same controls are on `/v1/operator/*` (`balances`, `decisions`, `reservations`, `runs/top`, `runs/kill`, `pause`, `resume`, `caps`, `force-release`). Those routes require `BURNBRAKE_OPERATOR_KEY`: a `bb_…` secret that is not `BURNBRAKE_KEY` and not the provider key. Send it as `X-BurnBrake-Key` or `Authorization: Bearer bb_…` on operator routes. The spend key is rejected. If the operator key is unset, operator HTTP returns **403** `OPERATOR_KEY_REQUIRED` and does not fall back to the spend key, including on localhost. The CLI does not use that key; access to the SQLite file is operator control, so protect the file.

`GET /health` (no key) reports listen address, `auth.required`, `operator_http`, `ledger.writable`, `fail_closed`, price-table `version` / `priced_at` / stale flag, and `estimate.default_max_tokens`. It never echoes secrets.

Auth rotation: change `BURNBRAKE_KEY` for agents and `BURNBRAKE_OPERATOR_KEY` for operator HTTP independently, restart the sidecar, and update the clients that hold that secret. Do not put the operator key in the agent environment. Do not rotate by swapping in the provider key. Rotating either HTTP key does not lock the SQLite file. The CLI has no key; the file is created mode `0600`, and anyone who can write it can change caps.

Force-release is audited and only for a stuck row you have proved was not charged. The default for crash or TTL while `FORWARDED` is **DEBIT_RESERVED** (the estimate is spent). A `RESERVED` row that never forwarded is released. TTL is **15 minutes**.

Denies must show `upstream_forwarded=false`. If a deny shows true, stop and treat it as a product bug.

Runbook: [docs/OPERATOR.md](docs/OPERATOR.md). Design pack: [docs/](docs/).

## Price table

`prices/openai.yaml` is a static versioned table (`version`, `priced_at`). Models missing from it are denied. There is no live price feed and no silent $0. If `priced_at` is older than **30 days**, health and the operator balances warn. The gate still enforces. Stale does not fail open.

## Reservation states

| State | Budget effect |
| --- | --- |
| `RESERVED`, then reject or failure before forward | `RELEASE_PRE_FORWARD` |
| `FORWARDED`, then usage known | `SETTLED` (debit actual, release unused hold). Overshoot becomes debt. |
| `FORWARDED`, provider 4xx and no usage | `RELEASE_UPSTREAM_NO_CHARGE` |
| `FORWARDED`, then 5xx, disconnect, or no usage | `DEBIT_UPSTREAM_UNKNOWN` |
| Crash or TTL while `FORWARDED` | `DEBIT_TTL_OR_CRASH` |
| Operator force-release with attestation | `FORCE_RELEASE_AUDITED` |

## SDK

```ts
import { BurnBrake, BudgetExhausted } from "burnbrake";

const bb = new BurnBrake({
  baseURL: "http://127.0.0.1:8787",
  apiKey: process.env.BURNBRAKE_KEY!,
});

try {
  await bb.chat.completions.create(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 256 },
    { idempotencyKey: "step-1", userId: "alice", runId: "run-1" },
  );
} catch (err) {
  if (err instanceof BudgetExhausted) {
    // Halt. Do not retry. Do not open a second base URL.
    throw err;
  }
  throw err;
}
```

`idempotencyKey` is required. The SDK throws `IdempotencyKeyRequired` before sending if it is missing.

## Self-host kit

- Archive buyers download: `burnbrake-0.1.1.zip`. Confirm `sha256sum burnbrake-0.1.1.zip` against `checksums/burnbrake-0.1.1.sha256` in git, then `unzip burnbrake-0.1.1.zip && cd burnbrake-0.1.1`. Release `v0.1.1` is on GitHub with that zip (SHA-256 matches `checksums/burnbrake-0.1.1.sha256`). This file does not embed the digest. The archive cannot contain its own hash. The historical tag `v0.1.0` and `checksums/burnbrake-0.1.0.*` are the prior kit. They are not this archive and they are not resealed.
- npm package: `npm ci` / `npm run build` / `node dist/cli.js serve` (Node 22.13+). The zip already includes `dist/`.
- optional Docker: the image listens on `127.0.0.1` unless you opt in. `docker compose up --build` publishes **only** `127.0.0.1:8787` and sets `BURNBRAKE_HOST=0.0.0.0` plus `BURNBRAKE_ALLOW_PUBLIC_BIND=1` inside the container so Docker can reach that process. Compose loads `config.example.env` as its env file. Edit that file. A copied `.env` is not read. The placeholder keys in the example are public and are only appropriate on that localhost publish. Do not `docker run -p 8787:8787` and do not publish `0.0.0.0` without an ACL.

Hosted multi-tenant ledger service is a separate optional SKU (**$59/mo**). It is not in this kit, and it does not grant self-host production rights or rights to run a competing hosted service. The buyer of the $199 kit keeps the zip. See [docs/COMMERCIAL_LOCK.md](docs/COMMERCIAL_LOCK.md) and [docs/COMMERCIAL_GRANT.md](docs/COMMERCIAL_GRANT.md). Soft-WTP, coupons, and cold invoices are not part of this kit. Refund on the **$199** one-org kit is **14 days**. Support is **60-day Issues**, no SLA: hello@yellowgram.dev. Legal seller: Suthirth Solutions, operating as yellowgram.

## Tests

```bash
npm test
npm run demo
```

Pull requests and pushes to `main` run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` on Node 22.

## Known limits

- One in-flight call can settle above the reserve, or a crash can debit the estimate. The next call is gated. Tool and vision ceilings are flat allowances, so that one call can still overshoot. Debt gates the next call. This is not a promise of zero overspend. There is no claim that BurnBrake will outrun OpenAI forever.
- The idempotency table stores upstream response bodies so a short retry can replay them. Bodies are removed after **24 hours**; the key stays terminal and is not reserved again. The SQLite file is mode `0600` and is still a secret. Decision rows do not store prompts.
- A day cap set only on one UTC date (`--key` / `key` for that date) does not roll to the next day. Set the default day cap (omit the key) if you want the fence to continue.
- Skewed clocks across writers that do not share this ledger can split the UTC day bucket.
- A client that ignores the sidecar is not stopped.
- Per-run caps alone, or a user cap without a day cap, can be washed by rotating `x-burnbrake-run-id` / `x-burnbrake-user-id`. The OpenAI `user` field does not do that; it is not a budget id.
- Filesystem access to the ledger is full operator control. The CLI has no key of its own.
- `X-BurnBrake-Key` comparison returns early when the lengths differ, so a local observer can learn the secret's length. It does not reveal the secret. Process logs print error messages only. They do not print the BurnBrake key, the operator key, or the provider key. Do not put a secret in an idempotency key; that key is stored in the ledger.
- A TTL or crash debit records `debt_delta_micros` as 0 on the decision row. Balances still show debt when spent plus held exceeds the cap, and the next reserve still denies. Force-release is the only path that drops a hold after `FORWARDED`, and it requires the operator key plus `attest_no_charge`. A false attestation is operator misuse.
- The $199 self-host kit Polar listing is **LIVE** (PolyForm + BurnBrake commercial grant; CoS/www sell it). Soft-WTP stays off. There is no checkout URL in this file. Hosted **$59/mo** stays a separate live optional SKU and is not this kit.

Design record and LaunchGate freezes stay in the git repository (not in the buyer zip): [docs/LAUNCHGATE_DR4_VERDICT.md](docs/LAUNCHGATE_DR4_VERDICT.md). CR*/DR* attack logs stay in git as well.
