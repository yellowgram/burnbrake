import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { brakeFromEnv, type BrakeConfig } from "./brake.js";
import { DEFAULT_HOST, DEFAULT_MAX_TOKENS, DEFAULT_PORT, RESERVATION_TTL_MS, STALE_PRICE_DAYS } from "./constants.js";
import { productionMode } from "./deploy.js";
import type { DefaultCaps } from "./ledger.js";
import { usdToMicros } from "./money.js";

export interface AppConfig {
  host: string;
  port: number;
  allowPublicBind: boolean;
  apiKey: string;
  /** Current spend key, then optional previous key accepted during rotation. */
  apiKeys: string[];
  /** Distinct from the spend key. Null disables operator HTTP (CLI on the ledger file remains). */
  operatorKey: string | null;
  /** Current operator key, then optional previous key. Empty when operator HTTP is off. */
  operatorKeys: string[];
  /** Advisory single-writer lease. Off unless BURNBRAKE_WRITER_LEASE=1. Not a multi-pod ledger. */
  writerLease: { holder: string; ttlMs: number } | null;
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
  /** NODE_ENV=production or BURNBRAKE_PRODUCTION=1. Requires a user and/or day cap. */
  production: boolean;
  failClosed: true;
}

export function defaultPriceTablePath(): string {
  return fileURLToPath(new URL("../prices/openai.yaml", import.meta.url));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: { requireKey?: boolean } = {}): AppConfig {
  const requireKey = options.requireKey !== false;
  assertExhaustFrozen(env);
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
  const previousKey = readOptionalKey(env.BURNBRAKE_KEY_PREVIOUS, "BURNBRAKE_KEY_PREVIOUS");
  const operatorKey = (env.BURNBRAKE_OPERATOR_KEY ?? "").trim();
  if (operatorKey && !operatorKey.startsWith("bb_")) {
    throw new Error("BURNBRAKE_OPERATOR_KEY must start with bb_. Never reuse the provider API key.");
  }
  if (operatorKey.startsWith("sk-")) {
    throw new Error("BURNBRAKE_OPERATOR_KEY must not be a provider API key.");
  }
  const previousOperatorKey = readOptionalKey(env.BURNBRAKE_OPERATOR_KEY_PREVIOUS, "BURNBRAKE_OPERATOR_KEY_PREVIOUS");
  if (operatorKey && apiKey && operatorKey === apiKey) {
    throw new Error(
      "BURNBRAKE_OPERATOR_KEY must be distinct from BURNBRAKE_KEY. The spend key cannot change caps, pause, or force-release.",
    );
  }
  if (openai && operatorKey && openai === operatorKey) {
    throw new Error("OPENAI_API_KEY and BURNBRAKE_OPERATOR_KEY must be different secrets.");
  }
  if (previousKey && !apiKey) {
    throw new Error("BURNBRAKE_KEY_PREVIOUS requires BURNBRAKE_KEY.");
  }
  if (previousOperatorKey && !operatorKey) {
    throw new Error("BURNBRAKE_OPERATOR_KEY_PREVIOUS requires BURNBRAKE_OPERATOR_KEY.");
  }
  if (previousKey && openai && previousKey === openai) {
    throw new Error("OPENAI_API_KEY and BURNBRAKE_KEY_PREVIOUS must be different secrets.");
  }
  if (previousOperatorKey && openai && previousOperatorKey === openai) {
    throw new Error("OPENAI_API_KEY and BURNBRAKE_OPERATOR_KEY_PREVIOUS must be different secrets.");
  }
  const spendKeys = uniqueKeys(apiKey, previousKey);
  const operatorKeys = uniqueKeys(operatorKey, previousOperatorKey);
  if (operatorKeys.some((key) => spendKeys.includes(key))) {
    throw new Error(
      "Operator keys must be distinct from BURNBRAKE_KEY and BURNBRAKE_KEY_PREVIOUS. The spend key cannot change caps, pause, or force-release.",
    );
  }
  const writerLease = readWriterLease(env);
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
    apiKeys: spendKeys,
    operatorKey: operatorKey || null,
    operatorKeys,
    writerLease,
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
    production: productionMode(env),
    failClosed: true,
  };
}

function assertExhaustFrozen(env: NodeJS.ProcessEnv): void {
  if (flagOn(env.BURNBRAKE_FAIL_OPEN) || flagOn(env.BURNBRAKE_SOFT_ALLOW) || flagOn(env.BURNBRAKE_SOFT_ALLOW_OVERAGE)) {
    throw new Error("Refusing to start: fail-open and soft-allow are not supported. BurnBrake fails closed.");
  }
  if (flagOn(env.BURNBRAKE_SOFT_HALT) || flagOn(env.BURNBRAKE_RETRYABLE_EXHAUST)) {
    throw new Error(
      "Refusing to start: exhaust is frozen as HTTP 402 BUDGET_EXHAUSTED with halt true and retryable false.",
    );
  }
  const haltMode = (env.BURNBRAKE_HALT_MODE ?? "").trim().toLowerCase();
  if (haltMode && haltMode !== "hard") {
    throw new Error("Refusing to start: rejected config key halt_mode. Exhaust stays a hard halt.");
  }
  const exhaustRetry = (env.BURNBRAKE_EXHAUST_RETRYABLE ?? "").trim().toLowerCase();
  if (exhaustRetry && !["0", "false", "no", "off"].includes(exhaustRetry)) {
    throw new Error("Refusing to start: rejected config key exhaust.retryable. Exhaust retryable is frozen false.");
  }
  const exhaustHttp = (env.BURNBRAKE_EXHAUST_HTTP ?? "").trim();
  if (exhaustHttp && exhaustHttp !== "402") {
    throw new Error("Refusing to start: rejected config key exhaust.http. Exhaust HTTP status is frozen at 402.");
  }
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

function readOptionalKey(value: string | undefined, label: string): string {
  const key = (value ?? "").trim();
  if (!key) return "";
  if (!key.startsWith("bb_")) {
    throw new Error(`${label} must start with bb_. Never reuse the provider API key.`);
  }
  if (key.startsWith("sk-")) {
    throw new Error(`${label} must not be a provider API key.`);
  }
  return key;
}

function uniqueKeys(current: string, previous: string): string[] {
  const keys = [current, previous].map((key) => key.trim()).filter((key) => key.length > 0);
  return [...new Set(keys)];
}

function readWriterLease(env: NodeJS.ProcessEnv): { holder: string; ttlMs: number } | null {
  if (!flagOn(env.BURNBRAKE_WRITER_LEASE)) return null;
  const ttlMs = parsePositiveInt(env.BURNBRAKE_WRITER_LEASE_TTL_MS, 30_000, "BURNBRAKE_WRITER_LEASE_TTL_MS");
  if (ttlMs < 5_000 || ttlMs > 120_000) {
    throw new Error("BURNBRAKE_WRITER_LEASE_TTL_MS must be between 5000 and 120000.");
  }
  const holder = (env.BURNBRAKE_WRITER_ID ?? "").trim() || randomUUID();
  return { holder, ttlMs };
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
