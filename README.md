# BurnBrake

Request-path spend governor for agent loops. The sidecar estimates a completion, reserves that amount against user, run, and day caps, and **rejects the next call** when the reserve (including debt) cannot be covered.

One already-forwarded call may still overshoot. Debt gates the next call. This is not a promise of zero spend on a call that already left the process.

Primary shape: OpenAI-compatible sidecar. Secondary: a thin TypeScript SDK. First SKU: self-host kit. Polar listing is **dark** (not Polar-ready). Soft-WTP is off.

Contact: hello@yellowgram.dev

## START_HERE

BurnBrake only governs traffic that hits the sidecar. A second client pointed at `https://api.openai.com` bypasses every cap.

1. Install and start on localhost (auth required):

   ```bash
   npm install
   npm run build
   export BURNBRAKE_KEY=bb_replace_me
   export BURNBRAKE_CAP_USER_USD=10
   export BURNBRAKE_CAP_RUN_USD=1
   export BURNBRAKE_CAP_DAY_USD=5
   export BURNBRAKE_MOCK_UPSTREAM=1
   node --disable-warning=ExperimentalWarning dist/cli.js serve
   ```

   Default listen is `127.0.0.1:8787`. Copy `config.example.env` if you prefer a file. Set **user and/or day** as well as run. A per-run cap alone is washable by minting new run ids.

2. Send `X-BurnBrake-Key` (or `Authorization: Bearer bb_…`). Never put the provider API key in that header, and never send the BurnBrake key upstream. `OPENAI_API_KEY` is used only on the sidecar → provider hop.

3. Point the OpenAI client at the sidecar:

   ```bash
   export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
   ```

   SDK users set `baseURL` to `http://127.0.0.1:8787` (no `/v1`; the client appends the route).

4. Confirm the app has no second, ungated provider client.

5. Under budget, a completion returns 200 and the ledger moves reserve → settle. Over budget, the next completion returns **402** `BUDGET_EXHAUSTED` and the upstream call count stays flat.

6. Halt the agent loop on 402. Do not retry it as a rate limit, and do not open another base URL to get around it.

7. For long jobs, set your own `max_tokens`. The sidecar injects `max_tokens=4096` **only when you omit it**. It will not silently lower a higher ceiling you set. A high ceiling reserves more and can deny earlier. That is the gate working.

Offline proof (mock upstream, no provider spend):

```bash
npm run demo
```

## Dual-client bypass

BurnBrake cannot see a process that never calls it. After every agent deploy, check:

- `OPENAI_BASE_URL` (or the SDK `baseURL`) points at this sidecar
- requests carry `X-BurnBrake-Key` or `Bearer bb_…`
- the tree has no raw `api.openai.com` client left beside the gated one

If spend continues through a client that never hits the sidecar, the caps did not fail. The call never entered the gate.

## Decision table

`BUDGET_EXHAUSTED` is a halt. It is not HTTP 429. Do not retry the spend call.

| Signal | HTTP | Code | Retry the spend call? | Agent action |
| --- | --- | --- | --- | --- |
| Budget exhausted | **402** | `BUDGET_EXHAUSTED` | **No** | Halt the loop. Surface scope, remaining, requested. |
| Run or global pause | **402** | `SPEND_PAUSED` | **No** | Halt. Resume or raise caps from the operator CLI. |
| Unpriced model or unknown surcharge | **402** | `UNPRICED_MODEL` / `UNKNOWN_SURCHARGE` | **No** | Halt. Add the model or content type to the price table. |
| Auth failure | **401** | `AUTH_REQUIRED` | No | Halt. Fix `X-BurnBrake-Key`. Do not fall back to `api.openai.com`. Do not paste the provider key here. |
| Ledger unavailable | **503** | `LEDGER_UNAVAILABLE` | No | Halt. Fix the ledger file. There is no fail-open mode. |
| No caps configured | **503** | `NO_BUDGET_CONFIGURED` | No | Halt. Set a user, run, or day cap. |
| In-flight duplicate | **409** | `REQUEST_IN_FLIGHT` | Do not start a second forward | Wait. Reuse the same idempotency key. |
| Provider rate limit | provider **429** (passed through) | upstream body | Per the provider, not this gate | Do not confuse this with `BUDGET_EXHAUSTED`. |
| Provider 5xx or disconnect after forward | upstream / **502** | — | Only with the **same idempotency key** | Expect settle if usage is known, otherwise `DEBIT_RESERVED`. |
| Upstream success | **200** | — | — | Continue. |

SDK: a 402 `BUDGET_EXHAUSTED` is thrown as `BudgetExhausted` with the same fields (`scope`, `remaining_micros`, `requested_micros`, `run_id`, `user_id`). `halt` is true and `retryable` is false.

Once a call is `FORWARDED`, BurnBrake does not reject it mid-stream. The next call is the gate.

## Idempotency

The TypeScript SDK **requires** `idempotencyKey` on every happy-path call. Raw HTTP may omit `Idempotency-Key` / `x-burnbrake-request-id`, but that is loud on purpose: a retry after the sidecar has forwarded, sent without that key, can start a second provider call. Retries after forward must carry the same key. The same key does not double-forward. A new logical attempt needs a new key (a stored 402 is replayed for the old key).

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

Identity headers are accepted only after auth: `x-burnbrake-user-id`, `x-burnbrake-run-id`. The OpenAI `user` field is used as the user id only when the header is absent.

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

The same controls are on `/v1/operator/*` with the BurnBrake key: `balances`, `decisions`, `reservations`, `runs/top`, `runs/kill`, `pause`, `resume`, `caps`, `force-release`.

`GET /health` (no key) reports listen address, `auth.required`, `ledger.writable`, `fail_closed`, price-table `version` / `priced_at` / stale flag, and `estimate.default_max_tokens`. It never echoes secrets.

Auth rotation: change `BURNBRAKE_KEY`, restart the sidecar, and update every agent on this deploy. One secret per deploy. Do not rotate by swapping in the provider key.

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

- npm package: `npm install` / `npm run build` / `burnbrake serve` (Node 22.13+)
- optional Docker: `docker compose up --build` publishes **only** `127.0.0.1:8787`. Inside the container the process binds `0.0.0.0` so Docker can reach it, with `BURNBRAKE_ALLOW_PUBLIC_BIND=1` and auth still required. Do not publish that port on a public interface without an ACL.

Hosted multi-tenant ledger service is later. It is not in this kit.

## Tests

```bash
npm test
npm run demo
```

## Known limits

- One in-flight call can settle above the reserve, or a crash can debit the estimate. The next call is gated.
- Skewed clocks across writers that do not share this ledger can split the UTC day bucket.
- A client that ignores the sidecar is not stopped.
- Per-run caps alone can be washed by rotating `run_id`.
- Not Polar-ready. No zip or SHA is published. Listing stays dark until a founder go-live.

Design record and LaunchGate freezes: [docs/LAUNCHGATE_DR4_VERDICT.md](docs/LAUNCHGATE_DR4_VERDICT.md).
