import { fileURLToPath } from "node:url";
import { brakeFromEnv, type BrakeConfig } from "./brake.js";
import { DEFAULT_HOST, DEFAULT_MAX_TOKENS, DEFAULT_PORT, RESERVATION_TTL_MS, STALE_PRICE_DAYS } from "./constants.js";
import type { DefaultCaps } from "./ledger.js";
import { usdToMicros } from "./money.js";

export interface AppConfig {
  host: string;
  port: number;
  allowPublicBind: boolean;
  apiKey: string;
  /** Distinct from the spend key. Null disables operator HTTP (CLI on the ledger file remains). */
  operatorKey: string | null;
  ledgerPath: string;
  priceTablePath: string;
  upstreamBaseURL: string;
  openaiApiKey: string | null;
  mockUpstream: boolean;
  defaultMaxTokens: number;
  reservationTtlMs: number;
  staleWarnDays: number;
  caps: DefaultCaps;
  /** Curve only. `enabled: false` keeps the pre-curve halt path. Not a halt-off switch. */
  brake: BrakeConfig;
  failClosed: true;
}

export function defaultPriceTablePath(): string {
  return fileURLToPath(new URL("../prices/openai.yaml", import.meta.url));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: { requireKey?: boolean } = {}): AppConfig {
  const requireKey = options.requireKey !== false;
  if (flagOn(env.BURNBRAKE_FAIL_OPEN) || flagOn(env.BURNBRAKE_SOFT_ALLOW) || flagOn(env.BURNBRAKE_SOFT_ALLOW_OVERAGE)) {
    throw new Error("Refusing to start: fail-open and soft-allow are not supported. BurnBrake fails closed.");
  }
  const host = (env.BURNBRAKE_HOST ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
  const allowPublicBind = flagOn(env.BURNBRAKE_ALLOW_PUBLIC_BIND);
  assertBind(host, allowPublicBind);
  const apiKey = (env.BURNBRAKE_KEY ?? "").trim();
  if (requireKey && !apiKey) {
    throw new Error("BURNBRAKE_KEY is required. Auth cannot be disabled.");
  }
  if (apiKey && !apiKey.startsWith("bb_")) {
    throw new Error("BURNBRAKE_KEY must start with bb_. Never reuse the provider API key.");
  }
  if (apiKey.startsWith("sk-")) {
    throw new Error("BURNBRAKE_KEY must not be a provider API key.");
  }
  const openai = (env.OPENAI_API_KEY ?? "").trim();
  if (openai && openai === apiKey) {
    throw new Error("OPENAI_API_KEY and BURNBRAKE_KEY must be different secrets.");
  }
  const operatorKey = (env.BURNBRAKE_OPERATOR_KEY ?? "").trim();
  if (operatorKey && !operatorKey.startsWith("bb_")) {
    throw new Error("BURNBRAKE_OPERATOR_KEY must start with bb_. Never reuse the provider API key.");
  }
  if (operatorKey.startsWith("sk-")) {
    throw new Error("BURNBRAKE_OPERATOR_KEY must not be a provider API key.");
  }
  if (operatorKey && apiKey && operatorKey === apiKey) {
    throw new Error(
      "BURNBRAKE_OPERATOR_KEY must be distinct from BURNBRAKE_KEY. The spend key cannot change caps, pause, or force-release.",
    );
  }
  if (openai && operatorKey && openai === operatorKey) {
    throw new Error("OPENAI_API_KEY and BURNBRAKE_OPERATOR_KEY must be different secrets.");
  }
  const port = parsePort(env.BURNBRAKE_PORT ?? String(DEFAULT_PORT));
  const defaultMaxTokens = parsePositiveInt(env.BURNBRAKE_DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS, "BURNBRAKE_DEFAULT_MAX_TOKENS");
  const reservationTtlMs = parsePositiveInt(
    env.BURNBRAKE_RESERVATION_TTL_MS,
    RESERVATION_TTL_MS,
    "BURNBRAKE_RESERVATION_TTL_MS",
  );
  return {
    host,
    port,
    allowPublicBind,
    apiKey,
    operatorKey: operatorKey || null,
    ledgerPath: env.BURNBRAKE_LEDGER_PATH ?? "data/burnbrake.sqlite",
    priceTablePath: env.BURNBRAKE_PRICE_TABLE ?? defaultPriceTablePath(),
    upstreamBaseURL: (env.BURNBRAKE_UPSTREAM_BASE_URL ?? "https://api.openai.com").replace(/\/$/, ""),
    openaiApiKey: openai || null,
    mockUpstream: flagOn(env.BURNBRAKE_MOCK_UPSTREAM),
    defaultMaxTokens,
    reservationTtlMs,
    staleWarnDays: STALE_PRICE_DAYS,
    caps: {
      user: readCap(env, "USER"),
      run: readCap(env, "RUN"),
      day: readCap(env, "DAY"),
    },
    brake: brakeFromEnv(env),
    failClosed: true,
  };
}

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (value === "localhost" || value === "::1" || value === "[::1]") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
  return false;
}

export function assertBind(host: string, allowPublicBind: boolean): void {
  if (isLoopbackHost(host)) return;
  if (!allowPublicBind) {
    throw new Error(
      `Refusing to bind ${host}. Default listen is 127.0.0.1. Set BURNBRAKE_ALLOW_PUBLIC_BIND=1 to bind elsewhere, and keep auth on. Public bind without an ACL is a fund-drain risk.`,
    );
  }
}

export function flagOn(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid BURNBRAKE_PORT: ${value}`);
  }
  return port;
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

function readCap(env: NodeJS.ProcessEnv, scope: "USER" | "RUN" | "DAY"): number | null {
  const micros = env[`BURNBRAKE_CAP_${scope}_MICROS`];
  const usd = env[`BURNBRAKE_CAP_${scope}_USD`];
  if (micros != null && micros.trim() !== "" && usd != null && usd.trim() !== "") {
    throw new Error(`Set only one of BURNBRAKE_CAP_${scope}_MICROS or BURNBRAKE_CAP_${scope}_USD.`);
  }
  if (micros != null && micros.trim() !== "") {
    const n = Number(micros);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid BURNBRAKE_CAP_${scope}_MICROS`);
    return n;
  }
  if (usd != null && usd.trim() !== "") return usdToMicros(usd);
  return null;
}
