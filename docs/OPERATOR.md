# Operator runbook

Full see/do list: [OPERATOR_NEEDS.md](./OPERATOR_NEEDS.md). This page is the shipped control surface.

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

There is no switch to allow spend past a cap, and no switch to forward when the ledger is down.

## Brake curve

Shipped. `burnbrake brake show|set` and `GET`/`POST /v1/operator/brake` (operator key only; the spend key is 401). See [DESIGN_BRAKE_CURVE.md](./DESIGN_BRAKE_CURVE.md) (**BB_BRAKE_CURVE_1**).

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
