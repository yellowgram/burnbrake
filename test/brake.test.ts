import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRAKE_DEFAULTS,
  BrakeConfigError,
  classifyOpenZone,
  mergeBrakeConfig,
  validateBrakeConfig,
  type BrakeConfig,
} from "../src/brake.ts";
import { loadConfig } from "../src/config.ts";
import { estimateRequest } from "../src/estimate.ts";
import { execute } from "../src/cli.ts";
import { Ledger, type ReserveInput } from "../src/ledger.ts";
import { loadPriceTable } from "../src/prices.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { bootSidecar, postChat, tempLedgerPath } from "./helpers.ts";

const CHAT = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 16,
};

function chatMicros(): number {
  const estimated = estimateRequest(CHAT, loadPriceTable(defaultPriceTablePath()), 4096, "/v1/chat/completions");
  if (!estimated.ok) throw new Error(estimated.message);
  return estimated.micros;
}

function reserveInput(partial: Partial<ReserveInput> & Pick<ReserveInput, "estimateMicros" | "runId">): ReserveInput {
  return {
    userId: null,
    idempotencyKey: null,
    model: "gpt-4o-mini",
    route: "/v1/chat/completions",
    maxTokens: 16,
    maxTokensSource: "request",
    priceTableVersion: "test",
    ...partial,
  };
}

function enabled(partial: Partial<BrakeConfig> = {}): BrakeConfig {
  return validateBrakeConfig({ ...BRAKE_DEFAULTS, enabled: true, ...partial });
}

describe("brake config", () => {
  it("defaults to enabled false and black_delay_ms 0", () => {
    const config = loadConfig({ BURNBRAKE_KEY: "bb_test_key" });
    assert.deepEqual(config.brake, BRAKE_DEFAULTS);
    assert.equal(config.brake.enabled, false);
    assert.equal(config.brake.black_delay_ms, 0);
    assert.equal(config.brake.max_delay_ms, 15_000);
  });

  it("rejects inverted zones, delays above the ceiling, and halt-off keys", () => {
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, amber_pct: 10, red_pct: 30 }), /amber_pct must be > red_pct/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, red_pct: 0 }), /red_pct must be > 0/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, amber_pct: 101, red_pct: 10 }), /amber_pct must be <= 100/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, amber_delay_ms: -1 }), /amber_delay_ms must be >= 0/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, max_delay_ms: 15_001 }), /max_delay_ms must be <= 15000/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, max_delay_ms: 100, red_delay_ms: 101 }), /red_delay_ms must be <= max_delay_ms/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, halt_mode: "off" }), /rejected config key halt_mode/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, "exhaust.retryable": true }), /rejected config key exhaust.retryable/);
    assert.throws(() => validateBrakeConfig({ ...BRAKE_DEFAULTS, exhaust: { http: 429 } }), /rejected config key exhaust.http/);
    assert.throws(() => mergeBrakeConfig(BRAKE_DEFAULTS, { allowance_micros: 1 }), /unknown brake key/);
    const current = enabled();
    assert.throws(() => mergeBrakeConfig(current, { enabled: true, halt_mode: "soft" }), BrakeConfigError);
    assert.equal(current.enabled, true);

    assert.throws(() => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_HALT_MODE: "off" }), /halt_mode/);
    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_EXHAUST_RETRYABLE: "true" }),
      /exhaust.retryable/,
    );
    assert.throws(() => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_EXHAUST_HTTP: "429" }), /exhaust.http/);
    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_BRAKE_MAX_DELAY_MS: "15001" }),
      /max_delay_ms/,
    );
  });

  it("classifies the tightest scope and keeps user → run → day on a tie", () => {
    const amber = classifyOpenZone(
      [
        { scope: "user", cap_micros: 1000, remaining_micros: 500 },
        { scope: "run", cap_micros: 1000, remaining_micros: 80 },
      ],
      enabled(),
    );
    assert.equal(amber.zone, "red");
    assert.equal(amber.scope, "run");
    assert.equal(amber.remaining_micros, 80);
    assert.equal(amber.delay_ms, 0);

    const tied = classifyOpenZone(
      [
        { scope: "user", cap_micros: 1000, remaining_micros: 200 },
        { scope: "run", cap_micros: 1000, remaining_micros: 200 },
      ],
      enabled({ amber_delay_ms: 25 }),
    );
    assert.equal(tied.zone, "amber");
    assert.equal(tied.scope, "user");
    assert.equal(tied.delay_ms, 25);

    const green = classifyOpenZone([{ scope: "day", cap_micros: 100, remaining_micros: 31 }], enabled());
    assert.equal(green.zone, "green");
    assert.equal(green.delay_ms, 0);

    const onRedLine = classifyOpenZone([{ scope: "run", cap_micros: 100, remaining_micros: 10 }], enabled({ red_delay_ms: 9 }));
    assert.equal(onRedLine.zone, "red");
    assert.equal(onRedLine.delay_ms, 9);
  });
});

describe("brake preview", () => {
  it("names the first scope that cannot cover, and does not take a hold", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: 100, run: 10_000, day: null } });
    const preview = ledger.previewBrake(
      reserveInput({ estimateMicros: 500, userId: "alice", runId: "r" }),
      enabled({ black_delay_ms: 40 }),
    );
    assert.equal(preview.kind, "black");
    if (preview.kind !== "black") return;
    assert.equal(preview.delay_ms, 40);
    assert.equal(preview.deny.code, "BUDGET_EXHAUSTED");
    assert.equal(preview.deny.httpStatus, 402);
    assert.equal(preview.deny.scope, "user");
    assert.equal(preview.deny.remaining_micros, 100);
    assert.equal(ledger.listReservations().length, 0);
    ledger.close();
  });

  it("uses day when earlier scopes still cover", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: 10_000, run: 10_000, day: 50 } });
    const preview = ledger.previewBrake(
      reserveInput({ estimateMicros: 80, userId: "alice", runId: "r" }),
      enabled(),
    );
    assert.equal(preview.kind, "black");
    if (preview.kind !== "black") return;
    assert.equal(preview.deny.scope, "day");
    ledger.close();
  });

  it("treats debt as reduced remaining and does not apply the curve when nothing is capped", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 1000, day: null } });
    const reserved = ledger.reserve(reserveInput({ estimateMicros: 400, runId: "r", idempotencyKey: "seed" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    ledger.settle(reserved.reservationId, 1500);
    const preview = ledger.previewBrake(reserveInput({ estimateMicros: 100, runId: "r", idempotencyKey: "next" }), enabled());
    assert.equal(preview.kind, "black");
    if (preview.kind !== "black") return;
    assert.equal(preview.deny.remaining_micros, -500);
    assert.equal(preview.deny.code, "BUDGET_EXHAUSTED");
    ledger.close();

    const open = new Ledger(tempLedgerPath());
    const skipped = open.previewBrake(reserveInput({ estimateMicros: 10, runId: "r" }), enabled());
    assert.equal(skipped.kind, "skip");
    const denied = open.reserve(reserveInput({ estimateMicros: 10, runId: "r" }));
    assert.equal(denied.kind, "deny");
    if (denied.kind === "deny") assert.equal(denied.code, "NO_BUDGET_CONFIGURED");
    open.close();
  });

});

describe("brake curve on the spend path", () => {
  it("keeps the exhaust body bit-identical when the brake is off", async () => {
    const requested = chatMicros();
    const sidecar = await bootSidecar({ caps: { user: null, run: 0, day: null } });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "off-1", runId: "run-1" });
      assert.equal(deny.status, 402);
      assert.notEqual(deny.status, 429);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(deny.headers.get("x-burnbrake-zone"), null);
      assert.equal(deny.text.includes("zone"), false);
      assert.equal(deny.text.includes("delay_ms"), false);
      assert.equal(deny.text.includes("Retry-After"), false);
      assert.deepEqual(deny.json, {
        error: {
          code: "BUDGET_EXHAUSTED",
          message: "Budget exhausted for scope run. Halt this spend loop. This is not a rate limit.",
          scope: "run",
          remaining_micros: 0,
          requested_micros: requested,
          run_id: "run-1",
          user_id: null,
          halt: true,
          retryable: false,
        },
      });
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
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("does not sleep or add zone headers while enabled is false, even if delays are configured", async () => {
    const sidecar = await bootSidecar({
      env: {
        BURNBRAKE_BRAKE_ENABLED: "false",
        BURNBRAKE_BRAKE_AMBER_PCT: "100",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "5000",
        BURNBRAKE_BRAKE_BLACK_DELAY_MS: "5000",
      },
    });
    try {
      const started = Date.now();
      const allow = await postChat(sidecar, { idempotencyKey: "still-off" });
      assert.equal(allow.status, 200);
      assert.ok(Date.now() - started < 500);
      assert.equal(allow.headers.get("x-burnbrake-zone"), null);
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("sleeps the black delay and still returns the unchanged 402 halt", async () => {
    const requested = chatMicros();
    const sidecar = await bootSidecar({
      caps: { user: null, run: 0, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "80" },
    });
    try {
      const started = Date.now();
      const deny = await postChat(sidecar, { idempotencyKey: "black-1", runId: "run-1" });
      assert.ok(Date.now() - started >= 60);
      assert.equal(deny.status, 402);
      assert.notEqual(deny.status, 429);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.json.error.scope, "run");
      assert.equal(deny.json.error.remaining_micros, 0);
      assert.equal(deny.json.error.requested_micros, requested);
      assert.equal(deny.json.error.zone, "black");
      assert.equal(deny.json.error.delay_ms, 80);
      assert.equal(sidecar.mock.forwardCount, 0);
      assert.equal(sidecar.ledger.listReservations({ runId: "run-1" }).length, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("does not flip a black verdict when the cap is raised during the wait", async () => {
    let raise: () => void = () => {};
    const sidecar = await bootSidecar({
      caps: { user: null, run: 0, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "500" },
      sleep: async (ms) => {
        assert.equal(ms, 500);
        raise();
      },
    });
    raise = () => {
      sidecar.ledger.setCap("run", "run-1", 50_000_000);
    };
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "black-flip", runId: "run-1" });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.json.error.zone, "black");
      assert.equal(sidecar.mock.forwardCount, 0);
      assert.equal(sidecar.ledger.listReservations({ runId: "run-1" }).length, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("returns 200 for amber and red when the reserve still covers after the delay", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 10_000, day: null },
      env: {
        BURNBRAKE_BRAKE_ENABLED: "true",
        BURNBRAKE_BRAKE_AMBER_DELAY_MS: "70",
        BURNBRAKE_BRAKE_RED_DELAY_MS: "70",
      },
    });
    try {
      spend(sidecar.ledger, "run-amber", 7_500);
      const amberStarted = Date.now();
      const amber = await postChat(sidecar, { idempotencyKey: "amber-1", runId: "run-amber" });
      assert.ok(Date.now() - amberStarted >= 50);
      assert.equal(amber.status, 200);
      assert.equal(amber.headers.get("x-burnbrake-zone"), "amber");
      assert.equal(amber.headers.get("x-burnbrake-remaining-micros"), "2500");
      assert.equal(amber.headers.get("x-burnbrake-delay-ms"), "70");
      assert.equal(amber.headers.get("x-burnbrake-scope"), "run");
      assert.equal(amber.headers.get("retry-after"), null);

      spend(sidecar.ledger, "run-red", 9_200);
      const redStarted = Date.now();
      const red = await postChat(sidecar, { idempotencyKey: "red-1", runId: "run-red" });
      assert.ok(Date.now() - redStarted >= 50);
      assert.equal(red.status, 200);
      assert.equal(red.headers.get("x-burnbrake-zone"), "red");
      assert.equal(red.headers.get("x-burnbrake-remaining-micros"), "800");
      assert.equal(red.headers.get("x-burnbrake-delay-ms"), "70");
      assert.equal(red.headers.get("x-burnbrake-scope"), "run");
      assert.equal(sidecar.mock.forwardCount, 2);
    } finally {
      await sidecar.close();
    }
  });

  it("adds green headers only when the curve is on", async () => {
    const sidecar = await bootSidecar({
      env: { BURNBRAKE_BRAKE_ENABLED: "true" },
    });
    try {
      const green = await postChat(sidecar, { idempotencyKey: "green-1", runId: "run-green" });
      assert.equal(green.status, 200);
      assert.equal(green.headers.get("x-burnbrake-zone"), "green");
      assert.equal(green.headers.get("x-burnbrake-delay-ms"), "0");
      assert.equal(green.headers.get("x-burnbrake-scope"), "run");
      assert.equal(Number(green.headers.get("x-burnbrake-remaining-micros")), 1_000_000);
    } finally {
      await sidecar.close();
    }
  });

  it("does not forward when the budget is consumed during an amber delay", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 10_000, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_AMBER_PCT: "100", BURNBRAKE_BRAKE_AMBER_DELAY_MS: "400" },
      sleep: async () => {
        const took = sidecar.ledger.reserve(
          reserveInput({ estimateMicros: 10_000, runId: "run-1", idempotencyKey: "drain" }),
        );
        assert.equal(took.kind, "reserved");
      },
    });
    try {
      const deny = await postChat(sidecar, { idempotencyKey: "late", runId: "run-1" });
      assert.equal(deny.status, 402);
      assert.notEqual(deny.status, 429);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.json.error.zone, "black");
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("serializes two delayed reserves so only one hold can forward", async () => {
    const micros = chatMicros();
    let waiting = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sidecar = await bootSidecar({
      caps: { user: null, run: micros, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_AMBER_PCT: "100", BURNBRAKE_BRAKE_AMBER_DELAY_MS: "200" },
      sleep: () => {
        waiting += 1;
        if (waiting >= 2) release();
        return Promise.race([
          both,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("barrier")), 3000)),
        ]);
      },
    });
    try {
      const [first, second] = await Promise.all([
        postChat(sidecar, { idempotencyKey: "race-a", runId: "race-run" }),
        postChat(sidecar, { idempotencyKey: "race-b", runId: "race-run" }),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 402]);
      const denied = first.status === 402 ? first : second;
      assert.equal(denied.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(denied.json.error.retryable, false);
      assert.equal(denied.json.error.halt, true);
      assert.notEqual(denied.status, 429);
      assert.equal(denied.headers.get("retry-after"), null);
      assert.equal(sidecar.mock.forwardCount, 1);
      const winner = first.status === 200 ? first : second;
      assert.equal(winner.headers.get("x-burnbrake-zone"), "amber");
    } finally {
      await sidecar.close();
    }
  });

  it("leaves NO_BUDGET_CONFIGURED on 503 with no zone when the curve is enabled", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: null, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "5000" },
    });
    try {
      const started = Date.now();
      const deny = await postChat(sidecar, { idempotencyKey: "no-cap", runId: "run-1" });
      assert.ok(Date.now() - started < 500);
      assert.equal(deny.status, 503);
      assert.equal(deny.json.error.code, "NO_BUDGET_CONFIGURED");
      assert.equal(deny.json.error.zone, undefined);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("pauses as black 402 and does not resume mid-wait", async () => {
    const sidecar = await bootSidecar({
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "300" },
      sleep: async () => {
        sidecar.ledger.pauseRun("run-1", false);
      },
    });
    try {
      sidecar.ledger.pauseRun("run-1", true);
      const deny = await postChat(sidecar, { idempotencyKey: "paused", runId: "run-1" });
      assert.equal(deny.status, 402);
      assert.notEqual(deny.status, 429);
      assert.equal(deny.headers.get("retry-after"), null);
      assert.equal(deny.json.error.code, "SPEND_PAUSED");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(deny.json.error.zone, "black");
      assert.equal(deny.json.error.delay_ms, 300);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("applies a brake set on the next reserve and does not rewrite an in-flight forward", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sidecar = await bootSidecar({ beforeForward: () => gate });
    try {
      const pending = postChat(sidecar, { idempotencyKey: "inflight", runId: "run-live" });
      await waitFor(() => sidecar.ledger.listReservations({ state: "FORWARDED", runId: "run-live" }).length === 1);
      const set = await operator(sidecar, "POST", "/v1/operator/brake", {
        enabled: true,
        amber_delay_ms: 15_000,
        black_delay_ms: 15_000,
      });
      assert.equal(set.status, 200);
      const releasedAt = Date.now();
      releaseGate();
      const live = await pending;
      assert.equal(live.status, 200);
      assert.ok(Date.now() - releasedAt < 1000);
      assert.equal(live.headers.get("x-burnbrake-zone"), null);
      assert.equal(sidecar.mock.forwardCount, 1);

      const nextSet = await operator(sidecar, "POST", "/v1/operator/brake", { black_delay_ms: 0, amber_delay_ms: 0 });
      assert.equal(nextSet.status, 200);
      const spent = sidecar.ledger.balances({ runId: "run-live" }).scopes.find((scope) => scope.scope === "run");
      assert.ok(spent);
      sidecar.ledger.setCap("run", "run-live", spent.spent_micros);
      const deny = await postChat(sidecar, { idempotencyKey: "after-set", runId: "run-live" });
      assert.equal(deny.status, 402);
      assert.equal(deny.json.error.zone, "black");
      assert.equal(deny.json.error.delay_ms, 0);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      releaseGate();
      await sidecar.close();
    }
  });

  it("serves /v1/operator/brake to the operator key only", async () => {
    const sidecar = await bootSidecar();
    try {
      const spend = await fetch(`${sidecar.baseURL}/v1/operator/brake`, {
        headers: { "x-burnbrake-key": "bb_test_key" },
      });
      const spendBody = await spend.json();
      assert.equal(spend.status, 401);
      assert.equal(spendBody.error.code, "AUTH_REQUIRED");

      const shown = await operator(sidecar, "GET", "/v1/operator/brake");
      assert.equal(shown.status, 200);
      assert.equal(shown.json.brake.enabled, false);
      assert.match(shown.json.note, /not a halt-off switch/);

      const rejected = await operator(sidecar, "POST", "/v1/operator/brake", {
        enabled: true,
        halt_mode: "off",
      });
      assert.equal(rejected.status, 400);
      assert.match(rejected.json.error.message, /halt_mode/);
      const still = await operator(sidecar, "GET", "/v1/operator/brake");
      assert.equal(still.json.brake.enabled, false);

      const exhaust = await operator(sidecar, "POST", "/v1/operator/brake", { exhaust: { retryable: true } });
      assert.equal(exhaust.status, 400);
      assert.match(exhaust.json.error.message, /exhaust.retryable/);

      const lines: string[] = [];
      const code = await execute(
        ["brake", "set", "--enabled", "true", "--red-delay-ms", "20", "--ledger", sidecar.config.ledgerPath],
        {
          env: { BURNBRAKE_PRICE_TABLE: sidecar.config.priceTablePath },
          log: (line) => lines.push(line),
          error: () => {},
        },
      );
      assert.equal(code, 0);
      const afterCli = await operator(sidecar, "GET", "/v1/operator/brake");
      assert.equal(afterCli.json.brake.enabled, true);
      assert.equal(afterCli.json.brake.red_delay_ms, 20);
      const allow = await postChat(sidecar, { idempotencyKey: "after-cli", runId: "run-cli" });
      assert.equal(allow.status, 200);
      assert.equal(allow.headers.get("x-burnbrake-zone"), "green");
    } finally {
      await sidecar.close();
    }
  });
});

function spend(ledger: Ledger, runId: string, micros: number): void {
  ledger.setCap("run", runId, 10_000);
  const reserved = ledger.reserve(reserveInput({ estimateMicros: micros, runId, idempotencyKey: `seed-${runId}` }));
  if (reserved.kind !== "reserved") throw new Error(`seed reserve failed: ${reserved.kind}`);
  ledger.markForwarded(reserved.reservationId);
  ledger.settle(reserved.reservationId, micros);
}

async function operator(
  sidecar: { baseURL: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; headers: Headers }> {
  const response = await fetch(`${sidecar.baseURL}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_operator" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
