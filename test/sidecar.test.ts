import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { bootSidecar, postChat } from "./helpers.ts";

describe("sidecar spend path", () => {
  it("rejects an over-budget call without forwarding upstream", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 1_000_000, day: null } });
    try {
      const allow = await postChat(sidecar, { idempotencyKey: "allow-1", runId: "run-allow" });
      assert.equal(allow.status, 200);
      assert.equal(sidecar.mock.forwardCount, 1);
      assert.equal(allow.json.usage.completion_tokens > 0, true);

      const balances = await operator(sidecar, "GET", "/v1/operator/balances?run_id=run-allow");
      const run = balances.json.scopes.find((scope: { scope: string }) => scope.scope === "run");
      assert.ok(run.spent_micros > 0);

      const lowered = await operator(sidecar, "POST", "/v1/operator/caps", {
        scope: "run",
        key: "run-allow",
        cap_micros: run.spent_micros,
      });
      assert.equal(lowered.status, 200);

      const deny = await postChat(sidecar, { idempotencyKey: "deny-1", runId: "run-allow" });
      assert.equal(deny.status, 402);
      assert.notEqual(deny.status, 429);
      assert.equal(deny.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deny.json.error.scope, "run");
      assert.equal(deny.json.error.halt, true);
      assert.equal(deny.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 1);

      const decisions = await operator(sidecar, "GET", "/v1/operator/decisions?deny_only=1&run_id=run-allow");
      const row = decisions.json.decisions.find((item: { code: string }) => item.code === "BUDGET_EXHAUSTED");
      assert.ok(row);
      assert.equal(row.upstream_forwarded, 0);
      assert.equal(row.decision, "DENY");
    } finally {
      await sidecar.close();
    }
  });

  it("requires BurnBrake auth and never forwards an unauthenticated call", async () => {
    const sidecar = await bootSidecar();
    try {
      const missing = await postChat(sidecar, { key: null, idempotencyKey: "auth-1" });
      assert.equal(missing.status, 401);
      assert.equal(missing.json.error.code, "AUTH_REQUIRED");
      assert.equal(sidecar.mock.forwardCount, 0);

      const providerKey = await postChat(sidecar, {
        key: null,
        headers: { authorization: "Bearer sk-live-looking" },
        idempotencyKey: "auth-2",
      });
      assert.equal(providerKey.status, 401);
      assert.equal(sidecar.mock.forwardCount, 0);

      const bearer = await postChat(sidecar, {
        key: null,
        headers: { authorization: "Bearer bb_test_key" },
        idempotencyKey: "auth-3",
      });
      assert.equal(bearer.status, 200);
      assert.equal(sidecar.mock.forwardCount, 1);

      const header = await postChat(sidecar, { idempotencyKey: "auth-4" });
      assert.equal(header.status, 200);
      assert.equal(sidecar.mock.forwardCount, 2);
    } finally {
      await sidecar.close();
    }
  });

  it("does not double-forward an in-flight or completed idempotency key", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const sidecar = await bootSidecar({ beforeForward: () => gate });
    try {
      const first = postChat(sidecar, { idempotencyKey: "same-key", runId: "run-idem" });
      await waitFor(() => sidecar.ledger.listReservations({ state: "FORWARDED", runId: "run-idem" }).length === 1);
      const second = await postChat(sidecar, { idempotencyKey: "same-key", runId: "run-idem" });
      assert.equal(second.status, 409);
      assert.equal(second.json.error.code, "REQUEST_IN_FLIGHT");
      assert.equal(sidecar.mock.forwardCount, 0);
      releaseGate();
      const completed = await first;
      assert.equal(completed.status, 200);
      assert.equal(sidecar.mock.forwardCount, 1);
      const replay = await postChat(sidecar, { idempotencyKey: "same-key", runId: "run-idem" });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.id, completed.json.id);
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      releaseGate();
      await sidecar.close();
    }
  });

  it("injects max_tokens only when the request omits it", async () => {
    const sidecar = await bootSidecar();
    try {
      const injected = await postChat(sidecar, {
        idempotencyKey: "inject-1",
        body: { max_tokens: undefined },
      });
      assert.equal(injected.status, 200);
      assert.equal((sidecar.mock.lastBody as { max_tokens?: number }).max_tokens, 4096);

      const explicit = await postChat(sidecar, {
        idempotencyKey: "inject-2",
        body: { max_tokens: 8000 },
      });
      assert.equal(explicit.status, 200);
      assert.equal((sidecar.mock.lastBody as { max_tokens?: number }).max_tokens, 8000);
    } finally {
      await sidecar.close();
    }
  });

  it("passes provider 429 through and does not relabel it as budget exhaust", async () => {
    const sidecar = await bootSidecar();
    try {
      const response = await postChat(sidecar, {
        idempotencyKey: "rate-1",
        headers: { "x-burnbrake-mock-status": "429" },
      });
      assert.equal(response.status, 429);
      assert.notEqual(response.json.error?.code, "BUDGET_EXHAUSTED");
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("denies an unpriced model without forwarding", async () => {
    const sidecar = await bootSidecar();
    try {
      const response = await postChat(sidecar, {
        idempotencyKey: "unpriced-1",
        body: { model: "not-a-real-model" },
      });
      assert.equal(response.status, 402);
      assert.equal(response.json.error.code, "UNPRICED_MODEL");
      assert.equal(response.json.error.halt, true);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("rejects the spend key on operator routes and accepts the operator key", async () => {
    const sidecar = await bootSidecar();
    try {
      const set = await operator(sidecar, "POST", "/v1/operator/caps", {
        scope: "run",
        key: "run-ops",
        cap_micros: 1_000_000,
      });
      assert.equal(set.status, 200);
      const spend = await fetch(`${sidecar.baseURL}/v1/operator/caps`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key" },
        body: JSON.stringify({ scope: "run", key: "run-ops", cap_micros: 50_000_000 }),
      });
      const spendBody = await spend.json();
      assert.equal(spend.status, 401);
      assert.equal(spendBody.error.code, "AUTH_REQUIRED");
      const after = await operator(sidecar, "GET", "/v1/operator/balances?run_id=run-ops");
      const capAfter = after.json.scopes.find((scope: { scope: string }) => scope.scope === "run").cap_micros;
      assert.equal(capAfter, 1_000_000);
    } finally {
      await sidecar.close();
    }

    const disabled = await bootSidecar({ operatorKey: "" });
    try {
      const blocked = await fetch(`${disabled.baseURL}/v1/operator/caps`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key" },
        body: JSON.stringify({ scope: "run", key: "run-1", cap_usd: "100" }),
      });
      const blockedBody = await blocked.json();
      assert.equal(blocked.status, 403);
      assert.equal(blockedBody.error.code, "OPERATOR_KEY_REQUIRED");
      const row = disabled.ledger.balances({ runId: "run-1" }).scopes.find((scope) => scope.scope === "run");
      assert.equal(row, undefined);
      const health = await fetch(`${disabled.baseURL}/health`);
      const healthBody = await health.json();
      assert.equal(healthBody.operator_http, false);
    } finally {
      await disabled.close();
    }
  });

  it("seals the idempotency key when the reservation is debited before upstream", async () => {
    const sidecar = await bootSidecar({
      beforeForward: async () => {
        throw new Error("boom");
      },
    });
    try {
      const first = await postChat(sidecar, { idempotencyKey: "seal-1", runId: "run-seal" });
      assert.equal(first.status, 502);
      assert.equal(first.json.error.code, "UPSTREAM_ERROR");
      assert.equal(sidecar.mock.forwardCount, 0);
      const balances = await operator(sidecar, "GET", "/v1/operator/balances?run_id=run-seal");
      const run = balances.json.scopes.find((scope: { scope: string }) => scope.scope === "run");
      assert.ok(run.spent_micros > 0);
      assert.equal(run.held_micros, 0);
      const second = await postChat(sidecar, { idempotencyKey: "seal-1", runId: "run-seal" });
      assert.equal(second.status, 502);
      assert.equal(second.json.error.code, "UPSTREAM_ERROR");
      assert.equal(sidecar.mock.forwardCount, 0);
      const replayed = await operator(sidecar, "GET", "/v1/operator/balances?run_id=run-seal");
      const runAfter = replayed.json.scopes.find((scope: { scope: string }) => scope.scope === "run");
      assert.equal(runAfter.spent_micros, run.spent_micros);
    } finally {
      await sidecar.close();
    }
  });

  it("does not treat the OpenAI user field or the operator key as a spend identity", async () => {
    const sidecar = await bootSidecar({ caps: { user: 1_000_000, run: null, day: null } });
    try {
      const washed = await postChat(sidecar, {
        idempotencyKey: "body-user",
        userId: null,
        runId: null,
        body: { user: "end-user-rotated" },
      });
      assert.equal(washed.status, 400);
      assert.equal(washed.json.error.code, "IDENTITY_REQUIRED");
      assert.equal(sidecar.mock.forwardCount, 0);
      const allowed = await postChat(sidecar, {
        idempotencyKey: "header-user",
        userId: "alice",
        runId: null,
        body: { user: "someone-else" },
      });
      assert.equal(allowed.status, 200);
      const alice = sidecar.ledger.balances({ userId: "alice" }).scopes.find((scope) => scope.scope === "user");
      const other = sidecar.ledger.balances({ userId: "someone-else" }).scopes.find((scope) => scope.scope === "user");
      const rotated = sidecar.ledger.balances({ userId: "end-user-rotated" }).scopes.find((scope) => scope.scope === "user");
      assert.ok(alice && alice.spent_micros > 0);
      assert.equal(other, undefined);
      assert.equal(rotated, undefined);
      const operatorSpend = await postChat(sidecar, {
        idempotencyKey: "operator-cannot-spend",
        key: "bb_test_operator",
        userId: "alice",
        runId: null,
      });
      assert.equal(operatorSpend.status, 401);
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("rejects an overlong idempotency key before forwarding", async () => {
    const sidecar = await bootSidecar();
    try {
      const response = await postChat(sidecar, { idempotencyKey: "k".repeat(201) });
      assert.equal(response.status, 400);
      assert.equal(response.json.error.code, "BAD_REQUEST");
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });

  it("settles a finished stream from usage and still settles if the client leaves after forward", async () => {
    const sidecar = await bootSidecar();
    try {
      const streamed = await postChat(sidecar, {
        idempotencyKey: "stream-done",
        runId: "run-stream",
        body: { stream: true, max_tokens: 4000 },
      });
      assert.equal(streamed.status, 200);
      assert.equal(streamed.text.includes("data: [DONE]"), true);
      const run = sidecar.ledger.balances({ runId: "run-stream" }).scopes.find((scope) => scope.scope === "run");
      assert.ok(run && run.spent_micros > 0 && run.spent_micros < 100);
    } finally {
      await sidecar.close();
    }

    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const hanging = await bootSidecar({ beforeForward: () => gate });
    const controller = new AbortController();
    try {
      const pending = fetch(`${hanging.baseURL}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-burnbrake-key": "bb_test_key",
          "x-burnbrake-run-id": "run-abort",
          "idempotency-key": "abort-1",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
          stream: true,
        }),
      });
      await waitFor(() => hanging.ledger.listReservations({ state: "FORWARDED", runId: "run-abort" }).length === 1);
      controller.abort();
      releaseGate();
      await pending.catch(() => undefined);
      await waitFor(() => {
        const row = hanging.ledger.listReservations({ runId: "run-abort" })[0];
        return row?.state === "SETTLED" || row?.state === "DEBIT_RESERVED";
      });
      const row = hanging.ledger.listReservations({ runId: "run-abort" })[0];
      assert.notEqual(row?.state, "RELEASED");
      assert.notEqual(row?.terminal_reason, "RELEASE_PRE_FORWARD");
      assert.equal(hanging.mock.forwardCount, 1);
      const spent = hanging.ledger.balances({ runId: "run-abort" }).scopes.find((scope) => scope.scope === "run");
      assert.ok(spent && spent.spent_micros > 0 && spent.held_micros === 0);
    } finally {
      releaseGate();
      await hanging.close();
    }
  });

  it("refuses to start when the price table is corrupt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-bad-price-"));
    const path = join(dir, "bad.yaml");
    writeFileSync(path, "version: [\nthis is not a price table\n");
    await assert.rejects(
      () => bootSidecar({ priceTablePath: path }),
      /Price table|YAML|mapping|must be/i,
    );
  });

  it("kills a run so the next reserve does not forward", async () => {
    const sidecar = await bootSidecar();
    try {
      const killed = await operator(sidecar, "POST", "/v1/operator/runs/kill", { run_id: "run-1" });
      assert.equal(killed.status, 200);
      const response = await postChat(sidecar, { idempotencyKey: "killed-1" });
      assert.equal(response.status, 402);
      assert.equal(response.json.error.code, "SPEND_PAUSED");
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });
});

describe("bind and auth config", () => {
  it("defaults to localhost and refuses a public bind without the opt-in flag", async () => {
    const sidecar = await bootSidecar();
    try {
      assert.equal(sidecar.host, "127.0.0.1");
      const health = await fetch(`${sidecar.baseURL}/health`);
      const body = await health.json();
      assert.equal(body.listen, "127.0.0.1");
      assert.equal(body.auth.required, true);
      assert.equal(body.fail_closed, true);
      assert.equal(body.ledger.writable, true);
      assert.equal(body.estimate.default_max_tokens, 4096);
      assert.equal(body.reservation_ttl_seconds, 900);
      assert.equal(body.day_boundary, "UTC");
      assert.equal(body.price_table.stale_warn_days, 30);
    } finally {
      await sidecar.close();
    }

    assert.throws(
      () => loadConfig({ BURNBRAKE_HOST: "0.0.0.0", BURNBRAKE_KEY: "bb_test_key" }),
      /Refusing to bind/,
    );
    const allowed = loadConfig({
      BURNBRAKE_HOST: "0.0.0.0",
      BURNBRAKE_ALLOW_PUBLIC_BIND: "1",
      BURNBRAKE_KEY: "bb_test_key",
    });
    assert.equal(allowed.host, "0.0.0.0");
    assert.equal(allowed.allowPublicBind, true);
    assert.equal(allowed.failClosed, true);
    assert.throws(() => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_FAIL_OPEN: "1" }), /fail-open/i);
    assert.throws(() => loadConfig({ BURNBRAKE_KEY: "sk-provider" }), /bb_/);
    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_OPERATOR_KEY: "bb_test_key" }),
      /distinct/,
    );
    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_OPERATOR_KEY: "sk-provider" }),
      /bb_/,
    );
    const split = loadConfig({ BURNBRAKE_KEY: "bb_spend", BURNBRAKE_OPERATOR_KEY: "bb_ops" });
    assert.equal(split.apiKey, "bb_spend");
    assert.equal(split.operatorKey, "bb_ops");
  });

  it("refuses to listen on a public address unless the flag is set", async () => {
    await assert.rejects(
      () => bootSidecar({ host: "0.0.0.0", allowPublicBind: false }),
      /Refusing to bind/,
    );
    const sidecar = await bootSidecar({ host: "0.0.0.0", allowPublicBind: true });
    try {
      assert.equal(sidecar.host, "0.0.0.0");
      const health = await fetch(`${sidecar.baseURL}/health`);
      const body = await health.json();
      assert.equal(body.auth.required, true);
      assert.equal(body.fail_closed, true);
    } finally {
      await sidecar.close();
    }
  });
});

async function operator(
  sidecar: { baseURL: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${sidecar.baseURL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-burnbrake-key": "bb_test_operator",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error("timed out waiting for reservation state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
