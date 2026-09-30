# Deploy invariants

HTTP request-path spend governor. Cap + kill on calls that reach this sidecar.

## Dual client

A process that calls the provider with its own base URL never enters BurnBrake. Checklist items in the README are not a code-enforced total. `GET /health` includes:

- `deploy.stops_all_spend: false`
- `deploy.dual_client.bypass_possible: true`
- `deploy.dual_client.detected_here: false`

Startup prints the same limit. A green health check does not prove that every agent uses the sidecar.

## Production scopes

Caller-chosen `x-burnbrake-run-id` and `x-burnbrake-user-id` are not OpenAI `user`.

| Mode | Rule |
| --- | --- |
| `NODE_ENV=production` or `BURNBRAKE_PRODUCTION=1` | Process refuses to start unless a user cap and/or a day cap is set. |
| Same, after those caps are removed | Next reserve is HTTP **503** `PRODUCTION_SCOPE_REQUIRED`. No forward. |
| Any other mode | Run-only still runs. Health `deploy.scopes.run_alone` and `scopes_warning` say so. |

A user cap without a day cap remains rotatable. Set a day cap when the fence has to survive header changes.

## Exhaust

See [EXHAUST_CONTRACT.md](./EXHAUST_CONTRACT.md). Those bytes are not a setting.

## Hosted SKU

See [HOSTED_VS_KIT.md](./HOSTED_VS_KIT.md). This process is the kit.
