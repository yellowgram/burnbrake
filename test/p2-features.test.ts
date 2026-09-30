import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { openReplayBody, sealReplayBody, deriveReplayKey } from "../src/replay-body.ts";
import { BurnBrake } from "../src/sdk/index.ts";
import { bootSidecar, postChat } from "./helpers.ts";

describe("P2 features", () => {
  it("grants one reserve and then halts again", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 1, day: null } });
    try {
      const blocked = await postChat(sidecar, { idempotencyKey: "allow-0", runId: "run-allow" });
      assert.equal(blocked.status, 402);
      assert.equal(blocked.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(blocked.json.error.halt, true);
      assert.equal(blocked.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 0);

      const spend = await fetch(`${sidecar.baseURL}/v1/operator/allowances`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key" },
        body: JSON.stringify({ scope: "run", key: "run-allow", grant_micros: 5_000_000, reason: "ticket 9" }),
      });
      assert.equal(spend.status, 401);

      const poisoned = await fetch(`${sidecar.baseURL}/v1/operator/allowances`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_operator" },
        body: JSON.stringify({
          scope: "run",
          key: "run-allow",
          grant_micros: 5_000_000,
          reason: "no",
          retryable: true,
        }),
      });
      assert.equal(poisoned.status, 400);

      const grant = await fetch(`${sidecar.baseURL}/v1/operator/allowances`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_operator" },
        body: JSON.stringify({ scope: "run", key: "run-allow", grant_micros: 5_000_000, reason: "ticket 9" }),
      });
      const granted = await grant.json();
      assert.equal(grant.status, 200);
      assert.equal(granted.exhaust.retryable, false);
      assert.equal(granted.exhaust.halt, true);
      assert.equal(granted.allowance.state, "open");

      const once = await postChat(sidecar, { idempotencyKey: "allow-1", runId: "run-allow" });
      assert.equal(once.status, 200);
      assert.equal(sidecar.mock.forwardCount, 1);
      const again = await postChat(sidecar, { idempotencyKey: "allow-2", runId: "run-allow" });
      assert.equal(again.status, 402);
      assert.equal(again.json.error.code, "BUDGET_EXHAUSTED");
      assert.equal(again.json.error.halt, true);
      assert.equal(again.json.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 1);
    } finally {
      await sidecar.close();
    }
  });

  it("governs an Anthropic-shaped messages call with the same halt", async () => {
    const sidecar = await bootSidecar({ caps: { user: null, run: 1, day: null } });
    try {
      const headers = {
        "content-type": "application/json",
        "x-burnbrake-key": "bb_test_key",
        "x-burnbrake-run-id": "run-ant",
        "idempotency-key": "ant-deny",
      };
      const denied = await fetch(`${sidecar.baseURL}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const deniedBody = await denied.json();
      assert.equal(denied.status, 402);
      assert.equal(deniedBody.error.code, "BUDGET_EXHAUSTED");
      assert.equal(deniedBody.error.halt, true);
      assert.equal(deniedBody.error.retryable, false);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }

    const live = await bootSidecar({ caps: { user: null, run: 50_000_000, day: null } });
    try {
      const response = await fetch(`${live.baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-burnbrake-key": "bb_test_key",
          "x-burnbrake-run-id": "run-ant-ok",
          "idempotency-key": "ant-ok",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 16,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.type, "message");
      assert.equal(body.id, "msg_mock");
      assert.equal(typeof body.usage.input_tokens, "number");
      assert.equal(live.mock.lastRoute, "/v1/messages");
      assert.equal(live.mock.forwardCount, 1);
      const client = new BurnBrake({ baseURL: live.baseURL, apiKey: "bb_test_key" });
      const viaSdk = (await client.messages.create(
        { model: "claude-3-5-haiku-latest", max_tokens: 16, messages: [{ role: "user", content: "again" }] },
        { idempotencyKey: "ant-sdk", runId: "run-ant-ok" },
      )) as { id: string };
      assert.equal(viaSdk.id, "msg_mock");
      assert.equal(live.mock.forwardCount, 2);
      const unknown = await fetch(`${live.baseURL}/v1/models`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key" },
        body: "{}",
      });
      const unknownBody = await unknown.json();
      assert.equal(unknown.status, 404);
      assert.equal(unknownBody.error.code, "ROUTE_NOT_GOVERNED");
      assert.equal(live.mock.forwardCount, 2);
    } finally {
      await live.close();
    }
  });

  it("replays an encrypted body and drops it after the shorter TTL", async () => {
    const key = deriveReplayKey("replay-secret-value");
    const sealed = sealReplayBody('{"id":"chatcmpl-mock"}', key);
    assert.equal(sealed.startsWith("bbenc1:"), true);
    assert.equal(sealed.includes("chatcmpl-mock"), false);
    assert.equal(openReplayBody(sealed, key), '{"id":"chatcmpl-mock"}');
    assert.equal(openReplayBody(sealed, null), null);
    assert.equal(openReplayBody('{"id":"plain"}', key), '{"id":"plain"}');

    const sidecar = await bootSidecar({
      env: { BURNBRAKE_REPLAY_KEY: "replay-secret-value" },
      caps: { user: null, run: 50_000_000, day: null },
    });
    try {
      const first = await postChat(sidecar, { idempotencyKey: "enc-1", runId: "run-enc" });
      assert.equal(first.status, 200);
      const db = new DatabaseSync(sidecar.config.ledgerPath, { readOnly: true });
      const row = db.prepare("SELECT response_body FROM idempotency WHERE idem_key = ?").get("enc-1") as
        | { response_body: string }
        | undefined;
      db.close();
      assert.ok(row?.response_body.startsWith("bbenc1:"));
      assert.equal(row?.response_body.includes("chatcmpl-mock"), false);
      const replay = await postChat(sidecar, { idempotencyKey: "enc-1", runId: "run-enc" });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.id, first.json.id);
      assert.equal(sidecar.mock.forwardCount, 1);
      const health = await (await fetch(`${sidecar.baseURL}/health`)).json();
      assert.equal(health.replay.encrypted, true);
    } finally {
      await sidecar.close();
    }

    let now = Date.parse("2026-09-30T00:00:00Z");
    const short = await bootSidecar({
      env: { BURNBRAKE_IDEMPOTENCY_BODY_TTL_MS: "1000" },
      now: () => now,
      caps: { user: null, run: 50_000_000, day: null },
    });
    try {
      const first = await postChat(short, { idempotencyKey: "ttl-1", runId: "run-ttl" });
      assert.equal(first.status, 200);
      const replay = await postChat(short, { idempotencyKey: "ttl-1", runId: "run-ttl" });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.id, first.json.id);
      now += 5_000;
      const gone = await postChat(short, { idempotencyKey: "ttl-1", runId: "run-ttl" });
      assert.equal(gone.status, 409);
      assert.equal(gone.json.error.code, "ALREADY_TERMINAL");
      assert.equal(short.mock.forwardCount, 1);
    } finally {
      await short.close();
    }

    assert.throws(
      () => loadConfig({ BURNBRAKE_KEY: "bb_test_key", BURNBRAKE_IDEMPOTENCY_BODY_TTL_MS: String(25 * 60 * 60 * 1000) }),
      /IDEMPOTENCY_BODY_TTL/,
    );
  });

  it("heartbeat proves the sidecar path only", async () => {
    const sidecar = await bootSidecar();
    try {
      const missing = await fetch(`${sidecar.baseURL}/v1/burnbrake/heartbeat`, { method: "POST" });
      assert.equal(missing.status, 401);
      const response = await fetch(`${sidecar.baseURL}/v1/burnbrake/heartbeat`, {
        method: "POST",
        headers: { "x-burnbrake-key": "bb_test_key" },
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.sidecar, true);
      assert.equal(body.stops_all_spend, false);
      assert.match(body.does_not_prove, /second client/i);
      assert.equal(sidecar.mock.forwardCount, 0);
      const client = new BurnBrake({ baseURL: sidecar.baseURL, apiKey: "bb_test_key" });
      const receipt = await client.heartbeat();
      assert.equal(receipt.stops_all_spend, false);
      assert.match(receipt.does_not_prove, /second client/i);
      assert.equal(sidecar.mock.forwardCount, 0);
    } finally {
      await sidecar.close();
    }
  });
});
