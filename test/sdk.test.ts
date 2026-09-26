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
  });
});
