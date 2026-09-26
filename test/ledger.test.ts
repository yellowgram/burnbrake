import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Ledger, type ReserveInput } from "../src/ledger.ts";
import { tempLedgerPath } from "./helpers.ts";

const childPath = fileURLToPath(new URL("../scripts/reserve-race-child.ts", import.meta.url));

function input(partial: Partial<ReserveInput> & Pick<ReserveInput, "estimateMicros" | "runId">): ReserveInput {
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

describe("ledger reservations", () => {
  it("serializes a reserve race so only one hold commits", async () => {
    const path = tempLedgerPath();
    const setup = new Ledger(path, { defaultCaps: { user: null, run: 1000, day: null } });
    setup.close();

    const [first, second] = await Promise.all([
      reserveChild(path, 800, "race-a"),
      reserveChild(path, 800, "race-b"),
    ]);
    const kinds = [first.kind, second.kind].sort();
    assert.deepEqual(kinds, ["deny", "reserved"]);
    const denied = first.kind === "deny" ? first : second;
    assert.equal(denied.code, "BUDGET_EXHAUSTED");
    assert.equal(denied.httpStatus, 402);

    const ledger = new Ledger(path);
    const account = ledger.balances({ runId: "race-run" }).scopes.find((scope) => scope.scope === "run");
    assert.ok(account);
    assert.equal(account.held_micros, 800);
    assert.equal(account.spent_micros, 0);
    assert.equal(account.remaining_micros, 200);
    ledger.close();
  });

  it("rejects the second reserve after the first hold consumes the cap", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 1000, day: null } });
    const ok = ledger.reserve(input({ estimateMicros: 800, runId: "r", idempotencyKey: "a" }));
    const denied = ledger.reserve(input({ estimateMicros: 800, runId: "r", idempotencyKey: "b" }));
    assert.equal(ok.kind, "reserved");
    assert.equal(denied.kind, "deny");
    if (denied.kind === "deny") {
      assert.equal(denied.code, "BUDGET_EXHAUSTED");
      assert.equal(denied.scope, "run");
      assert.equal(denied.remaining_micros, 200);
    }
    ledger.close();
  });

  it("records debt after an overshoot and gates the next reserve", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 1000, day: null } });
    const reserved = ledger.reserve(input({ estimateMicros: 400, runId: "r" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    const settled = ledger.settle(reserved.reservationId, 1500);
    assert.equal(settled.debtDeltaMicros, 1100);
    const balance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.ok(balance);
    assert.equal(balance.spent_micros, 1500);
    assert.equal(balance.overshoot_micros, 1100);
    assert.equal(balance.debt_micros, 500);
    assert.equal(balance.remaining_micros, -500);
    const next = ledger.reserve(input({ estimateMicros: 100, runId: "r", idempotencyKey: "next" }));
    assert.equal(next.kind, "deny");
    if (next.kind === "deny") {
      assert.equal(next.code, "BUDGET_EXHAUSTED");
      assert.equal(next.remaining_micros, -500);
    }
    ledger.close();
  });

  it("releases a pre-forward reservation and debits a forwarded one on TTL", () => {
    let now = 1_000_000;
    const ledger = new Ledger(tempLedgerPath(), {
      reservationTtlMs: 1_000,
      now: () => now,
      defaultCaps: { user: null, run: 5_000, day: null },
    });
    const waiting = ledger.reserve(input({ estimateMicros: 100, runId: "free", idempotencyKey: "free" }));
    const forwarded = ledger.reserve(input({ estimateMicros: 250, runId: "burn", idempotencyKey: "burn" }));
    assert.equal(waiting.kind, "reserved");
    assert.equal(forwarded.kind, "reserved");
    if (waiting.kind !== "reserved" || forwarded.kind !== "reserved") return;
    ledger.markForwarded(forwarded.reservationId);
    assert.throws(() => ledger.release(forwarded.reservationId), /Never free-release after FORWARDED/);
    now += 1_001;
    const swept = ledger.sweep();
    assert.equal(swept.released, 1);
    assert.equal(swept.debited, 1);
    assert.equal(ledger.getReservation(waiting.reservationId)?.terminal_reason, "RELEASE_PRE_FORWARD");
    assert.equal(ledger.getReservation(forwarded.reservationId)?.terminal_reason, "DEBIT_TTL_OR_CRASH");
    assert.equal(ledger.getReservation(forwarded.reservationId)?.state, "DEBIT_RESERVED");
    const free = ledger.balances({ runId: "free" }).scopes.find((scope) => scope.key === "free");
    const burn = ledger.balances({ runId: "burn" }).scopes.find((scope) => scope.key === "burn");
    assert.equal(free?.spent_micros, 0);
    assert.equal(free?.held_micros, 0);
    assert.equal(burn?.spent_micros, 250);
    assert.equal(burn?.held_micros, 0);
    ledger.close();
  });

  it("does not re-reserve an idempotency key whose reservation is already terminal", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 10_000, day: null } });
    const reserved = ledger.reserve(input({ estimateMicros: 400, runId: "r", idempotencyKey: "stuck" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    ledger.debitReserved(reserved.reservationId, "DEBIT_UPSTREAM_UNKNOWN");
    const again = ledger.reserve(input({ estimateMicros: 400, runId: "r", idempotencyKey: "stuck" }));
    assert.notEqual(again.kind, "reserved");
    assert.equal(again.kind, "replay");
    if (again.kind === "replay") {
      assert.equal(again.httpStatus, 409);
      const body = JSON.parse(again.body) as { error: { code: string } };
      assert.equal(body.error.code, "ALREADY_TERMINAL");
    }
    const balance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(balance?.spent_micros, 400);
    assert.equal(balance?.held_micros, 0);
    ledger.close();
  });

  it("leaves a debit in place when releaseNoCharge runs after DEBIT_RESERVED", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 10_000, day: null } });
    const reserved = ledger.reserve(input({ estimateMicros: 250, runId: "r", idempotencyKey: "charged" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    ledger.debitReserved(reserved.reservationId, "DEBIT_TTL_OR_CRASH");
    assert.doesNotThrow(() => ledger.releaseNoCharge(reserved.reservationId));
    const row = ledger.getReservation(reserved.reservationId);
    assert.equal(row?.state, "DEBIT_RESERVED");
    assert.equal(row?.terminal_reason, "DEBIT_TTL_OR_CRASH");
    const balance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(balance?.spent_micros, 250);
    assert.equal(balance?.held_micros, 0);
    ledger.close();
  });

  it("refuses to open a read-only ledger", () => {
    const path = tempLedgerPath();
    const ledger = new Ledger(path, { defaultCaps: { user: null, run: 1, day: null } });
    ledger.close();
    chmodSync(path, 0o444);
    assert.throws(() => new Ledger(path), /not writable|readonly|attempt to write/i);
  });
});

function reserveChild(path: string, estimateMicros: number, idemKey: string): Promise<{ kind: string; code?: string; httpStatus?: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", childPath], {
      env: {
        ...process.env,
        LEDGER_PATH: path,
        ESTIMATE_MICROS: String(estimateMicros),
        IDEM_KEY: idemKey,
        RUN_ID: "race-run",
      },
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`race child exited ${code}: ${err || out}`));
        return;
      }
      resolve(JSON.parse(out));
    });
  });
}
