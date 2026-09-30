/** BB_BRAKE_CURVE_1. Curve only. Exhaust bytes stay 402 / halt / not retryable. */

export const ABSOLUTE_MAX_DELAY_MS = 15_000;

export const BRAKE_DEFAULTS: BrakeConfig = {
  enabled: false,
  amber_pct: 30,
  red_pct: 10,
  amber_delay_ms: 0,
  red_delay_ms: 0,
  black_delay_ms: 0,
  max_delay_ms: ABSOLUTE_MAX_DELAY_MS,
};

export interface BrakeConfig {
  enabled: boolean;
  amber_pct: number;
  red_pct: number;
  amber_delay_ms: number;
  red_delay_ms: number;
  black_delay_ms: number;
  max_delay_ms: number;
}

export type BrakeScopeName = "user" | "run" | "day";
export type OpenZone = "green" | "amber" | "red";

export interface OpenScope {
  scope: BrakeScopeName;
  cap_micros: number;
  /** cap − spent − held. Debt is already subtracted: a negative value is uncovered spend. */
  remaining_micros: number;
}

export class BrakeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrakeConfigError";
  }
}

const BRAKE_KEYS = [
  "enabled",
  "amber_pct",
  "red_pct",
  "amber_delay_ms",
  "red_delay_ms",
  "black_delay_ms",
  "max_delay_ms",
] as const;

/** Sidecar-side wait. Callers must not hold the ledger write lock across this. */
export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function brakeFromEnv(env: NodeJS.ProcessEnv): BrakeConfig {
  assertNoForbiddenBrakeEnv(env);
  return validateBrakeConfig({
    enabled: readEnabled(env.BURNBRAKE_BRAKE_ENABLED),
    amber_pct: readNumber(env.BURNBRAKE_BRAKE_AMBER_PCT, BRAKE_DEFAULTS.amber_pct, "BURNBRAKE_BRAKE_AMBER_PCT", false),
    red_pct: readNumber(env.BURNBRAKE_BRAKE_RED_PCT, BRAKE_DEFAULTS.red_pct, "BURNBRAKE_BRAKE_RED_PCT", false),
    amber_delay_ms: readNumber(env.BURNBRAKE_BRAKE_AMBER_DELAY_MS, BRAKE_DEFAULTS.amber_delay_ms, "BURNBRAKE_BRAKE_AMBER_DELAY_MS", true),
    red_delay_ms: readNumber(env.BURNBRAKE_BRAKE_RED_DELAY_MS, BRAKE_DEFAULTS.red_delay_ms, "BURNBRAKE_BRAKE_RED_DELAY_MS", true),
    black_delay_ms: readNumber(env.BURNBRAKE_BRAKE_BLACK_DELAY_MS, BRAKE_DEFAULTS.black_delay_ms, "BURNBRAKE_BRAKE_BLACK_DELAY_MS", true),
    max_delay_ms: readNumber(env.BURNBRAKE_BRAKE_MAX_DELAY_MS, BRAKE_DEFAULTS.max_delay_ms, "BURNBRAKE_BRAKE_MAX_DELAY_MS", true),
  });
}

/**
 * Full config check. Rejects halt-off keys. `enabled` is not a halt switch:
 * black still ends in the existing 402 deny.
 */
export function validateBrakeConfig(input: unknown): BrakeConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BrakeConfigError("brake config must be an object");
  }
  const raw = input as Record<string, unknown>;
  assertNoForbiddenBrakeKeys(raw);
  for (const key of Object.keys(raw)) {
    if (!BRAKE_KEYS.includes(key as (typeof BRAKE_KEYS)[number])) {
      throw new BrakeConfigError(`unknown brake key ${key}`);
    }
  }
  const enabled = requireBoolean(raw.enabled, "enabled");
  const amber_pct = requireFinite(raw.amber_pct, "amber_pct");
  const red_pct = requireFinite(raw.red_pct, "red_pct");
  const amber_delay_ms = requireInteger(raw.amber_delay_ms, "amber_delay_ms");
  const red_delay_ms = requireInteger(raw.red_delay_ms, "red_delay_ms");
  const black_delay_ms = requireInteger(raw.black_delay_ms, "black_delay_ms");
  const max_delay_ms = requireInteger(raw.max_delay_ms, "max_delay_ms");
  if (!(red_pct > 0)) throw new BrakeConfigError("red_pct must be > 0");
  if (!(amber_pct > red_pct)) throw new BrakeConfigError("amber_pct must be > red_pct");
  if (amber_pct > 100) throw new BrakeConfigError("amber_pct must be <= 100");
  if (max_delay_ms < 0) throw new BrakeConfigError("max_delay_ms must be >= 0");
  if (max_delay_ms > ABSOLUTE_MAX_DELAY_MS) throw new BrakeConfigError("max_delay_ms must be <= 15000");
  for (const [label, delay] of [
    ["amber_delay_ms", amber_delay_ms],
    ["red_delay_ms", red_delay_ms],
    ["black_delay_ms", black_delay_ms],
  ] as const) {
    if (delay < 0) throw new BrakeConfigError(`${label} must be >= 0`);
    if (delay > max_delay_ms) throw new BrakeConfigError(`${label} must be <= max_delay_ms`);
  }
  return { enabled, amber_pct, red_pct, amber_delay_ms, red_delay_ms, black_delay_ms, max_delay_ms };
}

/** Merge a partial operator/CLI patch onto the current config and re-validate. */
export function mergeBrakeConfig(current: BrakeConfig, patch: unknown): BrakeConfig {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new BrakeConfigError("brake config must be an object");
  }
  const raw = patch as Record<string, unknown>;
  assertNoForbiddenBrakeKeys(raw);
  if (Object.keys(raw).length === 0) throw new BrakeConfigError("no brake fields to set");
  return validateBrakeConfig({ ...current, ...raw });
}

export function assertNoForbiddenBrakeKeys(value: unknown, path = ""): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const full = path ? `${path}.${key}` : key;
    const forbidden = forbiddenKey(full, key, path);
    if (forbidden) throw new BrakeConfigError(`rejected config key ${forbidden}`);
    assertNoForbiddenBrakeKeys(child, full);
  }
}

/**
 * Zone for a reserve that still covers. Caller picks the tightest scope
 * (lowest remaining_pct; ties keep user → run → day order).
 * Green is `remaining_pct > amber_pct`. Amber is `red_pct < remaining_pct <= amber_pct`.
 * Red is the rest, including a covering 0%. Black is not decided here.
 */
export function classifyOpenZone(
  scopes: OpenScope[],
  brake: BrakeConfig,
): { zone: OpenZone; scope: BrakeScopeName; remaining_micros: number; delay_ms: number } {
  if (scopes.length === 0) throw new BrakeConfigError("curve does not apply without caps");
  let best = scopes[0]!;
  let bestPct = remainingPct(best);
  for (const scope of scopes.slice(1)) {
    const pct = remainingPct(scope);
    if (pct < bestPct) {
      best = scope;
      bestPct = pct;
    }
  }
  if (bestPct > brake.amber_pct) {
    return { zone: "green", scope: best.scope, remaining_micros: best.remaining_micros, delay_ms: 0 };
  }
  if (bestPct > brake.red_pct) {
    return {
      zone: "amber",
      scope: best.scope,
      remaining_micros: best.remaining_micros,
      delay_ms: brake.amber_delay_ms,
    };
  }
  return { zone: "red", scope: best.scope, remaining_micros: best.remaining_micros, delay_ms: brake.red_delay_ms };
}

/** Debt is already inside `remaining_micros` (cap − spent − held). */
export function remainingPct(scope: OpenScope): number {
  if (scope.cap_micros <= 0) return scope.remaining_micros > 0 ? Number.POSITIVE_INFINITY : 0;
  return (scope.remaining_micros / scope.cap_micros) * 100;
}

function forbiddenKey(full: string, key: string, path: string): string | null {
  if (key === "halt_mode" || full === "halt_mode") return "halt_mode";
  const exhaustPath = path === "exhaust" || path.endsWith(".exhaust");
  if (key === "exhaust.retryable" || full === "exhaust.retryable" || (exhaustPath && key === "retryable")) {
    return "exhaust.retryable";
  }
  if (key === "exhaust.http" || full === "exhaust.http" || (exhaustPath && key === "http")) {
    return "exhaust.http";
  }
  return null;
}

function assertNoForbiddenBrakeEnv(env: NodeJS.ProcessEnv): void {
  const halt = (env.BURNBRAKE_HALT_MODE ?? "").trim().toLowerCase();
  if (halt && halt !== "hard") {
    throw new BrakeConfigError("rejected config key halt_mode");
  }
  const retry = (env.BURNBRAKE_EXHAUST_RETRYABLE ?? "").trim().toLowerCase();
  if (retry && !["0", "false", "no", "off"].includes(retry)) {
    throw new BrakeConfigError("rejected config key exhaust.retryable");
  }
  const http = (env.BURNBRAKE_EXHAUST_HTTP ?? "").trim();
  if (http && http !== "402") {
    throw new BrakeConfigError("rejected config key exhaust.http");
  }
}

function nonEmpty(value: string | undefined): boolean {
  return value != null && value.trim() !== "";
}

function readEnabled(value: string | undefined): boolean {
  if (!nonEmpty(value)) return BRAKE_DEFAULTS.enabled;
  const normalized = value!.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new BrakeConfigError("BURNBRAKE_BRAKE_ENABLED must be true or false");
}

function readNumber(value: string | undefined, fallback: number, label: string, integer: boolean): number {
  if (!nonEmpty(value)) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n))) {
    throw new BrakeConfigError(`${label} must be ${integer ? "an integer" : "a finite number"}`);
  }
  return n;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new BrakeConfigError(`${label} must be a boolean`);
  return value;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BrakeConfigError(`${label} must be a finite number`);
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new BrakeConfigError(`${label} must be an integer number of milliseconds`);
  }
  return value;
}
