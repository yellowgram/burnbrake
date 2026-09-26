import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESERVATION_TTL_MS } from "../src/constants.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { startSidecar, type RunningSidecar, type StartOptions } from "../src/server.ts";
import type { DefaultCaps } from "../src/ledger.ts";

export function tempLedgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "burnbrake-")), "ledger.sqlite");
}

export async function bootSidecar(overrides: StartOptions & { caps?: DefaultCaps } = {}): Promise<RunningSidecar> {
  const { caps: capOverride, env: envOverride, ...rest } = overrides;
  const caps = capOverride ?? { user: null, run: 1_000_000, day: null };
  return startSidecar({
    apiKey: "bb_test_key",
    operatorKey: "bb_test_operator",
    host: "127.0.0.1",
    port: 0,
    allowPublicBind: false,
    mockUpstream: true,
    ledgerPath: tempLedgerPath(),
    priceTablePath: defaultPriceTablePath(),
    reservationTtlMs: RESERVATION_TTL_MS,
    env: {
      BURNBRAKE_FAIL_OPEN: "",
      BURNBRAKE_SOFT_ALLOW: "",
      BURNBRAKE_SOFT_ALLOW_OVERAGE: "",
      BURNBRAKE_HOST: "127.0.0.1",
      BURNBRAKE_ALLOW_PUBLIC_BIND: "0",
      OPENAI_API_KEY: "",
      ...(envOverride ?? {}),
    },
    ...rest,
    caps,
  });
}

export async function postChat(
  sidecar: RunningSidecar,
  init: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    key?: string | null;
    runId?: string | null;
    userId?: string | null;
    idempotencyKey?: string | null;
  } = {},
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers ?? {}),
  };
  if (init.key !== null) headers["x-burnbrake-key"] = init.key ?? "bb_test_key";
  if (init.runId !== null) headers["x-burnbrake-run-id"] = init.runId ?? "run-1";
  if (init.userId) headers["x-burnbrake-user-id"] = init.userId;
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  const response = await fetch(`${sidecar.baseURL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 16,
      ...(init.body ?? {}),
    }),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}
