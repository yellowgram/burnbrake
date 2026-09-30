import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { safeEqual } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import {
  estimateRequest,
  TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR,
  TOOLS_FLAT_MICROS_FLOOR,
  VISION_FLAT_MICROS_FLOOR,
  VISION_INPUT_TOKEN_FLOOR,
} from "../src/estimate.ts";
import { Ledger } from "../src/ledger.ts";
import { loadPriceTable } from "../src/prices.ts";
import { bootSidecar, postChat, tempLedgerPath } from "./helpers.ts";

describe("P1 hardening", () => {
  it("compares secrets without throwing on a length mismatch and accepts a previous key", async () => {
    assert.equal(safeEqual("bb_short", "bb_short"), true);
    assert.equal(safeEqual("bb_short", "bb_a_much_longer_secret_value"), false);
    assert.equal(safeEqual("bb_a_much_longer_secret_value", "bb_short"), false);
    const sidecar = await bootSidecar({
      env: { BURNBRAKE_KEY_PREVIOUS: "bb_previous_spend", BURNBRAKE_OPERATOR_KEY_PREVIOUS: "bb_previous_operator" },
    });
    try {
      const health = await (await fetch(`${sidecar.baseURL}/health`)).json();
      assert.equal(health.auth.rotation_overlap, true);
      assert.equal(health.auth.required, true);
      const previous = await postChat(sidecar, { key: "bb_previous_spend", idempotencyKey: "rot-prev", runId: "run-rot" });
      assert.equal(previous.status, 200);
      const current = await postChat(sidecar, { key: "bb_test_key", idempotencyKey: "rot-cur", runId: "run-rot" });
      assert.equal(current.status, 200);
      const rejected = await postChat(sidecar, { key: "bb_not_a_key", idempotencyKey: "rot-no", runId: "run-rot" });
      assert.equal(rejected.status, 401);
      const ops = await fetch(`${sidecar.baseURL}/v1/operator/balances`, {
        headers: { "x-burnbrake-key": "bb_previous_operator" },
      });
      assert.equal(ops.status, 200);
      const spendOnOps = await fetch(`${sidecar.baseURL}/v1/operator/balances`, {
        headers: { "x-burnbrake-key": "bb_previous_spend" },
      });
      assert.equal(spendOnOps.status, 401);
    } finally {
      await sidecar.close();
    }
    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_spend", BURNBRAKE_OPERATOR_KEY: "bb_ops", BURNBRAKE_KEY_PREVIOUS: "bb_ops" }),
      /distinct/i,
    );
  });

  it("raises vision and tool floors and reports settle versus reserve", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-floor-"));
    const path = join(dir, "low.yaml");
    writeFileSync(
      path,
      `version: "low"
priced_at: "2026-09-26T00:00:00Z"
models:
  gpt-4o-mini:
    input_micros_per_million: 150000
    output_micros_per_million: 600000
surcharges:
  vision:
    per_image_input_tokens: 1
    per_image_micros: 0
  tools:
    extra_output_tokens: 1
    flat_micros: 0
known_content_types: [text, image_url]
`,
    );
    const table = loadPriceTable(path);
    const plain = estimateRequest(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      table,
      4096,
      "/v1/chat/completions",
    );
    const rich = estimateRequest(
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://example.test/a.png" } }] }],
        tools: [{ type: "function", function: { name: "ping" } }],
        max_tokens: 16,
      },
      table,
      4096,
      "/v1/chat/completions",
    );
    assert.equal(plain.ok, true);
    assert.equal(rich.ok, true);
    if (!plain.ok || !rich.ok) return;
    assert.equal(plain.flatMicros, 0);
    assert.ok(rich.flatMicros >= VISION_FLAT_MICROS_FLOOR + TOOLS_FLAT_MICROS_FLOOR);
    assert.ok(rich.inputTokens >= VISION_INPUT_TOKEN_FLOOR);
    assert.ok(rich.outputTokens >= 16 + TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR);
    assert.ok(rich.micros > plain.micros);

    const sidecar = await bootSidecar({ caps: { user: null, run: 50_000_000, day: null } });
    try {
      const allow = await postChat(sidecar, { idempotencyKey: "metrics-1", runId: "run-metrics" });
      assert.equal(allow.status, 200);
      const metrics = await fetch(`${sidecar.baseURL}/v1/operator/estimate-error`, {
        headers: { "x-burnbrake-key": "bb_test_operator" },
      });
      const body = await metrics.json();
      assert.equal(metrics.status, 200);
      assert.equal(body.estimate_error.samples, 1);
      assert.equal(
        body.estimate_error.under_reserve + body.estimate_error.over_reserve + body.estimate_error.exact,
        1,
      );
      const health = await (await fetch(`${sidecar.baseURL}/health`)).json();
      assert.equal(health.estimate.floors.vision_flat_micros, VISION_FLAT_MICROS_FLOOR);
      assert.equal(health.estimate.floors.tools_flat_micros, TOOLS_FLAT_MICROS_FLOOR);
      assert.equal(health.day_clock.source, "process");
      assert.match(health.day_clock.multi_writer, /one shared store/i);
    } finally {
      await sidecar.close();
    }
  });

  it("refuses a second writer while the lease is held and after the clock passes it", async () => {
    const ledgerPath = tempLedgerPath();
    const first = await bootSidecar({
      ledgerPath,
      env: {
        BURNBRAKE_WRITER_LEASE: "1",
        BURNBRAKE_WRITER_ID: "writer-a",
        BURNBRAKE_WRITER_LEASE_TTL_MS: "30000",
      },
    });
    try {
      const health = await (await fetch(`${first.baseURL}/health`)).json();
      assert.equal(health.day_clock.writer_lease, "required");
      assert.equal(health.day_clock.writer_lease_held, true);
      await assert.rejects(
        () =>
          bootSidecar({
            ledgerPath,
            env: {
              BURNBRAKE_WRITER_LEASE: "1",
              BURNBRAKE_WRITER_ID: "writer-b",
              BURNBRAKE_WRITER_LEASE_TTL_MS: "30000",
            },
          }),
        /Another writer holds this ledger/,
      );
    } finally {
      await first.close();
    }

    const second = await bootSidecar({
      ledgerPath,
      env: {
        BURNBRAKE_WRITER_LEASE: "1",
        BURNBRAKE_WRITER_ID: "writer-b",
        BURNBRAKE_WRITER_LEASE_TTL_MS: "5000",
      },
    });
    await second.close();

    let now = Date.parse("2026-09-30T12:00:00Z");
    const leased = await bootSidecar({
      env: {
        BURNBRAKE_WRITER_LEASE: "1",
        BURNBRAKE_WRITER_ID: "writer-clock",
        BURNBRAKE_WRITER_LEASE_TTL_MS: "5000",
      },
      now: () => now,
    });
    try {
      now = Date.parse("2026-09-30T12:00:06Z");
      const denied = await postChat(leased, { idempotencyKey: "lease-expired", runId: "run-lease" });
      assert.equal(denied.status, 503);
      assert.equal(denied.json.error.code, "WRITER_LEASE_REQUIRED");
      assert.equal(denied.json.error.retryable, false);
      assert.equal(leased.mock.forwardCount, 0);
    } finally {
      await leased.close();
    }
  });

  it("lets the CLI summary read a ledger the sidecar already wrote", () => {
    const path = tempLedgerPath();
    const ledger = new Ledger(path, { defaultCaps: { user: null, run: 1000, day: null } });
    ledger.logDecision({
      userId: null,
      runId: "run",
      decision: "ALLOW",
      code: "OK",
      scope: "run",
      requestedMicros: 100,
      remainingAfterMicros: 50,
      debtDeltaMicros: 20,
      model: "gpt-4o-mini",
      route: "/v1/chat/completions",
      latencyMs: 1,
      idempotencyKey: null,
      priceTableVersion: "test",
      upstreamForwarded: true,
      reservationId: null,
      estimatedMicros: 100,
      settledMicros: 120,
      terminalReason: "SETTLED",
      maxTokensSource: "request",
    });
    const summary = ledger.estimateErrorSummary();
    ledger.close();
    assert.equal(summary.samples, 1);
    assert.equal(summary.under_reserve, 1);
    assert.equal(summary.net_error_micros, 20);
    assert.equal(summary.max_under_reserve_micros, 20);
  });
});
