import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig, defaultPriceTablePath } from "../src/config.ts";
import { bootSidecar, postChat } from "./helpers.ts";

const CHAT = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 16,
};

const SPOOF = {
  "x-burnbrake-zone": "green",
  "x-burnbrake-delay-ms": "0",
  "x-burnbrake-remaining-micros": "999999",
  "x-burnbrake-scope": "user",
};

describe("CR3 brake curve attacks", () => {
  it("fails closed when the ledger closes during an amber delay", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 50_000_000, day: null },
      env: {
        BURNBRAKE_BRAKE_ENABLED: "true",
        BURNBRAKE_BRAKE_AMBER_PCT: "100",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "400",
      },
      sleep: async () => {
        sidecar.ledger.close();
      },
    });
    try {
      const denied = await postChat(sidecar, { idempotencyKey: "ledger-dead", runId: "run-dead" });
      assert.equal(denied.status, 503);
      assert.equal(denied.json.error.code, "LEDGER_UNAVAILABLE");
      assert.equal(denied.json.error.halt, true);
      assert.equal(denied.json.error.retryable, false);
      assert.notEqual(denied.status, 429);
      assert.equal(denied.headers.get("retry-after"), null);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close().catch(() => {});
    }
  });

  it("turns an in-flight amber delay into pause when kill or global pause lands", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 50_000_000, day: null },
      env: {
        BURNBRAKE_BRAKE_ENABLED: "true",
        BURNBRAKE_BRAKE_AMBER_PCT: "100",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "200",
      },
      sleep: async () => {
        sidecar.ledger.pauseRun("run-kill", true);
        sidecar.ledger.pauseGlobal(true);
      },
    });
    try {
      const killed = await postChat(sidecar, {
        idempotencyKey: "kill-mid",
        runId: "run-kill",
        headers: SPOOF,
      });
      assert.equal(killed.status, 402);
      assert.notEqual(killed.status, 429);
      assert.equal(killed.headers.get("retry-after"), null);
      assert.equal(killed.headers.get("x-burnbrake-zone"), null);
      assert.equal(killed.json.error.code, "SPEND_PAUSED");
      assert.equal(killed.json.error.halt, true);
      assert.equal(killed.json.error.retryable, false);
      assert.equal(killed.json.error.zone, "black");
      assert.equal(sidecar.mock.forwardCount, 0);
      assert.equal(sidecar.ledger.listReservations({ runId: "run-kill" }).length, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("does not spend the next UTC day after a black delay decided on the previous day", async () => {
    let now = Date.parse("2026-09-26T23:59:50.000Z");
    const sidecar = await bootSidecar({
      now: () => now,
      caps: { user: null, run: null, day: 0 },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "300" },
      sleep: async () => {
        now = Date.parse("2026-09-27T00:00:05.000Z");
        sidecar.ledger.setDefaultCap("day", 50_000_000);
      },
    });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "day-black", runId: "run-day" });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.scope, "day");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.notEqual(deny.status, 429);
      assert.equal(sidecar.mock.forwardCount, 0);
      assert.equal(sidecar.ledger.listReservations().length, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("rechecks the UTC day at reserve and denies when the new day cannot cover", async () => {
    let now = Date.parse("2026-09-26T23:59:50.000Z");
    const sidecar = await bootSidecar({
      now: () => now,
      caps: { user: null, run: null, day: 50_000_000 },
      env: {
        BURNBRAKE_BRAKE_ENABLED: "true",
        BURNBRAKE_BRAKE_AMBER_PCT: "100",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "150",
      },
      sleep: async () => {
        now = Date.parse("2026-09-27T00:00:05.000Z");
        sidecar.ledger.setCap("day", "2026-09-27", 0);
      },
    });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "day-flip", runId: "run-flip" });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.scope, "day");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 0);
      const rows = sidecar.ledger.listReservations();
      assert.equal(rows.length, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("denies an unpriced model before any curve delay", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 50_000_000, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "5000" },
    });
    try {
      const started = Date.now();
      const deny = await postChat(sidecar, {
        idempotencyKey: "unpriced",
        runId: "run-unpriced",
        headers: SPOOF,
        body: { model: "not-a-real-model" },
      });
      assert.ok(Date.now() - started < 300);
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "UNPRICED_MODEL");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.json.error.zone, undefined);
      assert.equal(deny.headers.get("x-burnbrake-zone"), null);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.notEqual(deny.status, 429);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("still prices from a stale table while the curve is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-prices-"));
    const yaml = readFileSync(defaultPriceTablePath(), "utf8").replace(
      /priced_at: "[^"]+"/,
      'priced_at: "2020-01-01T00:00:00Z"',
    );
    const pricePath = join(dir, "prices.yaml");
    writeFileSync(pricePath, yaml);
    const sidecar = await bootSidecar({
      priceTablePath: pricePath,
      caps: { user: null, run: 50_000_000, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_AMBER_PCT: "100", BURNBRAKE_BRAKE_AMBER_DELAY_MS: "0" },
    });
    try {
      const health = await fetch(`${sidecar.baseURL}/health`);
      const body = (await health.json()) as { price_table: { stale: boolean }; fail_closed: boolean };
      assert.equal(health.status, 200);
      assert.equal(body.price_table.stale, true);
      assert.equal(body.fail_closed, true);
      const allow = await postChat(sidecar, { idempotencyKey: "stale-ok", runId: "run-stale" });
      assert.equal(allow.status, 200);
      assert.equal(allow.headers.get("x-burnbrake-zone"), "amber");
      assert.equal(sidecar.mock.forwardCount, 1);
      const deny = await postChat(sidecar, {
        idempotencyKey: "stale-no",
        runId: "run-stale",
        body: { model: "not-a-real-model" },
      });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "UNPRICED_MODEL");
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("ignores client zone headers and keeps a disabled brake identical to the pre-curve exhaust", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 0, day: null } });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "spoof-off", runId: "run-spoof", headers: SPOOF });
      assert.equal(deny.status, 402);
      assert.equal(deny.headers.get("x-burnbrake-zone"), null);
      assert.equal(deny.headers.get("x-burnbrake-delay-ms"), null);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(deny.text.includes("zone"), false);
      assert.equal(deny.text.includes("delay_ms"), false);
      assert.equal(deny.text.includes("Retry-After"), false);
      assert.deepEqual(Object.keys(deny.json.error), [
        "code",
        "message",
        "scope",
        "remaining_micros",
        "requested_micros",
        "run_id",
        "user_id",
        "halt",
        "retryable",
      ]);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("lets one idempotency key forward once when two callers share an amber delay", async () => {
    let waiting = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sidecar = await bootSidecar({
      caps: { user: null, run: 50_000_000, day: null },
      env: {
        BURNBRAKE_BRAKE_ENABLED: "true",
        BURNBRAKE_BRAKE_AMBER_PCT: "100",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "400",
      },
      sleep: () => {
        waiting += 1;
        if (waiting >= 2) release();
        return both;
      },
    });
    try {
      const [first, second] = await Promise.all([
        postChat(sidecar, { idempotencyKey: "same-amber", runId: "run-race", headers: SPOOF }),
        postChat(sidecar, { idempotencyKey: "same-amber", runId: "run-race", headers: SPOOF }),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409]);
      const winner = first.status === 200 ? first : second;
      assert.equal(winner.headers.get("x-burnbrake-zone"), "amber");
      assert.notEqual(winner.headers.get("x-burnbrake-zone"), "green");
      const loser = first.status === 409 ? first : second;
      assert.equal(loser.json.error.code, "REQUEST_IN_FLIGHT");
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("refuses public bind and soft-allow even when the brake env is set", () => {
    assert.throws(
      () =>
        loadConfig({
          BURNBRAKE_KEY: "bb_test_key",
          BURNBRAKE_HOST: "0.0.0.0",
          BURNBRAKE_BRAKE_ENABLED: "true",
          BURNBRAKE_BRAKE_AMBER_DELAY_MS: "1000",
        }),
      /Refusing to bind/,
    );
    assert.throws(
      () =>
        loadConfig({
          BURNBRAKE_KEY: "bb_test_key",
          BURNBRAKE_SOFT_ALLOW: "1",
          BURNBRAKE_BRAKE_ENABLED: "true",
        }),
      /soft-allow/,
    );
    assert.throws(
      () =>
        loadConfig({
          BURNBRAKE_KEY: "bb_test_key",
          BURNBRAKE_FAIL_OPEN: "1",
          BURNBRAKE_BRAKE_ENABLED: "true",
        }),
      /fail-open/,
    );
    assert.throws(
      () =>
        loadConfig({
          BURNBRAKE_KEY: "bb_test_key",
          BURNBRAKE_SOFT_ALLOW_OVERAGE: "1",
          BURNBRAKE_BRAKE_ENABLED: "true",
          allowance_micros: "1",
        } as NodeJS.ProcessEnv),
      /soft-allow/,
    );
  });
});
