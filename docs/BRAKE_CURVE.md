# Brake curve

Optional, off by default. The brake curve slows an agent down as it gets close to a cap, so a runaway loop burns money more slowly before it hits the wall. At the cap the answer is still the same hard stop: HTTP 402 `BUDGET_EXHAUSTED`, `halt: true`, `retryable: false`.

## Zones

BurnBrake looks at the first configured scope that would run out first (user, then run, then day) and computes

```text
remaining_pct = remaining_micros / cap_micros * 100     (debt is subtracted first)
```

| Zone | When | What happens |
| --- | --- | --- |
| green | `remaining_pct > amber_pct` | Forward as normal. |
| amber | `red_pct < remaining_pct ≤ amber_pct` | Wait `amber_delay_ms`, then reserve and forward. |
| red | `0 < remaining_pct ≤ red_pct` and the reserve still fits | Wait `red_delay_ms`, then reserve and forward if it still fits. |
| black | the reserve cannot cover the estimate, or spend is paused | Wait `black_delay_ms`, then 402. The wait never changes the answer. |

With no caps at all the curve does not apply; the request gets 503 `NO_BUDGET_CONFIGURED`.

## Settings

| Env | Default | Notes |
| --- | --- | --- |
| `BURNBRAKE_BRAKE_ENABLED` | `false` | Turning it off removes the delays and headers. It never turns the cap off. |
| `BURNBRAKE_BRAKE_AMBER_PCT` | `30` | Must be greater than `red_pct` and at most 100. |
| `BURNBRAKE_BRAKE_RED_PCT` | `10` | Must be greater than 0. |
| `BURNBRAKE_BRAKE_AMBER_DELAY_MS` | `0` | |
| `BURNBRAKE_BRAKE_RED_DELAY_MS` | `0` | |
| `BURNBRAKE_BRAKE_BLACK_DELAY_MS` | `0` | A long value can make clients time out before they see the 402. |
| `BURNBRAKE_BRAKE_MAX_DELAY_MS` | `15000` | Upper bound for every delay; at most 15000. |

Change them live with `burnbrake brake set …` or `POST /v1/operator/brake` (operator key). A change applies from the next reserve. A call that is already forwarded is never delayed, cut off or rewritten.

## What the agent sees

On a 200 while the curve is on: `X-BurnBrake-Zone` (`green|amber|red`), `X-BurnBrake-Remaining-Micros`, `X-BurnBrake-Delay-Ms`, `X-BurnBrake-Scope` (`user|run|day`).

On the 402: the usual body, plus `zone: "black"` and `delay_ms` (how long the sidecar waited). There is never a `Retry-After` header and never a 429. The SDK does not sleep again on a 402; the wait already happened in the sidecar.
