# Operator runbook

Everything an operator can see and do: balances, decisions, kill and pause, caps, the brake curve, force-release and reconcile-holds.

The CLI opens the SQLite ledger (`BURNBRAKE_LEDGER_PATH` or `--ledger`) and can run while the sidecar is up. Whoever can read that file can change caps. Protect the file. The CLI does not take the writer lease. See [SINGLE_STORE.md](./SINGLE_STORE.md).

Auth compare does not return early on secret length. To rotate without a gap, set `BURNBRAKE_KEY_PREVIOUS` to the outgoing spend secret and `BURNBRAKE_OPERATOR_KEY_PREVIOUS` to the outgoing operator secret, restart with the new current keys, then remove the previous keys on a later restart. Do not reuse the provider key.

HTTP routes under `/v1/operator/*` require `BURNBRAKE_OPERATOR_KEY`, a `bb_…` secret that is not `BURNBRAKE_KEY` and not the provider key. Send it as `X-BurnBrake-Key` or `Authorization: Bearer bb_…` on those routes only. The spend key is rejected (401). If the operator key is unset, operator HTTP returns 403 `OPERATOR_KEY_REQUIRED` and does not fall back to the spend key.

## Balances

```bash
burnbrake balances --user alice --run run-1
burnbrake balances --json
```

Each scope shows cap, spent, held (active reservations), remaining, debt (uncovered when spent + held exceeds the cap), and cumulative overshoot. Day keys are UTC dates from the ledger clock. `GET /health` and balances both show price-table `version`, `priced_at`, and a stale warning after 30 days. Stale still enforces.

If you only configured per-run, the CLI prints a warning: set a user and/or day cap. `NODE_ENV=production` or `BURNBRAKE_PRODUCTION=1` refuses to start in that state. Health `deploy.stops_all_spend` is false: a second client is outside this process. See [DEPLOY_INVARIANTS.md](./DEPLOY_INVARIANTS.md). Exhaust bytes are frozen in [EXHAUST_CONTRACT.md](./EXHAUST_CONTRACT.md).

## Decisions

```bash
burnbrake decisions --deny-only --run run-1
burnbrake export --run run-1 --format csv
```

Columns include requested micros, remaining, debt delta, model, route, idempotency key, `price_table_version`, `estimated_micros`, `settled_micros`, and `upstream_forwarded`. A deny with `upstream_forwarded=1` is a bug. Prompts and completions are not logged.

```bash
burnbrake estimate-error
```

`GET /v1/operator/estimate-error` (operator key) counts forwarded decisions where settle and reserve both exist. `under_reserve` is settle above reserve. That does not open the next call. Vision and tool reserves use mandatory floors (1600 input tokens and 5000 micros per image; 512 extra output tokens and 10000 micros when tools are present). A lower number in the price table is raised. It is not lowered.

## One-shot allowance

```bash
burnbrake allowance grant --scope run --key run-1 --micros 100000 --reason "ticket 9"
burnbrake allowance list --scope run --key run-1
```

One reserve that would have halted on that scope can proceed if the estimate is within `grant_micros`. The grant is consumed. The next reserve is HTTP 402 `BUDGET_EXHAUSTED` with `halt: true` and `retryable: false` unless another grant is open. This is not a halt-off switch. HTTP `POST /v1/operator/allowances` is the same grant and rejects a body that tries to set `retryable` or `halt`.

Retention is yours. The ledger file is the log. Delete or archive the SQLite file on your own schedule.

## Kill and caps

```bash
burnbrake kill --run run-1          # refuse further reserves for that run
burnbrake resume --run run-1
burnbrake pause --global
burnbrake resume --global
burnbrake caps set --scope user --key alice --usd 10
burnbrake caps set --scope day --usd 5
burnbrake caps set --scope run --usd 1   # default for new runs
```

`caps set` without `--key` updates the default for new user or run ids. For day, it updates the default and today's UTC bucket. Existing user/run rows keep their cap until you pass `--key`.

`kill`/`pause` also stop a stream that is already running once it needs more than its reservation: the mid-stream kill asks the ledger to grow the hold, and a paused run or global pause refuses it, so the stream is cut with `SPEND_PAUSED`. A stream still inside its reservation runs to its end.

There is no switch to allow spend past a cap, and no switch to forward when the ledger is down.

## Mid-stream kill

On by default (`BURNBRAKE_STREAM_KILL=0` turns it off; any other value than on/off/1/0/true/false/yes/no refuses to start). See the README section of the same name for what is metered. In the ledger:

- a stream that runs past its estimate grows its reservation's hold (`extended_micros` on the reservation row; `held_micros` on every scope it holds) one event at a time, only while every scope has the headroom;
- a cut stream settles at its real input and server-tool calls so far (the event that crossed included) plus its whole output allowance (`max_tokens`), because the provider bills output it never streamed (hidden thinking or reasoning, tokens generated after the close): `terminal_reason` `SETTLED`, decision code `STREAM_CUT_BUDGET_EXHAUSTED` or `STREAM_CUT_SPEND_PAUSED`, with `scope` set. Each cut stream bills at most one crossing event beyond the budget, plus the part of `max_tokens` it hadn't streamed; with N streams cut at once, N such amounts. When the crossing event is Anthropic's `message_start`, that one event is the whole difference between the real prompt and the estimate. On the ledger a cut costs the same as letting the stream finish at `max_tokens`; the kill saves real provider spend and halts the agent at once. Server-tool blocks count only up to the tool's `max_uses` (Anthropic refuses and doesn't bill a use past it), so server tools never cause a cut;
- a stream that broke off or whose client left is debited its whole hold (estimate plus any extension), as before.

**Known limit (P3):** on `api.openai.com` the kill never fires, because OpenAI reports the prompt only in the final usage chunk and final usage never cuts. An input overrun there becomes debt at settle (`under_reserve` in `GET /v1/operator/estimate-error`), bounded per stream by that call's input-estimate error. On GPT tokenizers the estimate is measured at or above the real count for natural text and the tested shapes (fixture and seeded fuzz tests against cl100k and o200k), so that debt is zero there; adversarial synthetic text (a pseudo-word repeated many times, uppercase nonsense) can come in under by up to about 44% (README, known limits), and settle charges the reported count, so the shortfall shows as debt.

**Known limit (P3): input holds err high.** Non-ASCII, base64-like, hex-like and letter+digit text is held at one token per UTF-8 byte: up to about 4.1× the real input for Chinese, Japanese and Russian, 2.5–2.9× for Korean, Arabic and Hindi, 1.4–2× for ids, base64, JSON, emoji and math; English, code and source files about 1.3–2.25×. The hold is released at settle (on Anthropic, replaced by the real count at `message_start`), so no spend is lost; near the cap such a call can be refused although it would have fitted (fail-closed). `under_reserve` stays near zero; expect larger `over_reserve` on those prompts.

A 0.3.0 ledger file gains the `extended_micros` column the first time 0.4.0 opens it. If another process holds the file's write lock, opening waits 5 s and then fails without changing it; start again once the lock is free.

**Going back to 0.3.0.** Stop 0.4.0 with no stream in flight first. 0.3.0 doesn't know `extended_micros`: if it settles, debits or sweeps a reservation whose hold was extended, it releases only the estimate part, and the extension stays in `held_micros` on that reservation's user and run scopes **permanently** (the day scope recovers at the next UTC day). Upgrading again doesn't remove it. This fails closed: those scopes have less room than they should (calls are refused early), and no money is lost. 0.3.0's TTL sweep of such a row also debits only the estimate, so the spend recorded for it is low by the extension. To repair the holds, run once with 0.4.0 or later, against the same ledger file:

```bash
burnbrake reconcile-holds            # or: npx burnbrake@0.4.0 reconcile-holds --ledger /path/to/ledger.sqlite
```

It sets every scope's `held_micros` to what its open (RESERVED or FORWARDED) reservations hold, in one transaction, and prints one `HOLD_RECONCILED scope:key held_micros <before> -> <after>` line per scope it changed (`HOLDS_OK` when nothing was off; `--json` for a machine-readable list). Spend is not changed. It is safe while the sidecar runs: open reservations, including extended ones, are counted.

## Brake curve

`burnbrake brake show|set` and `GET`/`POST /v1/operator/brake` (operator key only; the spend key is 401). How the zones work: [BRAKE_CURVE.md](./BRAKE_CURVE.md).

`brake.enabled` defaults to **false** and is not a halt-off switch. While it is false, the spend path matches the pre-curve halt: no zone delay and no brake headers. At the cap the sidecar still returns HTTP **402** `BUDGET_EXHAUSTED` with `halt: true` and `retryable: false`. There is no `Retry-After` and no 429 for exhaust. A black delay is a pre-402 pause only. The wait does not change the verdict.

```bash
burnbrake brake show
burnbrake brake set --enabled true --amber-delay-ms 250 --red-delay-ms 1000
```

```bash
curl -s -H "x-burnbrake-key: $BURNBRAKE_OPERATOR_KEY" http://127.0.0.1:8787/v1/operator/brake
curl -s -X POST -H "content-type: application/json" -H "x-burnbrake-key: $BURNBRAKE_OPERATOR_KEY" \
  -d '{"amber_delay_ms":250}' http://127.0.0.1:8787/v1/operator/brake
```

A set applies on the **next** reserve. An in-flight `FORWARDED` call is not delayed, aborted, or rewritten. Env values are written into the ledger when the process starts (`BURNBRAKE_BRAKE_ENABLED`, `BURNBRAKE_BRAKE_AMBER_PCT`, `BURNBRAKE_BRAKE_RED_PCT`, `BURNBRAKE_BRAKE_AMBER_DELAY_MS`, `BURNBRAKE_BRAKE_RED_DELAY_MS`, `BURNBRAKE_BRAKE_BLACK_DELAY_MS`, `BURNBRAKE_BRAKE_MAX_DELAY_MS`).

Defaults: enabled false, amber 30%, red 10%, delays 0, `max_delay_ms` 15000. `amber_pct > red_pct > 0`, `amber_pct <= 100`, each delay `<= max_delay_ms`, `max_delay_ms <= 15000`. Keys `exhaust.retryable`, `exhaust.http`, and `halt_mode` are rejected.

When the curve is enabled, a 200 includes `X-BurnBrake-Zone`, `X-BurnBrake-Remaining-Micros`, `X-BurnBrake-Delay-Ms`, and `X-BurnBrake-Scope`. A 402 may add `zone` and `delay_ms` on the error object. The SDK does not sleep again on 402. Delay is sidecar-side only.

## Stuck reservations

TTL is 15 minutes from reserve time.

- Still `RESERVED` (never forwarded): released, hold returned.
- `FORWARDED` when the process dies or the TTL fires: **debited** at the estimate (`DEBIT_TTL_OR_CRASH`). Not released.

```bash
burnbrake reservations --state FORWARDED
burnbrake force-release --reservation <id> --reason "ticket 123, provider shows no charge" --attest-no-charge
```

Force-release without the attestation flag is refused. Misuse lets remaining lie high. The row is audited.

## Auth rotation

1. Set a new `BURNBRAKE_KEY` that starts with `bb_` for agents.
2. Set a different `BURNBRAKE_OPERATOR_KEY` (`bb_…`) if you use operator HTTP.
3. Restart the sidecar.
4. Update every agent on this deploy, and every operator client.

Do not put `OPENAI_API_KEY` in either BurnBrake key, and do not reuse the spend key as the operator key. Do not put `BURNBRAKE_OPERATOR_KEY` in the agent environment. The two HTTP keys rotate independently. Rotating them does not lock the SQLite file: the CLI has no key, and the file is the operator. It is created mode `0600`. `/health` does not echo secrets. Do not paste any key into a support ticket.

## Bind

Default `127.0.0.1`, including the Docker image. Binding any other address requires `BURNBRAKE_ALLOW_PUBLIC_BIND=1` and the key still has to be set. Treat a public bind without an ACL as a fund-drain risk. Compose sets `0.0.0.0` inside the container and publishes `127.0.0.1:8787` on the host. Compose reads `config.example.env`, not a copied `.env`. `docker run -p 8787:8787` is not that setup. The CLI does not load `.env` either; it uses the process environment.

## Daily check

- Deny rate and top runs (`burnbrake top-runs --window 24h`)
- Global pause is not stuck on
- Debt on user/run scopes
- After a deploy: base URL, BurnBrake header, no second ungated client
- Weekly: `priced_at` age, reservation terminal reasons, listen address on `/health`
