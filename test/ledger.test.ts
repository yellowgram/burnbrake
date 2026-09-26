import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
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

  it("true-ups a TTL debit to actual usage and does not stack the estimate", () => {
    let now = 1_000_000;
    const ledger = new Ledger(tempLedgerPath(), {
      reservationTtlMs: 1_000,
      now: () => now,
      defaultCaps: { user: null, run: 10_000, day: null },
    });
    const reserved = ledger.reserve(input({ estimateMicros: 800, runId: "r", idempotencyKey: "ttl-settle" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    now += 1_001;
    const swept = ledger.sweep();
    assert.equal(swept.debited, 1);
    assert.equal(ledger.getReservation(reserved.reservationId)?.state, "DEBIT_RESERVED");
    assert.throws(() => ledger.release(reserved.reservationId), /Never free-release after FORWARDED/);
    assert.doesNotThrow(() => ledger.releaseNoCharge(reserved.reservationId));
    const settled = ledger.settle(reserved.reservationId, 300);
    assert.equal(settled.terminalReason, "SETTLED");
    const row = ledger.getReservation(reserved.reservationId);
    assert.equal(row?.state, "SETTLED");
    assert.equal(row?.actual_micros, 300);
    const balance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(balance?.spent_micros, 300);
    assert.equal(balance?.held_micros, 0);
    const again = ledger.sweep();
    assert.equal(again.debited, 0);
    assert.equal(again.released, 0);
    const after = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(after?.spent_micros, 300);

    const over = ledger.reserve(input({ estimateMicros: 800, runId: "r", idempotencyKey: "ttl-over" }));
    assert.equal(over.kind, "reserved");
    if (over.kind !== "reserved") return;
    ledger.markForwarded(over.reservationId);
    now += 1_001;
    ledger.sweep();
    ledger.settle(over.reservationId, 900);
    const overBalance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(overBalance?.spent_micros, 1_200);
    assert.equal(overBalance?.overshoot_micros, 100);
    assert.equal(overBalance?.held_micros, 0);
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

  it("debits every configured scope and blocks the next reserve on the scope that is in debt", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: 5_000, run: null, day: 1_000 } });
    const reserved = ledger.reserve(input({ estimateMicros: 800, runId: "ignored", userId: "alice" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    ledger.settle(reserved.reservationId, 1_500);
    const user = ledger.balances({ userId: "alice" }).scopes.find((scope) => scope.scope === "user");
    const day = ledger.balances({ userId: "alice" }).scopes.find((scope) => scope.scope === "day");
    assert.equal(user?.spent_micros, 1_500);
    assert.equal(user?.debt_micros, 0);
    assert.equal(day?.spent_micros, 1_500);
    assert.equal(day?.debt_micros, 500);
    assert.equal(day?.held_micros, 0);
    const next = ledger.reserve(input({ estimateMicros: 100, runId: "ignored", userId: "alice", idempotencyKey: "next" }));
    assert.equal(next.kind, "deny");
    if (next.kind === "deny") {
      assert.equal(next.code, "BUDGET_EXHAUSTED");
      assert.equal(next.httpStatus, 402);
      assert.equal(next.scope, "day");
    }
    ledger.close();
  });

  it("drops replay bodies after 24h and does not reserve that key again", () => {
    let now = 1_000_000;
    const ledger = new Ledger(tempLedgerPath(), {
      now: () => now,
      defaultCaps: { user: null, run: 10_000, day: null },
    });
    const reserved = ledger.reserve(input({ estimateMicros: 400, runId: "r", idempotencyKey: "secret-key" }));
    assert.equal(reserved.kind, "reserved");
    if (reserved.kind !== "reserved") return;
    ledger.markForwarded(reserved.reservationId);
    ledger.settle(reserved.reservationId, 50);
    ledger.completeIdempotency("secret-key", 200, '{"id":"chatcmpl-secret","choices":[{"message":{"content":"secret"}}]}');
    now += 24 * 60 * 60 * 1000 + 1;
    ledger.sweep();
    const again = ledger.reserve(input({ estimateMicros: 400, runId: "r", idempotencyKey: "secret-key" }));
    assert.equal(again.kind, "replay");
    if (again.kind === "replay") {
      assert.equal(again.httpStatus, 409);
      assert.equal(again.body.includes("secret"), false);
      assert.equal(JSON.parse(again.body).error.code, "ALREADY_TERMINAL");
    }
    const balance = ledger.balances({ runId: "r" }).scopes.find((scope) => scope.scope === "run");
    assert.equal(balance?.spent_micros, 50);
    assert.equal(balance?.held_micros, 0);
    ledger.close();
  });

  it("restricts the ledger file and refuses to open a read-only ledger", () => {
    const path = tempLedgerPath();
    const ledger = new Ledger(path, { defaultCaps: { user: null, run: 1, day: null } });
    assert.equal(statSync(path).mode & 0o777, 0o600);
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
