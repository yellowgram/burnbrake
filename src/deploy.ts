import type { DefaultCaps } from "./ledger.js";

/** Frozen exhaust bytes. Do not add a soft halt or a retryable exhaust. */
export const EXHAUST_CONTRACT = {
  http_status: 402,
  code: "BUDGET_EXHAUSTED",
  halt: true,
  retryable: false,
  frozen: true,
} as const;

export const DUAL_CLIENT_NOTE =
  "BurnBrake governs only HTTP calls that reach this sidecar. A second client with a direct provider URL bypasses every cap. This process cannot see that client and does not prove every agent call is gated.";

export const HOSTED_FENCE_NOTE =
  "This process is the single-tenant self-host kit (one SQLite ledger). The hosted monthly SKU is a separate product and is not this runtime.";

export function productionMode(env: NodeJS.ProcessEnv): boolean {
  if (flagOn(env.BURNBRAKE_PRODUCTION)) return true;
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/** User and/or day. Run-alone is not a production fence. */
export function durableScopes(caps: Pick<DefaultCaps, "user" | "day">): boolean {
  return caps.user != null || caps.day != null;
}

export function assertProductionScopes(caps: Pick<DefaultCaps, "user" | "day">, env: NodeJS.ProcessEnv): void {
  if (!productionMode(env)) return;
  if (durableScopes(caps)) return;
  throw new Error(
    "Production requires a user cap and/or a day cap (BURNBRAKE_CAP_USER_USD or BURNBRAKE_CAP_DAY_USD, or _MICROS). A run-only budget is washable by rotating x-burnbrake-run-id. Run-alone is refused.",
  );
}

function flagOn(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
