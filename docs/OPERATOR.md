# Operator runbook

Full see/do list: [OPERATOR_NEEDS.md](./OPERATOR_NEEDS.md). This page is the shipped control surface.

The CLI opens the SQLite ledger (`BURNBRAKE_LEDGER_PATH` or `--ledger`) and can run while the sidecar is up. Whoever can read that file can change caps. Protect the file.

HTTP routes under `/v1/operator/*` require `BURNBRAKE_OPERATOR_KEY`, a `bb_…` secret that is not `BURNBRAKE_KEY` and not the provider key. Send it as `X-BurnBrake-Key` or `Authorization: Bearer bb_…` on those routes only. The spend key is rejected (401). If the operator key is unset, operator HTTP returns 403 `OPERATOR_KEY_REQUIRED` and does not fall back to the spend key.

## Balances

```bash
burnbrake balances --user alice --run run-1
burnbrake balances --json
```

Each scope shows cap, spent, held (active reservations), remaining, debt (uncovered when spent + held exceeds the cap), and cumulative overshoot. Day keys are UTC dates from the ledger clock. `GET /health` and balances both show price-table `version`, `priced_at`, and a stale warning after 30 days. Stale still enforces.

If you only configured per-run, the CLI prints a warning: set a user and/or day cap.

## Decisions

```bash
burnbrake decisions --deny-only --run run-1
burnbrake export --run run-1 --format csv
```

Columns include requested micros, remaining, debt delta, model, route, idempotency key, `price_table_version`, and `upstream_forwarded`. A deny with `upstream_forwarded=1` is a bug. Prompts and completions are not logged.

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

Do not put `OPENAI_API_KEY` in either BurnBrake key, and do not reuse the spend key as the operator key. `/health` does not echo secrets. Do not paste any key into a support ticket.

## Bind

Default `127.0.0.1`. Binding any other address requires `BURNBRAKE_ALLOW_PUBLIC_BIND=1` and the key still has to be set. Treat a public bind without an ACL as a fund-drain risk. The compose file publishes `127.0.0.1:8787` only.

## Daily check

- Deny rate and top runs (`burnbrake top-runs --window 24h`)
- Global pause is not stuck on
- Debt on user/run scopes
- After a deploy: base URL, BurnBrake header, no second ungated client
- Weekly: `priced_at` age, reservation terminal reasons, listen address on `/health`
