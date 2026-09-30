import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { EXHAUST_CONTRACT } from "../src/deploy.ts";
import { errorBody } from "../src/errors.ts";
import { bootSidecar, postChat } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");

describe("P0 deploy invariants", () => {
  it("health reports dual-client, frozen exhaust, and the hosted fence", async () => {
    const sidecar = await bootSidecar();
    try {
      const health = await fetch(`${sidecar.baseURL}/health`);
      const body = (await health.json()) as {
        deploy: {
          stops_all_spend: boolean;
          dual_client: { bypass_possible: boolean; detected_here: boolean; note: string };
          exhaust: { http_status: number; code: string; halt: boolean; retryable: boolean; frozen: boolean };
          scopes: { run_alone: boolean; durable: boolean; require: string; warning: string | null };
          hosted: { multi_tenant_runtime: boolean; this_process: string };
        };
      };
      assert.equal(health.status, 200);
      assert.equal(body.deploy.stops_all_spend, false);
      assert.equal(body.deploy.dual_client.bypass_possible, true);
      assert.equal(body.deploy.dual_client.detected_here, false);
      assert.match(body.deploy.dual_client.note, /second client/i);
      assert.deepEqual(body.deploy.exhaust, EXHAUST_CONTRACT);
      assert.equal(body.deploy.scopes.require, "user_or_day");
      assert.equal(body.deploy.scopes.run_alone, true);
      assert.equal(body.deploy.scopes.durable, false);
      assert.match(body.deploy.scopes.warning ?? "", /run-only/i);
      assert.equal(body.deploy.hosted.multi_tenant_runtime, false);
      assert.match(body.deploy.hosted.this_process, /single-tenant/i);
    } finally {
      await sidecar.close();
    }
  });

  it("refuses production start on run-alone and allows user or day", async () => {
    await assert.rejects(
      () => bootSidecar({ env: { BURNBRAKE_PRODUCTION: "1" }, caps: { user: null, run: 1_000_000, day: null } }),
      /user cap and\/or a day cap/i,
    );
    await assert.rejects(
      () => bootSidecar({ env: { NODE_ENV: "production" }, caps: { user: null, run: null, day: null } }),
      /user cap and\/or a day cap/i,
    );
    const byUser = await bootSidecar({
      env: { BURNBRAKE_PRODUCTION: "1" },
      caps: { user: 1_000_000, run: null, day: null },
    });
    const byDay = await bootSidecar({
      env: { NODE_ENV: "production" },
      caps: { user: null, run: 1_000_000, day: 5_000_000 },
    });
    try {
      const userHealth = await (await fetch(`${byUser.baseURL}/health`)).json();
      assert.equal(userHealth.deploy.scopes.production, true);
      assert.equal(userHealth.deploy.scopes.durable, true);
      assert.equal(userHealth.deploy.stops_all_spend, false);
      const dayHealth = await (await fetch(`${byDay.baseURL}/health`)).json();
      assert.equal(dayHealth.deploy.scopes.durable, true);
      assert.equal(dayHealth.deploy.scopes.run_alone, false);
    } finally {
      await byUser.close();
      await byDay.close();
    }
  });

  it("denies a later run-only reserve in production without forwarding", async () => {
    const sidecar = await bootSidecar({
      env: { BURNBRAKE_PRODUCTION: "1" },
      caps: { user: 1_000_000, run: 1_000_000, day: null },
    });
    try {
      sidecar.ledger.setDefaultCap("user", null);
      const denied = await postChat(sidecar, { idempotencyKey: "prod-run-only", runId: "run-prod" });
      assert.equal(denied.status, 503);
      assert.equal(denied.json.error.code, "PRODUCTION_SCOPE_REQUIRED");
      assert.equal(denied.json.error.halt, true);
      assert.equal(denied.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("keeps exhaust bytes frozen and refuses soft-halt flags", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 0, day: null } });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "exhaust-bytes", runId: "run-ex" });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
    const body = errorBody({
      code: "BUDGET_EXHAUSTED",
      httpStatus: 402,
      message: "Budget exhausted.",
    });
    assert.equal(body.error.halt, true);
    assert.equal(body.error.retryable, false);
    for (const [key, value] of [
      ["BURNBRAKE_SOFT_HALT", "1"],
      ["BURNBRAKE_RETRYABLE_EXHAUST", "true"],
      ["BURNBRAKE_HALT_MODE", "soft"],
      ["BURNBRAKE_EXHAUST_RETRYABLE", "1"],
      ["BURNBRAKE_EXHAUST_HTTP", "429"],
      ["BURNBRAKE_FAIL_OPEN", "1"],
    ] as const) {
      assert.throws(() => loadConfig({ BURNBRAKE_KEY: "bb_test_key", [key]: value }), /Refusing to start/i);
    }
    const hard = loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_HALT_MODE: "hard", BURNBRAKE_EXHAUST_HTTP: "402" });
    assert.equal(hard.failClosed, true);
  });

  it("buyer surfaces do not claim total spend control or an L2 send path", () => {
    const files = buyerFiles();
    const banned = [/stops all (agent )?spend/i, /stop all (agent )?spend/i, /eth_send/i, /all agent spend/i];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(text)) hits.push(`${file} matched ${pattern}`);
      }
    }
    assert.deepEqual(hits, []);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /stops_all_spend/);
    assert.doesNotMatch(readme, /checkout\.polar\.sh|polar\.sh\/checkout/i);
    const hosted = readFileSync(join(ROOT, "docs/HOSTED_VS_KIT.md"), "utf8");
    assert.match(hosted, /separate product/i);
    assert.match(hosted, /no multi-tenant|multi_tenant_runtime: false|no multi-tenant hosted/i);
    const status = readFileSync(join(ROOT, "docs/STATUS.md"), "utf8");
    assert.match(status, /merged without a 4th CR verdict/i);
  });
});

function buyerFiles(): string[] {
  const docs = [
    "README.md",
    "docs/START_HERE.md",
    "docs/OPERATOR.md",
    "docs/SUPPORT.md",
    "docs/MINIMUM_SUPPORT.md",
    "docs/DEPLOY_INVARIANTS.md",
    "docs/EXHAUST_CONTRACT.md",
    "docs/HOSTED_VS_KIT.md",
    "docs/STATUS.md",
  ].map((rel) => join(ROOT, rel));
  const src = walk(join(ROOT, "src")).filter((file) => file.endsWith(".ts"));
  return [...docs, ...src];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
