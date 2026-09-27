import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execute } from "../src/cli.ts";
import { BudgetExhausted, BurnBrake, IdempotencyKeyRequired } from "../src/sdk/index.ts";
import { bootSidecar, tempLedgerPath } from "./helpers.ts";

describe("typescript sdk", () => {
  it("requires an idempotency key before any request", async () => {
    let called = false;
    const client = new BurnBrake({
      baseURL: "http://127.0.0.1:9",
      apiKey: "bb_test_key",
      fetchImpl: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    await assert.rejects(
      () => client.chat.completions.create({ model: "gpt-4o-mini", messages: [] }, { idempotencyKey: "  " }),
      IdempotencyKeyRequired,
    );
    await assert.rejects(
      () => client.chat.completions.create({ model: "gpt-4o-mini", messages: [] }, { idempotencyKey: undefined as unknown as string }),
      IdempotencyKeyRequired,
    );
    assert.equal(called, false);
    await assert.rejects(
      () =>
        (
          client.chat.completions.create as (body: { model: string; messages: unknown[]; idempotencyKey: string }) => Promise<unknown>
        )({ model: "gpt-4o-mini", messages: [], idempotencyKey: "only-on-the-body" }),
      IdempotencyKeyRequired,
    );
    await assert.rejects(
      () =>
        client.chat.completions.create(
          { model: "gpt-4o-mini", messages: [] },
          { idempotencyKey: "bad\nkey" },
        ),
      IdempotencyKeyRequired,
    );
    assert.equal(called, false);
  });

  it("throws BudgetExhausted for HTTP 402 and does not treat it as success", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 1, day: null } });
    try {
      const client = new BurnBrake({ baseURL: sidecar.baseURL, apiKey: "bb_test_key" });
      await assert.rejects(
        () =>
          client.chat.completions.create(
            { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
            { idempotencyKey: "sdk-deny", runId: "run-1" },
          ),
        (err: unknown) => {
          assert.ok(err instanceof BudgetExhausted);
          assert.equal(err.httpStatus, 402);
          assert.equal(err.code, "BUDGET_EXHAUSTED");
          assert.equal(err.halt, true);
          assert.equal(err.retryable, false);
          assert.equal(err.scope, "run");
          return true;
        },
      );
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("does not sleep again when a 402 body carries a curve delay", async () => {
    const started = Date.now();
    const client = new BurnBrake({
      baseURL: "http://127.0.0.1:9",
      apiKey: "bb_test_key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BUDGET_EXHAUSTED",
              message: "Budget exhausted for scope run. Halt this spend loop. This is not a rate limit.",
              scope: "run",
              remaining_micros: 0,
              requested_micros: 12,
              run_id: "run-1",
              user_id: null,
              halt: true,
              retryable: true,
              zone: "black",
              delay_ms: 10_000,
            },
          }),
          { status: 402, headers: { "content-type": "application/json", "retry-after": "10" } },
        ),
    });
    await assert.rejects(
      () =>
        client.chat.completions.create(
          { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
          { idempotencyKey: "sdk-no-sleep", runId: "run-1" },
        ),
      (err: unknown) => {
        assert.ok(err instanceof BudgetExhausted);
        assert.equal(err.halt, true);
        assert.equal(err.retryable, false);
        assert.equal("delay_ms" in err, false);
        return true;
      },
    );
    assert.ok(Date.now() - started < 500);
  });

  it("matches the live 402 shape and does not add a second sleep", async () => {
    const sidecar = await bootSidecar({
      caps: { user: null, run: 0, day: null },
      env: { BURNBRAKE_BRAKE_ENABLED: "true", BURNBRAKE_BRAKE_BLACK_DELAY_MS: "80" },
    });
    try {
      const client = new BurnBrake({ baseURL: sidecar.baseURL, apiKey: "bb_test_key" });
      const started = Date.now();
      await assert.rejects(
        () =>
          client.chat.completions.create(
            { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
            { idempotencyKey: "sdk-live-402", runId: "run-1" },
          ),
        (err: unknown) => {
          assert.ok(err instanceof BudgetExhausted);
          assert.equal(err.httpStatus, 402);
          assert.equal(err.code, "BUDGET_EXHAUSTED");
          assert.equal(err.halt, true);
          assert.equal(err.retryable, false);
          assert.equal(err.scope, "run");
          assert.equal(err.remaining_micros, 0);
          assert.equal("delay_ms" in err, false);
          assert.equal("zone" in err, false);
          return true;
        },
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 60);
      assert.ok(elapsed < 500);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });
});

describe("operator cli", () => {
  it("adjusts caps and shows balances from the ledger file", async () => {
    const ledgerPath = tempLedgerPath();
    const lines: string[] = [];
    const errors: string[] = [];
    const io = {
      env: { BURNBRAKE_LEDGER_PATH: ledgerPath, BURNBRAKE_PRICE_TABLE: new URL("../prices/openai.yaml", import.meta.url).pathname },
      log: (line: string) => lines.push(line),
      error: (line: string) => errors.push(line),
    };
    assert.equal(await execute(["caps", "set", "--scope", "run", "--key", "cli-run", "--usd", "1.50", "--ledger", ledgerPath], io), 0);
    assert.equal(await execute(["kill", "--run", "cli-run", "--ledger", ledgerPath], io), 0);
    lines.length = 0;
    assert.equal(await execute(["balances", "--run", "cli-run", "--json", "--ledger", ledgerPath], io), 0);
    const report = JSON.parse(lines.join("\n"));
    const run = report.scopes.find((scope: { scope: string }) => scope.scope === "run");
    assert.equal(run.cap_micros, 1_500_000);
    assert.equal(report.paused.run, true);
    assert.equal(errors.length, 0);
    assert.equal(await execute(["resume", "--run", "cli-run", "--ledger", ledgerPath], io), 0);
    lines.length = 0;
    assert.equal(await execute(["brake", "show", "--json", "--ledger", ledgerPath], io), 0);
    const shown = JSON.parse(lines.join("\n"));
    assert.equal(shown.brake.enabled, false);
    assert.equal(shown.brake.black_delay_ms, 0);
    assert.equal(shown.brake.amber_pct, 30);
    assert.equal(await execute(["brake", "set", "--enabled", "true", "--amber-delay-ms", "250", "--ledger", ledgerPath], io), 0);
    lines.length = 0;
    assert.equal(await execute(["brake", "show", "--json", "--ledger", ledgerPath], io), 0);
    const updated = JSON.parse(lines.join("\n"));
    assert.equal(updated.brake.enabled, true);
    assert.equal(updated.brake.amber_delay_ms, 250);
    assert.equal(updated.brake.black_delay_ms, 0);
    assert.match(updated.note, /not a halt-off switch/);
    assert.equal(
      await execute(["brake", "set", "--amber-pct", "5", "--red-pct", "10", "--ledger", ledgerPath], io),
      1,
    );
    assert.match(errors.join("\n"), /amber_pct/);
    lines.length = 0;
    assert.equal(await execute(["brake", "show", "--json", "--ledger", ledgerPath], io), 0);
    assert.equal(JSON.parse(lines.join("\n")).brake.amber_pct, 30);
  });
});
