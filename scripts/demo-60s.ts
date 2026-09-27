import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESERVATION_TTL_MS } from "../src/constants.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { usdToMicros } from "../src/money.ts";
import { startSidecar } from "../src/server.ts";

const started = Date.now();
const key = "bb_demo_key";
const operatorKey = "bb_demo_operator";
const sidecar = await startSidecar({
  apiKey: key,
  operatorKey,
  host: "127.0.0.1",
  port: 0,
  mockUpstream: true,
  ledgerPath: join(mkdtempSync(join(tmpdir(), "burnbrake-demo-")), "ledger.sqlite"),
  caps: {
    user: usdToMicros("10"),
    run: usdToMicros("1"),
    day: usdToMicros("5"),
  },
  priceTablePath: defaultPriceTablePath(),
  reservationTtlMs: RESERVATION_TTL_MS,
  env: {
    BURNBRAKE_HOST: "127.0.0.1",
    BURNBRAKE_ALLOW_PUBLIC_BIND: "0",
    BURNBRAKE_FAIL_OPEN: "",
    BURNBRAKE_SOFT_ALLOW: "",
    BURNBRAKE_SOFT_ALLOW_OVERAGE: "",
    OPENAI_API_KEY: "",
  },
});

try {
  const healthResponse = await fetch(`${sidecar.baseURL}/health`);
  const health = await healthResponse.json();
  assertStep(healthResponse.status === 200, "health status");
  assertStep(health.listen === "127.0.0.1", "listen is 127.0.0.1");
  assertStep(health.auth?.required === true, "auth.required");
  assertStep(health.fail_closed === true, "fail_closed");
  assertStep(health.ledger?.writable === true, "ledger.writable");
  assertStep(health.operator_http === true, "operator_http");
  console.log(`0–10s  GET /health  listen=${health.listen} auth.required=${health.auth.required} operator_http=${health.operator_http} fail_closed=${health.fail_closed} ledger.writable=${health.ledger.writable} price=${health.price_table.version}`);

  const headers = {
    "content-type": "application/json",
    "x-burnbrake-key": key,
    "x-burnbrake-user-id": "demo-user",
    "x-burnbrake-run-id": "demo-run",
  };
  const allow = await fetch(`${sidecar.baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "demo-allow" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say ok." }],
      max_tokens: 16,
    }),
  });
  const allowBody = await allow.json();
  assertStep(allow.status === 200, `under-budget status ${allow.status}`);
  assertStep(sidecar.mock.forwardCount === 1, "mock upstream incremented");
  console.log(`10–25s allow  HTTP ${allow.status}  mock_forward_count=${sidecar.mock.forwardCount}  completion=${allowBody.choices?.[0]?.message?.content}`);

  const balanceResponse = await fetch(`${sidecar.baseURL}/v1/operator/balances?user_id=demo-user&run_id=demo-run`, {
    headers: { "x-burnbrake-key": operatorKey },
  });
  const balances = await balanceResponse.json();
  const run = balances.scopes.find((scope: { scope: string }) => scope.scope === "run");
  assertStep(run && run.spent_micros > 0, "reserve settled onto the run scope");
  console.log(
    `        balances  run spent=${run.spent_micros} remaining=${run.remaining_micros} debt=${run.debt_micros} overshoot=${run.overshoot_micros}`,
  );

  const spendKeyCaps = await fetch(`${sidecar.baseURL}/v1/operator/caps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-burnbrake-key": key },
    body: JSON.stringify({ scope: "run", key: "demo-run", cap_micros: run.cap_micros + 1_000_000 }),
  });
  const spendKeyBody = await spendKeyCaps.json();
  assertStep(spendKeyCaps.status === 401, "spend key cannot change caps");
  assertStep(spendKeyBody.error?.code === "AUTH_REQUIRED", "spend key operator status");
  console.log(`        operator  spend key on /v1/operator/caps → HTTP ${spendKeyCaps.status} ${spendKeyBody.error?.code}`);

  const lowered = await fetch(`${sidecar.baseURL}/v1/operator/caps`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-burnbrake-key": operatorKey },
    body: JSON.stringify({ scope: "run", key: "demo-run", cap_micros: run.spent_micros }),
  });
  assertStep(lowered.status === 200, "lower run cap");

  const forwardsBeforeDeny = sidecar.mock.forwardCount;
  const deny = await fetch(`${sidecar.baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: { ...headers, "idempotency-key": "demo-deny" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "This one must not reach the provider." }],
      max_tokens: 16,
    }),
  });
  const denyBody = await deny.json();
  assertStep(deny.status === 402, `over-budget status ${deny.status}`);
  assertStep(deny.status !== 429, "budget exhaust is not 429");
  assertStep(denyBody.error?.code === "BUDGET_EXHAUSTED", `code ${denyBody.error?.code}`);
  assertStep(denyBody.error?.halt === true && denyBody.error?.retryable === false, "halt, non-retryable");
  assertStep(sidecar.mock.forwardCount === forwardsBeforeDeny, "mock upstream count unchanged");
  console.log(
    `25–45s reject HTTP ${deny.status} code=${denyBody.error.code} scope=${denyBody.error.scope} remaining=${denyBody.error.remaining_micros} requested=${denyBody.error.requested_micros} mock_forward_count=${sidecar.mock.forwardCount}`,
  );

  const decisionResponse = await fetch(
    `${sidecar.baseURL}/v1/operator/decisions?deny_only=1&run_id=demo-run`,
    { headers: { "x-burnbrake-key": operatorKey } },
  );
  const decisions = await decisionResponse.json();
  const denied = decisions.decisions.find((row: { code: string }) => row.code === "BUDGET_EXHAUSTED");
  assertStep(denied && denied.upstream_forwarded === 0, "decision upstream_forwarded=false");
  console.log(`45–60s decision upstream_forwarded=${denied.upstream_forwarded} terminal=${denied.terminal_reason ?? "n/a"}`);
  console.log("Honesty: one already-forwarded call may still overshoot. Debt gates the next call. This reject did not call upstream.");

  const elapsed = Date.now() - started;
  assertStep(elapsed < 60_000, `elapsed ${elapsed}ms`);
  console.log(`demo ok in ${elapsed}ms`);
} finally {
  await sidecar.close();
}

function assertStep(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`demo failed: ${label}`);
    process.exitCode = 1;
    throw new Error(label);
  }
}
