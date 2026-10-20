// Regression tests for the 2026-10-19 independent review.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { estimateRequest, costFromUsage } from "../../src/estimate.ts";
import { defaultPriceTablePath, defaultAnthropicPriceTablePath } from "../../src/config.ts";
import { loadPriceTable } from "../../src/prices.ts";
import { SseUsageTracker } from "../../src/upstream.ts";
import { bootSidecar } from "../helpers.ts";

const oa = loadPriceTable(defaultPriceTablePath());
const an = loadPriceTable(defaultAnthropicPriceTablePath());

async function fakeUpstream(handler: (body: any, res: ServerResponse) => void | Promise<void>) {
  const bodies: any[] = [];
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => { const b = raw ? JSON.parse(raw) : null; bodies.push(b); void handler(b, res); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, server, bodies };
}
const ev = (t: string, d: unknown) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
function post(base: string, route: string, body: unknown, h: Record<string, string> = {}) {
  return fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-p", ...h }, body: JSON.stringify(body) });
}
async function until(f: () => boolean, ms = 4000) { const t = Date.now() + ms; while (!f()) { if (Date.now() > t) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 10)); } }

describe("review regressions", () => {
  it("RACE: 20 concurrent streamed calls cannot all slip under the run cap", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const up = await fakeUpstream(async (_b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "x" } }] })}\n\n`);
      await gate;
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 5 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const body = { model: "gpt-4o-mini", stream: true, max_tokens: 2000, messages: [{ role: "user", content: "hi" }] };
    const est = estimateRequest(body, oa, 4096, "/v1/chat/completions"); assert.ok(est.ok);
    const cap = est.micros * 3 + 1;
    const sc = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test" }, caps: { user: null, run: cap, day: null } });
    try {
      const rs = await Promise.all(Array.from({ length: 20 }, () => post(sc.baseURL, "/v1/chat/completions", body)));
      const statuses = rs.map((r) => r.status);
      const ok = statuses.filter((s) => s === 200).length;
      assert.equal(ok, 3, `statuses ${statuses}`);
      assert.equal(up.bodies.length, 3);
      release(); await Promise.all(rs.map((r) => r.text()));
    } finally { release(); await sc.close(); up.server.close(); }
  });

  it("RACE: same idempotency key fired 10x concurrently during a stream forwards once", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const up = await fakeUpstream(async (_b, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "x" } }] })}\n\n`);
      await gate;
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 5 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const sc = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test" } });
    try {
      const body = { model: "gpt-4o-mini", stream: true, max_tokens: 200, messages: [{ role: "user", content: "hi" }] };
      const rs = await Promise.all(Array.from({ length: 10 }, () => post(sc.baseURL, "/v1/chat/completions", body, { "idempotency-key": "same" })));
      release(); await Promise.all(rs.map((r) => r.text()));
      assert.equal(up.bodies.length, 1);
      assert.equal(rs.filter((r) => r.status === 409).length, 9);
    } finally { release(); await sc.close(); up.server.close(); }
  });

  it("TOOL STREAM: OpenAI tool-call stream settles at reported usage", () => {
    const t = new SseUsageTracker();
    t.feed(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "f", arguments: "{\"a\":" } }] } }], usage: null })}\n\n`);
    t.feed(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: null })}\n\n`);
    t.feed(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
    t.end();
    assert.deepEqual(t.usage(), { prompt_tokens: 40, completion_tokens: 12 });
  });

  it("TOOL STREAM: Anthropic tool_use stream (input_json_delta) settles at reported usage", () => {
    const t = new SseUsageTracker();
    t.feed(ev("message_start", { type: "message_start", message: { usage: { input_tokens: 300, output_tokens: 1 } } }));
    t.feed(ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "f", input: {} } }));
    t.feed(ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"usage\":{\"output_tokens\":0}}" } }));
    t.feed(ev("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 90 } }));
    t.feed(ev("message_stop", { type: "message_stop" })); t.end();
    assert.deepEqual(t.usage(), { prompt_tokens: 300, completion_tokens: 90 });
  });

  it("USAGE MISSING: Anthropic message_stop without message_delta usage must not settle at message_start's placeholder output_tokens=1", () => {
    const t = new SseUsageTracker();
    t.feed(ev("message_start", { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } }));
    t.feed(ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "long answer ..." } }));
    t.feed(ev("message_stop", { type: "message_stop" })); t.end();
    assert.equal(t.usage(), null, `settled at ${JSON.stringify(t.usage())}`);
  });

  it("ESTIMATE: Anthropic tool_result content is counted in the reservation", () => {
    const big = "lorem ipsum ".repeat(40_000); // ~480k chars ≈ 120k tokens
    const e = estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 100, messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
    ] }, an, 4096, "/v1/messages");
    assert.ok(e.ok);
    assert.ok(e.inputTokens > 100_000, `inputTokens estimated ${e.inputTokens}`);
  });

  it("ESTIMATE: OpenAI tool definitions + assistant tool_calls arguments are counted", () => {
    const schema = { type: "object", properties: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`field_${i}`, { type: "string", description: "some long description of the field" }])) };
    const e = estimateRequest({ model: "gpt-4o-mini", max_tokens: 10, tools: [{ type: "function", function: { name: "f", parameters: schema } }], messages: [
      { role: "user", content: "x" },
      { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "y".repeat(200_000) } }] },
      { role: "tool", tool_call_id: "c", content: "ok" },
    ] }, oa, 4096, "/v1/chat/completions");
    assert.ok(e.ok);
    assert.ok(e.inputTokens > 50_000, `inputTokens estimated ${e.inputTokens}`);
  });

  it("UNKNOWN SURCHARGE: Anthropic server tool (web_search) is refused or priced", () => {
    const e = estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 100, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 50 }], messages: [{ role: "user", content: "hi" }] }, an, 4096, "/v1/messages");
    // Priced in prices/anthropic.yaml: the reservation covers all 50 searches.
    assert.ok(e.ok);
    assert.ok(e.micros >= 50 * an.serverTools.web_search!, `reserved ${e.micros}`);
    // Without max_uses the cost has no bound: refused.
    const unbounded = estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 100, tools: [{ type: "web_search_20250305", name: "web_search" }], messages: [{ role: "user", content: "hi" }] }, an, 4096, "/v1/messages");
    assert.equal(unbounded.ok, false);
    assert.equal(!unbounded.ok && unbounded.code, "UNKNOWN_SURCHARGE");
    // A server tool the table doesn't price: refused.
    const other = estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 100, tools: [{ type: "code_execution_20250522", name: "code_execution" }], messages: [{ role: "user", content: "hi" }] }, an, 4096, "/v1/messages");
    assert.equal(!other.ok && other.code, "UNKNOWN_SURCHARGE");
  });

  it("settle charges the reported server-tool requests; an unpriced one charges the estimate", () => {
    const base = { prompt_tokens: 0, completion_tokens: 0 };
    assert.equal(costFromUsage(an, "claude-3-5-haiku-latest", { ...base, server_tool_requests: { web_search: 3 } }, 0), 3 * an.serverTools.web_search!);
    assert.equal(costFromUsage(an, "claude-3-5-haiku-latest", { ...base, server_tool_requests: { web_fetch: 1 } }, 0), null);
    const t = new SseUsageTracker();
    t.feed(ev("message_start", { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } }));
    t.feed(ev("message_delta", { type: "message_delta", usage: { output_tokens: 20, server_tool_use: { web_search_requests: 2 } } }));
    t.feed(ev("message_stop", { type: "message_stop" }));
    assert.deepEqual(t.usage(), { prompt_tokens: 10, completion_tokens: 20, server_tool_requests: { web_search: 2 } });
  });

  it("OpenAI: web_search_options and non-function tools are refused; include_usage is always on", () => {
    const msg = [{ role: "user", content: "hi" }];
    const ws = estimateRequest({ model: "gpt-4o-mini", messages: msg, web_search_options: {} }, oa, 4096, "/v1/chat/completions");
    assert.equal(!ws.ok && ws.code, "UNKNOWN_SURCHARGE");
    const fs = estimateRequest({ model: "gpt-4o-mini", messages: msg, tools: [{ type: "file_search" }] }, oa, 4096, "/v1/chat/completions");
    assert.equal(!fs.ok && fs.code, "UNKNOWN_SURCHARGE");
    const st = estimateRequest({ model: "gpt-4o-mini", messages: msg, stream: true, stream_options: { include_usage: false } }, oa, 4096, "/v1/chat/completions");
    assert.ok(st.ok);
    assert.deepEqual(st.forwardBody.stream_options, { include_usage: true });
  });

  it("non-Latin text is not under-counted (UTF-8 bytes / 3)", () => {
    const text = "日本語".repeat(1000); // 3,000 chars, 9,000 bytes
    const e = estimateRequest({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: text }] }, oa, 4096, "/v1/chat/completions");
    assert.ok(e.ok && e.inputTokens >= 3000, `inputTokens ${e.ok && e.inputTokens}`);
  });

  it("thinking and tool-result images in history are priced, not refused", () => {
    const e = estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 10, messages: [
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "thinking", thinking: "x".repeat(3000), signature: "s" }, { type: "tool_use", id: "t1", name: "read", input: { path: "a" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(100) } }] }] },
    ] }, an, 4096, "/v1/messages");
    assert.ok(e.ok);
    assert.ok(e.inputTokens >= 1000 + 1600, `inputTokens ${e.inputTokens}`);
  });

  it("OVERSHOOT: concurrent under-estimated calls overshoot the cap by more than one call", async () => {
    const big = "word ".repeat(100_000); // tool_result not counted
    const up = await fakeUpstream(async (_b, res) => {
      await new Promise((r) => setTimeout(r, 200));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(ev("message_start", { type: "message_start", message: { usage: { input_tokens: 130_000, output_tokens: 1 } } }));
      res.write(ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 } }));
      res.end(ev("message_stop", { type: "message_stop" }));
    });
    const body = { model: "claude-3-5-haiku-latest", stream: true, max_tokens: 100, messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] } ] };
    const est = estimateRequest(body, an, 4096, "/v1/messages"); assert.ok(est.ok);
    const actual = costFromUsage(an, "claude-3-5-haiku-latest", { prompt_tokens: 130_000, completion_tokens: 50 }, est.flatMicros)!;
    const cap = est.micros * 10;
    const sc = await bootSidecar({ mockUpstream: false, env: { BURNBRAKE_ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: "sk-ant-test" }, caps: { user: null, run: cap, day: null } });
    try {
      const rs = await Promise.all(Array.from({ length: 10 }, () => post(sc.baseURL, "/v1/messages", body)));
      await Promise.all(rs.map((r) => r.text()));
      await until(() => sc.ledger.balances({ runId: "run-p" }).scopes.find((s) => s.scope === "run")!.spent_micros > 0);
      await new Promise((r) => setTimeout(r, 300));
      const spent = sc.ledger.balances({ runId: "run-p" }).scopes.find((s) => s.scope === "run")!.spent_micros;
      console.log(JSON.stringify({ estMicros: est.micros, actualPerCall: actual, cap, spent, forwarded: up.bodies.length, ratio: spent / cap }));
      assert.ok(spent <= cap + actual, `spent ${spent} vs cap ${cap} (one-call overshoot bound ${cap + actual})`);
    } finally { await sc.close(); up.server.close(); }
  });
});
