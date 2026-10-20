# Exhaust contract

The budget-exhausted response never changes shape, and no setting can soften it:

| Field | Value |
| --- | --- |
| HTTP | **402** |
| `error.code` | `BUDGET_EXHAUSTED` |
| `error.halt` | `true` |
| `error.retryable` | `false` |

Not HTTP 429. No `Retry-After`. A brake-curve delay, when the curve is on, is a pause before this same body. It does not change the verdict.

Startup refuses:

- `BURNBRAKE_FAIL_OPEN`
- `BURNBRAKE_SOFT_ALLOW` and `BURNBRAKE_SOFT_ALLOW_OVERAGE`
- `BURNBRAKE_SOFT_HALT`
- `BURNBRAKE_RETRYABLE_EXHAUST`
- `BURNBRAKE_HALT_MODE` set to anything other than `hard`
- `BURNBRAKE_EXHAUST_RETRYABLE` set on
- `BURNBRAKE_EXHAUST_HTTP` set to anything other than `402`

There is no warn-only mode and no fail-open mode.

`GET /health` echoes `deploy.exhaust` with `frozen: true`.
