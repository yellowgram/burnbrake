// How a forwarded call settles its input. The input estimate only sizes the hold; at settle the
// call is charged the provider-reported usage (src/server.ts settleForwarded: costFromUsage of
// the reported usage, then ledger.settle). An under-estimate is charged at the reported count and
// the excess over the hold is recorded as overshoot and debt (it blocks the next call on a capped
// scope); an over-estimate is charged at the reported count too (not max(reported, estimate)).
// Without reported usage the call is charged its whole hold.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { describe, it } from "node:test";
import { getEncoding } from "js-tiktoken";
import { costFromUsage, estimateRequest } from "../src/estimate.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { loadPriceTable } from "../src/prices.ts";
import { bootSidecar } from "./helpers.ts";

const table = loadPriceTable(defaultPriceTablePath());
const MODEL = "gpt-4o-mini";

async function fakeOpenAI(usage: Record<string, number> | null): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "chatcmpl-1", object: "chat.completion", model: MODEL, choices: [{ index: 0, message: { role: "assistant", content: "x" }, finish_reason: "length" }], ...(usage ? { usage } : {}) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server };
}

const body = (content: string) => ({ model: MODEL, max_tokens: 1, messages: [{ role: "user", content }] });
const post = (baseURL: string, content: string, key: string) =>
  fetch(`${baseURL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-settle", "idempotency-key": key },
    body: JSON.stringify(body(content)),
  });

describe("input settles at the provider-reported usage", () => {
  it("an under-estimated prompt is charged the reported count; the excess is debt that blocks the next call", async () => {
    // A documented synthetic limit: one short pseudo-word repeated as separate words.
    const content = " lelel".repeat(1000);
    const estimate = estimateRequest(body(content), table, 4096, "/v1/chat/completions");
    const promptTokens = getEncoding("cl100k_base").encode(content).length + 7; // the real count, chat framing included
    assert.ok(estimate.inputTokens < promptTokens, `premise: estimate ${estimate.inputTokens} is under the real ${promptTokens}`);
    const usage = { prompt_tokens: promptTokens, completion_tokens: 1 };
    const actual = costFromUsage(table, MODEL, usage, 0)!;
    assert.ok(actual > estimate.micros);

    const up = await fakeOpenAI(usage);
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" }, caps: { user: null, run: estimate.micros + 1, day: null } });
    try {
      const first = await post(sidecar.baseURL, content, "settle-under-1");
      assert.equal(first.status, 200);
      const reservation = sidecar.ledger.getReservation(first.headers.get("x-burnbrake-reservation-id")!)!;
      assert.equal(reservation.estimate_micros, estimate.micros);
      assert.equal(reservation.actual_micros, actual); // the reported usage, not the estimate
      const run = sidecar.ledger.balances({ runId: "run-settle" }).scopes.find((s) => s.scope === "run")!;
      assert.equal(run.spent_micros, actual);
      assert.equal(run.overshoot_micros, actual - estimate.micros);
      assert.equal(run.debt_micros, actual - (estimate.micros + 1));
      assert.equal(sidecar.ledger.estimateErrorSummary().under_reserve, 1);

      const second = await post(sidecar.baseURL, content, "settle-under-2");
      assert.equal(second.status, 402); // the debt blocks the next call
      assert.equal(sidecar.ledger.balances({ runId: "run-settle" }).scopes.find((s) => s.scope === "run")!.spent_micros, actual);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("an over-estimated prompt is charged the reported count too (not the larger estimate)", async () => {
    const content = "hello there";
    const estimate = estimateRequest(body(content), table, 4096, "/v1/chat/completions");
    const usage = { prompt_tokens: 3, completion_tokens: 1 };
    const actual = costFromUsage(table, MODEL, usage, 0)!;
    assert.ok(actual < estimate.micros);
    const up = await fakeOpenAI(usage);
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const res = await post(sidecar.baseURL, content, "settle-over-1");
      assert.equal(res.status, 200);
      const run = sidecar.ledger.balances({ runId: "run-settle" }).scopes.find((s) => s.scope === "run")!;
      assert.equal(run.spent_micros, actual);
      assert.equal(run.held_micros, 0);
      assert.equal(run.overshoot_micros, 0);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("a response without usage is charged the whole hold (the estimate)", async () => {
    const content = " lelel".repeat(1000);
    const estimate = estimateRequest(body(content), table, 4096, "/v1/chat/completions");
    const up = await fakeOpenAI(null);
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const res = await post(sidecar.baseURL, content, "settle-none-1");
      assert.equal(res.status, 200);
      const run = sidecar.ledger.balances({ runId: "run-settle" }).scopes.find((s) => s.scope === "run")!;
      assert.equal(run.spent_micros, estimate.micros);
      assert.equal(run.held_micros, 0);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });
});
