import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { defaultAnthropicPriceTablePath, defaultPriceTablePath, loadConfig, readStreamKill } from "../src/config.ts";
import { execute } from "../src/cli.ts";
import { costFromUsage, estimateRequest, generatedTextTokens, type GovernedRoute } from "../src/estimate.ts";
import { Ledger } from "../src/ledger.ts";
import { loadPriceTable } from "../src/prices.ts";
import { eventData, SseEventFramer, StreamMeter } from "../src/stream-meter.ts";
import { bootSidecar, tempLedgerPath } from "./helpers.ts";

// Price tables with one model at 1 micro per token in and out, so every expected
// number below is a token count.
const dir = mkdtempSync(join(tmpdir(), "bb-kill-"));
const OPENAI_TABLE = join(dir, "openai.yaml");
const ANTHROPIC_TABLE = join(dir, "anthropic.yaml");
const unitModel = (name: string) => `models:\n  ${name}:\n    input_micros_per_million: 1000000\n    output_micros_per_million: 1000000\n`;
writeFileSync(OPENAI_TABLE, readFileSync(defaultPriceTablePath(), "utf8").replace(/^models:\n/m, unitModel("meter-1")));
writeFileSync(ANTHROPIC_TABLE, readFileSync(defaultAnthropicPriceTablePath(), "utf8").replace(/^models:\n/m, unitModel("claude-meter")));
const openaiTable = loadPriceTable(OPENAI_TABLE);
const anthropicTable = loadPriceTable(ANTHROPIC_TABLE);

const CHAT = "/v1/chat/completions";
const MESSAGES = "/v1/messages";
// Every fake stream below stays inside max_tokens, as a real provider does. Cuts come only from
// what the reservation can't know in advance: a prompt bigger than estimated (input or cache
// writes), extra server-tool calls, or the provider's own usage report.
const MAX = 40;
const chatBody = (extra: Record<string, unknown> = {}) => ({ model: "meter-1", stream: true, max_tokens: MAX, messages: [{ role: "user", content: "hi" }], ...extra });
const msgBody = (extra: Record<string, unknown> = {}) => ({ model: "claude-meter", stream: true, max_tokens: MAX, messages: [{ role: "user", content: "hi" }], ...extra });
/** One real token that the meter counts as several (15 UTF-8 bytes): the meter errs high. */
const WORDY = "日本語です";

function estimateOf(route: GovernedRoute, body: Record<string, unknown>) {
  const e = estimateRequest(body, route === MESSAGES ? anthropicTable : openaiTable, 4096, route);
  if (!e.ok) throw new Error(e.message);
  return e;
}

// ---------- fake upstream ----------

interface Upstream {
  url: string;
  server: Server;
  /** Chunks the fake managed to write before BurnBrake closed the connection. */
  written: () => number;
  closedEarly: () => boolean;
  requests: () => number;
}

/** Writes `chunks` one by one, `gapMs` apart, and stops as soon as the proxy hangs up. */
async function fakeUpstream(chunks: (string | Buffer)[] | ((n: number) => (string | Buffer)[]), opts: { gapMs?: number; end?: boolean; beforeChunk?: (i: number) => Promise<void> | void } = {}): Promise<Upstream> {
  let written = 0;
  let closedEarly = false;
  let requests = 0;
  const server = createServer((req, res: ServerResponse) => {
    req.resume();
    req.on("end", async () => {
      requests += 1;
      const list = typeof chunks === "function" ? chunks(requests) : chunks;
      let open = true;
      res.on("close", () => {
        if (!res.writableFinished) {
          closedEarly = true;
          open = false;
        }
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 0; i < list.length && open; i++) {
        await opts.beforeChunk?.(i);
        if (!open) break;
        res.write(list[i]);
        written += 1;
        if (opts.gapMs !== 0) await new Promise((r) => setTimeout(r, opts.gapMs ?? 2));
      }
      if (!open) return;
      if (opts.end === false) res.destroy();
      else res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    server,
    written: () => written,
    closedEarly: () => closedEarly,
    requests: () => requests,
  };
}

const oa = (delta: Record<string, unknown>, index = 0) => `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index, delta }] })}\n\n`;
const oaUsage = (prompt: number, completion: number) => `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`;
const DONE = "data: [DONE]\n\n";
/** A chunk with content and the provider's running usage (some OpenAI-compatible servers send it on every chunk). */
const oaRunning = (prompt: number, completion: number, delta: Record<string, unknown> = { content: "a" }) =>
  `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta }], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`;
/** A usage-only chunk sent before any content: the prompt size, reported up front. */
const oaPrompt = (prompt: number) => oaUsage(prompt, 0);
const an = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const anStart = (input: number, extra: Record<string, unknown> = {}) =>
  an("message_start", { message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "claude-meter", stop_reason: null, usage: { input_tokens: input, output_tokens: 1, ...extra } } });
const anBlock = (index = 0, block: Record<string, unknown> = { type: "text", text: "" }) => an("content_block_start", { index, content_block: block });
const anText = (text: string, index = 0) => an("content_block_delta", { index, delta: { type: "text_delta", text } });
const anEnd = (output: number) => [an("content_block_stop", { index: 0 }), an("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } }), an("message_stop", {})];

async function boot(up: Upstream | null, cap: number, env: Record<string, string> = {}, runCapOnly = true) {
  return bootSidecar({
    mockUpstream: false,
    upstreamBaseURL: up?.url ?? "http://127.0.0.1:9",
    priceTablePath: OPENAI_TABLE,
    caps: runCapOnly ? { user: null, run: cap, day: null } : { user: cap, run: cap, day: cap },
    env: {
      OPENAI_API_KEY: "sk-test-upstream",
      ANTHROPIC_API_KEY: "sk-ant-test-upstream",
      BURNBRAKE_ANTHROPIC_BASE_URL: up?.url ?? "http://127.0.0.1:9",
      BURNBRAKE_ANTHROPIC_PRICE_TABLE: ANTHROPIC_TABLE,
      BURNBRAKE_STREAM_KILL: "",
      ...env,
    },
  });
}

async function call(baseURL: string, route: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseURL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-k", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, events: text.split(/\r?\n\r?\n/).filter((e) => e.trim() !== "") };
}

const run = (sc: Awaited<ReturnType<typeof boot>>, runId = "run-k") => sc.ledger.balances({ runId }).scopes.find((s) => s.scope === "run")!;
const dataOf = (event: string) => JSON.parse(event.split(/\r?\n/).find((l) => l.startsWith("data:"))!.slice(5));
const contentChunks = (events: string[]) => events.filter((e) => e.includes('"content":"')).length;
const textDeltas = (events: string[]) => events.filter((e) => e.includes("text_delta")).length;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The last event must be the terminal error event; returns its error object (an assertion, not a parse crash). */
function cutError(events: string[]): Record<string, any> {
  const last = events.at(-1) ?? "";
  assert.match(last, /^(event: error\r?\n)?data: \{"(type":"error","error|error)":/, `last event is not an error event: ${last.slice(0, 120)}`);
  const body = dataOf(last);
  return body.type === "error" ? body.error : body.error;
}
/**
 * R14: once BurnBrake cuts, the provider connection is closed and the provider stops writing.
 * Waits long enough for an un-aborted fake to finish its whole stream, then asserts it didn't.
 */
async function assertProviderClosed(up: Upstream, total: number, forwarded: number): Promise<void> {
  await sleep(250);
  assert.equal(up.closedEarly(), true, "BurnBrake did not close the provider stream");
  assert.ok(up.written() < total, `the provider wrote its whole stream (${up.written()}/${total})`);
  assert.ok(up.written() <= forwarded + 1 + 8, `the provider kept writing after the cut: ${up.written()} written, ${forwarded} forwarded`);
}

async function eventually(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  for (const c of cleanups) await c();
});
function track<T extends { close?: () => Promise<void> }>(sc: T, up?: Upstream | null): T {
  cleanups.push(async () => {
    if (up) {
      up.server.closeAllConnections();
      up.server.close();
    }
    await sc.close?.();
  });
  return sc;
}

// ---------- OpenAI-style ----------

describe("mid-stream kill: OpenAI-style chunks", () => {
  const est = estimateOf(CHAT, chatBody());
  const S = 20; // the real prompt is S tokens bigger than the estimate

  it("the reservation is input estimate + max_tokens output (unit prices)", () => {
    assert.equal(est.outputTokens, MAX);
    assert.equal(est.micros, est.inputTokens + MAX);
    assert.ok(generatedTextTokens(WORDY) >= 3, "the meter must over-count WORDY for the next tests to mean anything");
  });

  it("a stream inside its own reservation is never cut, however high the meter counts its output (R4-1)", async () => {
    // 40 chunks of one real token each, counted as 5 each: 200 counted against max_tokens 40.
    const stream = [...Array.from({ length: MAX }, () => oa({ content: WORDY })), oaUsage(est.inputTokens, MAX), DONE];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros), up); // the budget is exactly this call's reservation
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(r.text, stream.join(""));
    const scope = run(sc);
    assert.equal(scope.spent_micros, est.micros);
    assert.equal(scope.overshoot_micros, 0);
    assert.equal(scope.held_micros, 0);
    assert.equal(sc.ledger.listDecisions({ runId: "run-k", limit: 1 })[0].code, "OK");
  });

  it("a prompt bigger than estimated (running usage): cut before the crossing chunk, one error chunk, no [DONE], provider closed, charged input + the whole output allowance", async () => {
    const prompt = est.inputTokens + S;
    const stream = [...Array.from({ length: MAX }, (_, i) => oaRunning(prompt, i + 1)), oaUsage(prompt, MAX), DONE];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(r.status, 200);
    // prompt + k > reservation once k > MAX - S: the chunk that would make it MAX - S + 1 is withheld.
    assert.equal(contentChunks(r.events), MAX - S);
    assert.ok(!r.text.includes("[DONE]"), "no [DONE] after a cut");
    assert.ok(!/^event:/m.test(r.events.at(-1)!), "OpenAI-style error chunk has no event: line");
    const err = cutError(r.events);
    assert.equal(err.type, "budget_exhausted");
    assert.equal(err.code, "BUDGET_EXHAUSTED");
    assert.equal(err.halt, true);
    assert.equal(err.retryable, false);
    assert.equal(err.stream_cut, true);
    assert.equal(err.scope, "run");
    // R4-2: the real input, plus all of max_tokens (output billed but not yet streamed is covered).
    const charged = prompt + MAX;
    assert.equal(err.charged_micros, charged);
    await assertProviderClosed(up, stream.length, MAX - S);
    const scope = run(sc);
    assert.equal(scope.spent_micros, charged);
    assert.equal(scope.held_micros, 0);
    const d = sc.ledger.listDecisions({ runId: "run-k", limit: 1 })[0];
    assert.equal(d.code, "STREAM_CUT_BUDGET_EXHAUSTED");
    assert.equal(d.settled_micros, charged);
    assert.equal(d.scope, "run");
    const row = sc.ledger.getReservation(d.reservation_id!)!;
    assert.equal(row.state, "SETTLED");
    assert.equal(row.actual_micros, charged);
  });

  it("a stream that lands exactly on the budget is not cut and is passed through byte for byte", async () => {
    const prompt = est.inputTokens + S;
    const stream = [...Array.from({ length: MAX }, (_, i) => oaRunning(prompt, i + 1)), oaUsage(prompt, MAX), DONE];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros + S), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(r.text, stream.join(""));
    const scope = run(sc);
    assert.equal(scope.spent_micros, est.micros + S);
    assert.equal(scope.remaining_micros, 0);
    assert.equal(scope.overshoot_micros, 0);
    assert.equal(scope.held_micros, 0);
  });

  it("one token past the budget is cut at the last chunk", async () => {
    const prompt = est.inputTokens + S;
    const up = await fakeUpstream([...Array.from({ length: MAX }, (_, i) => oaRunning(prompt, i + 1)), oaUsage(prompt, MAX), DONE]);
    const sc = track(await boot(up, est.micros + S - 1), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(contentChunks(r.events), MAX - 1);
    assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
  });

  it("with the prompt reported up front, content, refusal, reasoning_content and tool-call arguments all count as output", async () => {
    const big = 30; // prompt + counted > reservation once counted > MAX - big
    const kinds: Array<[string, Record<string, unknown>, string]> = [
      ["content", { content: "a" }, '"content":"a"'],
      ["refusal", { refusal: "a" }, '"refusal":"a"'],
      ["reasoning_content", { reasoning_content: "a" }, '"reasoning_content":"a"'],
      ["tool-call arguments", { tool_calls: [{ index: 0, function: { arguments: "a" } }] }, '"arguments":"a"'],
    ];
    for (const [name, delta, marker] of kinds) {
      const up = await fakeUpstream([oaPrompt(est.inputTokens + big), ...Array.from({ length: 20 }, () => oa(delta)), oaUsage(est.inputTokens + big, 20), DONE]);
      const sc = track(await boot(up, est.micros), up);
      const r = await call(sc.baseURL, CHAT, chatBody());
      assert.equal(r.events.filter((e) => e.includes(marker)).length, MAX - big, name);
      assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED", name);
    }
  });

  it("/v1/completions text chunks count as output", async () => {
    const body = { model: "meter-1", stream: true, max_tokens: MAX, prompt: "hi" };
    const e = estimateOf("/v1/completions", body);
    const big = 30;
    const usage = (prompt: number, completion: number) =>
      `data: ${JSON.stringify({ object: "text_completion", choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })}\n\n`;
    const chunk = `data: ${JSON.stringify({ object: "text_completion", choices: [{ index: 0, text: "a" }] })}\n\n`;
    const up = await fakeUpstream([usage(e.inputTokens + big, 0), ...Array.from({ length: 20 }, () => chunk), usage(e.inputTokens + big, 20), DONE]);
    const sc = track(await boot(up, e.micros), up);
    const r = await call(sc.baseURL, "/v1/completions", body);
    assert.equal(r.events.filter((x) => x.includes('"text":"a"')).length, MAX - big);
    assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
  });

  it("a final usage chunk never triggers a cut: generation is over, so it settles at the reported usage", async () => {
    // OpenAI's include_usage chunk is the first time the real prompt size is known.
    const stream = [...Array.from({ length: 5 }, () => oa({ content: "a" })), oaUsage(est.inputTokens + 300, 5), DONE];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros + 10), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(r.text, stream.join(""));
    assert.equal(run(sc).spent_micros, est.inputTokens + 305);
    assert.equal(sc.ledger.listDecisions({ runId: "run-k", limit: 1 })[0].code, "OK");
  });
});

// ---------- Anthropic ----------

describe("mid-stream kill: Anthropic Messages", () => {
  const est = estimateOf(MESSAGES, msgBody());

  it("a stream inside its own reservation is never cut, however high the meter counts its output (R4-1)", async () => {
    const stream = [anStart(est.inputTokens), anBlock(), ...Array.from({ length: MAX }, () => anText(WORDY)), ...anEnd(MAX)];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.text, stream.join(""));
    assert.equal(run(sc).spent_micros, est.micros);
    assert.equal(run(sc).overshoot_micros, 0);
  });

  it("a prompt bigger than estimated (message_start): text deltas count, cut with an Anthropic error event, no message_stop, charged input + the whole output allowance", async () => {
    const input = est.inputTokens + 30;
    const stream = [anStart(input), anBlock(), ...Array.from({ length: 30 }, () => anText("a")), ...anEnd(30)];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(textDeltas(r.events), MAX - 30);
    const last = r.events.at(-1)!;
    assert.match(last, /^event: error\r?\ndata: /);
    const body = dataOf(last);
    assert.equal(body.type, "error");
    assert.equal(body.error.type, "budget_exhausted");
    assert.equal(body.error.code, "BUDGET_EXHAUSTED");
    assert.equal(body.error.charged_micros, input + MAX);
    assert.ok(!r.text.includes("message_stop"));
    assert.ok(!r.text.includes("message_delta"));
    assert.ok(!r.text.includes("[DONE]"));
    await assertProviderClosed(up, stream.length, 2 + MAX - 30);
    assert.equal(run(sc).spent_micros, input + MAX);
    assert.equal(run(sc).held_micros, 0);
  });

  it("a prompt bigger than the whole budget is cut at message_start: nothing is forwarded", async () => {
    const input = est.micros + 30;
    const up = await fakeUpstream([anStart(input), anBlock(), anText("a"), ...anEnd(1)]);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.events.length, 1, r.text);
    assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
    assert.equal(run(sc).spent_micros, input + MAX);
  });

  it("a prompt bigger than estimated is fine while the budget has room: the hold grows and the stream completes", async () => {
    const stream = [anStart(est.inputTokens + 30), anBlock(), ...Array.from({ length: MAX }, () => anText("a")), ...anEnd(MAX)];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros + 30), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.text, stream.join(""));
    const scope = run(sc);
    assert.equal(scope.spent_micros, est.micros + 30);
    assert.equal(scope.held_micros, 0); // the extension is released too
    assert.equal(scope.overshoot_micros, 0); // settled inside the extended hold
  });

  it("cache writes count at their price: a prompt that writes the cache can cross", async () => {
    const writes = Math.ceil((est.inputTokens + 30 - 1) / 2); // no breakdown: written as 2x input
    const inputEq = 1 + 2 * writes;
    const up = await fakeUpstream([anStart(1, { cache_creation_input_tokens: writes }), anBlock(), ...Array.from({ length: 30 }, () => anText("a")), ...anEnd(30)]);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(textDeltas(r.events), est.inputTokens + MAX - inputEq);
    assert.equal(cutError(r.events).charged_micros, inputEq + MAX);
  });

  it("cache reads count at 0.1x: a prompt with more tokens than estimated, mostly cached, is not cut", async () => {
    const stream = [anStart(1, { cache_read_input_tokens: 5 * est.inputTokens }), anBlock(), ...Array.from({ length: MAX }, () => anText("a")), ...anEnd(MAX)];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.text, stream.join(""));
  });

  it("the provider's mid-stream output count (hidden thinking) counts, and can cut", async () => {
    const input = est.inputTokens + 20;
    const thinking = an("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "t" } });
    const midDelta = an("message_delta", { delta: { stop_reason: null }, usage: { output_tokens: 30 } });
    const up = await fakeUpstream([anStart(input), anBlock(0, { type: "thinking", thinking: "" }), thinking, thinking, midDelta, anBlock(1), ...Array.from({ length: 10 }, () => anText("a", 1)), ...anEnd(40)]);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.events.filter((e) => e.includes("thinking_delta")).length, 2);
    assert.ok(!r.text.includes('"output_tokens":30'), "the crossing event is not forwarded");
    assert.equal(textDeltas(r.events), 0);
    assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
    assert.equal(run(sc).spent_micros, input + MAX);
  });

  it("the final message_delta (stop_reason set) never cuts, even when it reports a bigger prompt", async () => {
    const end = [an("content_block_stop", { index: 0 }), an("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { input_tokens: est.inputTokens + 300, output_tokens: 1 } }), an("message_stop", {})];
    const stream = [anStart(est.inputTokens), anBlock(), anText("a"), ...end];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros + 5), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.text, stream.join(""));
    assert.equal(sc.ledger.listDecisions({ runId: "run-k", limit: 1 })[0].code, "OK");
  });

  it("thinking, a tool_use name and tool-input JSON deltas count as output", async () => {
    const input = est.inputTokens + 30; // room for MAX - 30 = 10 counted output tokens; message_start reports 1
    const NAME = "lookup";
    const thinking = an("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "t" } });
    const json = an("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{" } });
    const up = await fakeUpstream([
      anStart(input),
      anBlock(0, { type: "thinking", thinking: "" }),
      ...Array.from({ length: 4 }, () => thinking),
      anBlock(1, { type: "tool_use", id: "t1", name: NAME, input: {} }),
      ...Array.from({ length: 20 }, () => json),
      ...anEnd(30),
    ]);
    const sc = track(await boot(up, est.micros), up);
    const r = await call(sc.baseURL, MESSAGES, msgBody());
    assert.equal(r.events.filter((e) => e.includes("thinking_delta")).length, 4);
    assert.equal(r.events.filter((e) => e.includes("input_json_delta")).length, MAX - 30 - 4 - generatedTextTokens(NAME));
    assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
  });

  it("server-tool blocks count as billed requests: a second search past the reserved one is cut", async () => {
    const body = msgBody({ tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] });
    const e = estimateOf(MESSAGES, body);
    const st = (i: number) => anBlock(i, { type: "server_tool_use", id: `s${i}`, name: "web_search", input: {} });
    const up = await fakeUpstream([anStart(e.inputTokens), st(0), anText("a"), st(1), anText("b"), ...anEnd(2)]);
    const sc = track(await boot(up, e.micros), up);
    const r = await call(sc.baseURL, MESSAGES, body);
    assert.equal(r.events.filter((x) => x.includes("server_tool_use")).length, 1);
    const err = cutError(r.events);
    assert.equal(err.code, "BUDGET_EXHAUSTED");
    const expected = costFromUsage(anthropicTable, "claude-meter", { prompt_tokens: e.inputTokens, completion_tokens: e.outputTokens, server_tool_requests: { web_search: 2 } }, e.flatMicros);
    assert.equal(err.charged_micros, expected);
    assert.ok(expected! > e.micros);
  });
});

// ---------- partial chunks ----------

describe("mid-stream kill: partial chunks", () => {
  const est = estimateOf(CHAT, chatBody());
  // CRLF and LF separators, multi-byte UTF-8, a comment line.
  const content = [
    ": keep-alive\r\n\r\n",
    oa({ role: "assistant", content: "" }),
    ...["é", "日本", "a", "Ω", "b"].map((t) => oa({ content: t }).replace(/\n\n$/, "\r\n\r\n")),
    ...Array.from({ length: 20 }, (_, i) => oa({ content: i % 2 ? "x" : "é" })),
  ];
  const piecesOf = (whole: Buffer) => {
    // Deterministic 1–3 byte pieces: splits lines, separators and UTF-8 sequences.
    const pieces: Buffer[] = [];
    for (let i = 0, n = 0; i < whole.length; n++) {
      const len = 1 + (n % 3);
      pieces.push(whole.subarray(i, i + len));
      i += len;
    }
    return pieces;
  };

  it("a stream split into 1–3 byte pieces arrives byte for byte", async () => {
    const whole = Buffer.from([...content, oaUsage(est.inputTokens, 25), DONE].join(""), "utf8");
    const up = await fakeUpstream(piecesOf(whole), { gapMs: 0, beforeChunk: (i) => (i % 7 === 0 ? new Promise((r) => setTimeout(r, 1)) : undefined) });
    const sc = track(await boot(up, est.micros + 1000), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.equal(Buffer.from(r.text, "utf8").equals(whole), true);
    assert.equal(run(sc).spent_micros, est.inputTokens + 25);
  });

  it("the cut lands on the same event whether the stream arrives whole or in pieces", async () => {
    const whole = Buffer.from([oaPrompt(est.inputTokens + 30), ...content, oaUsage(est.inputTokens + 30, 25), DONE].join(""), "utf8");
    const results: Array<{ text: string; spent: number }> = [];
    for (const chunks of [[whole], piecesOf(whole)]) {
      const up = await fakeUpstream(chunks, { gapMs: 0, beforeChunk: (i) => (i % 5 === 0 ? new Promise((r) => setTimeout(r, 1)) : undefined) });
      const sc = track(await boot(up, est.micros), up);
      const r = await call(sc.baseURL, CHAT, chatBody());
      assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
      results.push({ text: r.text, spent: run(sc).spent_micros });
    }
    assert.equal(results[1].text, results[0].text);
    assert.equal(results[1].spent, results[0].spent);
    // Everything before the error is a prefix of the upstream stream, cut at an event boundary.
    const prefix = results[0].text.slice(0, results[0].text.lastIndexOf('data: {"error"'));
    assert.ok(whole.toString("utf8").startsWith(prefix));
    assert.match(prefix, /(\r?\n){2}$/);
    assert.ok(contentChunks(prefix.split(/\r?\n\r?\n/)) > 2);
  });

  it("an event that grows past 4 MB without ending is not metered blindly: UPSTREAM_STREAM_BROKEN, charged the hold (R22)", async () => {
    const mb = "a".repeat(1_000_000);
    const stream = [oa({ content: "a" }), "data: ", ...Array.from({ length: 20 }, () => mb), "\n\n", DONE];
    const up = await fakeUpstream(stream);
    const sc = track(await boot(up, est.micros + 100), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    assert.ok(!r.text.includes(mb), "the oversized event was forwarded");
    const err = cutError(r.events);
    assert.equal(err.code, "UPSTREAM_STREAM_BROKEN");
    assert.equal(err.type, "api_error");
    assert.equal(err.charged_micros, est.micros);
    await assertProviderClosed(up, stream.length, 1);
    assert.equal(run(sc).spent_micros, est.micros);
    assert.equal(run(sc).held_micros, 0);
  });
});

// ---------- concurrency ----------

describe("mid-stream kill: concurrent streams share one budget", () => {
  const est = estimateOf(CHAT, chatBody());
  const S = 20; // each stream's prompt is S bigger than estimated; each chunk then needs 1 more micro
  const prompt = est.inputTokens + S;
  const stream = [...Array.from({ length: MAX }, (_, i) => oaRunning(prompt, i + 1)), oaUsage(prompt, MAX), DONE];

  it("two streams cannot both spend the same headroom: together they forward exactly what the budget pays for", async () => {
    const HEADROOM = 14; // less than one stream's S: neither can finish
    const cap = 2 * est.micros + HEADROOM;
    const up = await fakeUpstream(stream, { gapMs: 1 });
    const sc = track(await boot(up, cap), up);
    const [a, b] = await Promise.all([call(sc.baseURL, CHAT, chatBody()), call(sc.baseURL, CHAT, chatBody())]);
    for (const r of [a, b]) assert.equal(cutError(r.events).code, "BUDGET_EXHAUSTED");
    const forwarded = contentChunks(a.events) + contentChunks(b.events);
    assert.equal(forwarded, 2 * (MAX - S) + HEADROOM, `a=${contentChunks(a.events)} b=${contentChunks(b.events)}`);
    const scope = run(sc);
    assert.equal(scope.held_micros, 0);
    assert.equal(scope.spent_micros, 2 * (prompt + MAX)); // each cut stream: real input + its whole output allowance
    // The debt blocks the next call.
    const next = await call(sc.baseURL, CHAT, chatBody({ stream: false }));
    assert.equal(next.status, 402);
  });

  it("five streams on user, run and day scopes: total forwarded is exactly what the budget pays for", async () => {
    const HEADROOM = 23;
    const cap = 5 * est.micros + HEADROOM;
    const up = await fakeUpstream(stream, { gapMs: 1 });
    const sc = track(await boot(up, cap, {}, false), up);
    const rs = await Promise.all(Array.from({ length: 5 }, () => call(sc.baseURL, CHAT, chatBody(), { "x-burnbrake-user-id": "u-1" })));
    const forwarded = rs.reduce((n, r) => n + contentChunks(r.events), 0);
    assert.equal(forwarded, 5 * (MAX - S) + HEADROOM);
    for (const s of sc.ledger.balances({ userId: "u-1", runId: "run-k" }).scopes) {
      assert.equal(s.held_micros, 0, s.scope);
      assert.equal(s.spent_micros, 5 * (prompt + MAX), s.scope);
    }
  });
});

// ---------- config, pause, replay ----------

describe("mid-stream kill: configuration and edges", () => {
  const est = estimateOf(CHAT, chatBody());
  const S = 20;
  const prompt = est.inputTokens + S;
  const surprise = () => [...Array.from({ length: MAX }, (_, i) => oaRunning(prompt, i + 1)), oaUsage(prompt, MAX), DONE];

  it("is on by default and can be turned off; off means the old pass-through (the overrun becomes debt)", async () => {
    assert.equal(readStreamKill(undefined), true);
    assert.equal(readStreamKill(""), true);
    assert.equal(readStreamKill("on"), true);
    assert.equal(readStreamKill("0"), false);
    assert.equal(readStreamKill("off"), false);
    assert.throws(() => readStreamKill("maybe"), /BURNBRAKE_STREAM_KILL/);
    assert.throws(() => loadConfig({ BURNBRAKE_KEY: "bb_x", BURNBRAKE_STREAM_KILL: "sometimes" }), /BURNBRAKE_STREAM_KILL/);
    assert.equal(loadConfig({ BURNBRAKE_KEY: "bb_x" }).streamKill, true);

    const stream = surprise();
    const up = await fakeUpstream(stream);
    const off = track(await boot(up, est.micros, { BURNBRAKE_STREAM_KILL: "0" }), up);
    const health = await (await fetch(`${off.baseURL}/health`)).json();
    assert.deepEqual(health.stream_kill, { enabled: false });
    const r = await call(off.baseURL, CHAT, chatBody());
    assert.equal(r.text, stream.join(""));
    assert.equal(run(off).spent_micros, prompt + MAX);

    const on = track(await boot(null, 1000));
    assert.deepEqual((await (await fetch(`${on.baseURL}/health`)).json()).stream_kill, { enabled: true });
  });

  it("pausing the run stops a stream that needs more than its reservation", async () => {
    let sc!: Awaited<ReturnType<typeof boot>>;
    const up = await fakeUpstream(surprise(), {
      beforeChunk: (i) => {
        if (i === 3) sc.ledger.pauseRun("run-k", true);
      },
    });
    sc = track(await boot(up, est.micros + 1000), up);
    const r = await call(sc.baseURL, CHAT, chatBody());
    // Inside the reservation the stream ran on; the first chunk past it was refused.
    assert.equal(contentChunks(r.events), MAX - S);
    const err = cutError(r.events);
    assert.equal(err.code, "SPEND_PAUSED");
    assert.equal(err.type, "spend_paused");
    assert.equal(err.charged_micros, prompt + MAX);
  });

  it("a cut stream is not stored for replay: a retry with the same key is refused, not forwarded again", async () => {
    const up = await fakeUpstream(surprise());
    const sc = track(await boot(up, est.micros), up);
    const first = await call(sc.baseURL, CHAT, chatBody(), { "idempotency-key": "k-cut" });
    assert.equal(cutError(first.events).code, "BUDGET_EXHAUSTED");
    const again = await call(sc.baseURL, CHAT, chatBody(), { "idempotency-key": "k-cut" });
    assert.equal(again.status, 409);
    assert.equal(JSON.parse(again.text).error.code, "ALREADY_TERMINAL");
    assert.equal(up.requests(), 1);
  });

  it("a stream that broke after its hold was extended is charged the whole hold, and no hold is left behind", async () => {
    // Prompt 30 over: the hold grows by 1 per chunk after chunk 10; the provider drops at chunk 15.
    const big = est.inputTokens + 30;
    const up = await fakeUpstream(Array.from({ length: 15 }, (_, i) => oaRunning(big, i + 1)), { end: false });
    const sc = track(await boot(up, est.micros + 100), up);
    await call(sc.baseURL, CHAT, chatBody()).catch(() => null);
    await eventually(() => run(sc).held_micros === 0 && run(sc).spent_micros > 0);
    assert.equal(run(sc).spent_micros, est.micros + 5);
    const d = sc.ledger.listDecisions({ runId: "run-k", limit: 1 })[0];
    assert.equal(d.code, "UPSTREAM_STREAM_BROKEN");
    assert.equal(d.settled_micros, est.micros + 5);
  });
});

describe("ledger: extendHold", () => {
  const input = { userId: "u", runId: "r", estimateMicros: 100, idempotencyKey: null, model: "m", route: CHAT, maxTokens: 10, maxTokensSource: "request" as const, priceTableVersion: "t" };

  it("is all-or-nothing across every scope the reservation holds", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: 1000, run: 150, day: 1000 } });
    const r = ledger.reserve(input);
    assert.equal(r.kind, "reserved");
    const id = (r as { reservationId: string }).reservationId;
    ledger.markForwarded(id);
    assert.deepEqual(ledger.extendHold(id, 50), { ok: true, hold_micros: 150 });
    const refused = ledger.extendHold(id, 1);
    assert.equal(refused.ok, false);
    assert.equal((refused as { scope: string }).scope, "run");
    for (const s of ledger.balances({ userId: "u", runId: "r" }).scopes) assert.equal(s.held_micros, 150, s.scope);
    ledger.settle(id, 120);
    for (const s of ledger.balances({ userId: "u", runId: "r" }).scopes) {
      assert.equal(s.held_micros, 0, s.scope);
      assert.equal(s.spent_micros, 120, s.scope);
      assert.equal(s.overshoot_micros, 0, s.scope); // within the extended hold: not an overshoot
    }
    ledger.close();
  });

  it("is refused for a reservation that is not forwarded, and while spend is paused", () => {
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: null, run: 1000, day: null } });
    const id = (ledger.reserve(input) as { reservationId: string }).reservationId;
    assert.equal((ledger.extendHold(id, 1) as { code: string }).code, "NOT_FORWARDED");
    ledger.markForwarded(id);
    ledger.pauseGlobal(true);
    assert.equal((ledger.extendHold(id, 1) as { code: string }).code, "SPEND_PAUSED");
    ledger.close();
  });

  it("opens a ledger written by 0.3.0 (no extended_micros column) and adds the column", () => {
    const path = tempLedgerPath();
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE reservations (id TEXT PRIMARY KEY, idempotency_key TEXT, user_id TEXT, run_id TEXT, day_key TEXT NOT NULL,
      scopes TEXT NOT NULL, estimate_micros INTEGER NOT NULL, actual_micros INTEGER, state TEXT NOT NULL, terminal_reason TEXT,
      model TEXT, route TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, forwarded_at INTEGER, max_tokens INTEGER,
      max_tokens_source TEXT, price_table_version TEXT)`);
    old.close();
    const ledger = new Ledger(path, { defaultCaps: { user: null, run: 1000, day: null } });
    const id = (ledger.reserve(input) as { reservationId: string }).reservationId;
    ledger.markForwarded(id);
    assert.equal(ledger.extendHold(id, 10).ok, true);
    assert.equal(ledger.debitReserved(id, "DEBIT_UPSTREAM_UNKNOWN").debitedMicros, 110);
    ledger.close();
  });
});

describe("ledger: extended holds outside the stream path", () => {
  const input = { userId: "u", runId: "r", estimateMicros: 1000, idempotencyKey: null, model: "m", route: CHAT, maxTokens: 10, maxTokensSource: "request" as const, priceTableVersion: "t" };

  it("the TTL sweep of an extended FORWARDED reservation debits the whole hold (estimate + extension) and frees it", () => {
    let clock = 1_000_000;
    const ledger = new Ledger(tempLedgerPath(), { defaultCaps: { user: 10_000, run: 10_000, day: 10_000 }, reservationTtlMs: 60_000, now: () => clock });
    const id = (ledger.reserve(input) as { reservationId: string }).reservationId;
    ledger.markForwarded(id);
    assert.equal(ledger.extendHold(id, 600).ok, true);
    clock += 60_001;
    assert.deepEqual(ledger.sweep(), { released: 0, debited: 1 });
    for (const sc of ledger.balances({ userId: "u", runId: "r" }).scopes) {
      assert.equal(sc.spent_micros, 1600, sc.scope);
      assert.equal(sc.held_micros, 0, sc.scope);
    }
    const row = ledger.getReservation(id)!;
    assert.equal(row.state, "DEBIT_RESERVED");
    assert.equal(row.actual_micros, 1600);
    ledger.close();
  });

  it("after a downgrade that ignored the note, `burnbrake reconcile-holds` removes the phantom hold and keeps real ones", async () => {
    const path = tempLedgerPath();
    const ledger = new Ledger(path, { defaultCaps: { user: 10_000, run: 5_000, day: 20_000 } });
    const extended = (ledger.reserve(input) as { reservationId: string }).reservationId;
    ledger.markForwarded(extended);
    assert.equal(ledger.extendHold(extended, 600).ok, true);
    // A real stream still in flight, its hold extended too: reconcile must keep all of it.
    const open = (ledger.reserve({ ...input, estimateMicros: 300 }) as { reservationId: string }).reservationId;
    ledger.markForwarded(open);
    assert.equal(ledger.extendHold(open, 100).ok, true);
    ledger.close();
    // What 0.3.0 does when it settles the extended reservation at 1500: it knows only the
    // estimate, so it releases 1000 of the 1600 held and leaves 600 held for good.
    const db = new DatabaseSync(path);
    db.prepare("UPDATE scope_accounts SET held_micros = held_micros - 1000, spent_micros = spent_micros + 1500").run();
    db.prepare("UPDATE reservations SET state = 'SETTLED', actual_micros = 1500 WHERE id = ?").run(extended);
    db.close();
    const before = new Ledger(path);
    for (const sc of before.balances({ userId: "u", runId: "r" }).scopes) assert.equal(sc.held_micros, 600 + 400, sc.scope); // 600 phantom
    before.close();

    const probe = new Ledger(path);
    const day = probe.utcDay();
    probe.close();
    const lines: string[] = [];
    const io = { env: { BURNBRAKE_LEDGER_PATH: path }, log: (l: string) => lines.push(l), error: (l: string) => lines.push(`ERR ${l}`) };
    assert.equal(await execute(["reconcile-holds"], io), 0);
    assert.deepEqual(lines.filter((l) => l.startsWith("HOLD_RECONCILED")).sort(), [
      `HOLD_RECONCILED day:${day} held_micros 1000 -> 400`,
      "HOLD_RECONCILED run:r held_micros 1000 -> 400",
      "HOLD_RECONCILED user:u held_micros 1000 -> 400",
    ]);
    const after = new Ledger(path);
    for (const sc of after.balances({ userId: "u", runId: "r" }).scopes) {
      assert.equal(sc.held_micros, 400, sc.scope);
      assert.equal(sc.spent_micros, 1500, sc.scope); // spend is not touched
    }
    after.settle(open, 350); // the real hold is still whole: settling it frees exactly its 400
    for (const sc of after.balances({ userId: "u", runId: "r" }).scopes) {
      assert.equal(sc.held_micros, 0, sc.scope);
      assert.equal(sc.spent_micros, 1850, sc.scope);
    }
    after.close();
    lines.length = 0;
    assert.equal(await execute(["reconcile-holds"], io), 0);
    assert.match(lines.join("\n"), /^HOLDS_OK/);
  });
});

describe("stream meter units", () => {
  it("frames events across arbitrary splits, including a split CRLF separator", () => {
    const f = new SseEventFramer();
    assert.deepEqual(f.push("data: a\r\n\r"), []);
    assert.deepEqual(f.push("\ndata: b\n"), ["data: a\r\n\r\n"]);
    assert.deepEqual(f.push("\n"), ["data: b\n\n"]);
    assert.equal(f.flush(), "");
  });

  it("Anthropic: the provider's output count wins when it is higher than the delta count", () => {
    const m = new StreamMeter("anthropic");
    m.observe(anStart(10));
    m.observe(anText("a"));
    assert.deepEqual(m.usage(99), { prompt_tokens: 10, completion_tokens: 1 });
    m.observe(an("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }));
    assert.deepEqual(m.usage(99), { prompt_tokens: 10, completion_tokens: 7 });
  });

  it("OpenAI: every choice in a chunk counts, at least one token each", () => {
    const m = new StreamMeter("openai");
    const step = m.observe(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "a" } }, { index: 1, delta: { content: "b" } }] })}\n\n`);
    assert.deepEqual(step, { grew: true, final: false });
    assert.equal(m.usage(3).completion_tokens, 2);
    assert.equal(m.usage(3).prompt_tokens, 3); // estimate until the provider reports input
    assert.deepEqual(m.observe(DONE), { grew: false, final: true });
  });
  it("counted output is capped at the reserved output; the provider's own count is not; a cut is charged the whole allowance", () => {
    const m = new StreamMeter("anthropic");
    m.observe(anStart(10));
    for (let i = 0; i < 20; i++) m.observe(anText(WORDY));
    assert.ok(m.outputTokensCounted > 40);
    assert.deepEqual(m.usage(99, 40), { prompt_tokens: 10, completion_tokens: 40 });
    assert.deepEqual(m.cutUsage(99, 40), { prompt_tokens: 10, completion_tokens: 40 });
    const small = new StreamMeter("anthropic");
    small.observe(anStart(10));
    small.observe(anText("a"));
    assert.deepEqual(small.usage(99, 40), { prompt_tokens: 10, completion_tokens: 1 });
    assert.deepEqual(small.cutUsage(99, 40), { prompt_tokens: 10, completion_tokens: 40 });
    small.observe(an("message_delta", { delta: { stop_reason: null }, usage: { output_tokens: 55 } }));
    assert.equal(small.usage(99, 40).completion_tokens, 55);
    assert.equal(small.cutUsage(99, 40).completion_tokens, 55);
  });

  it("Anthropic: a tool_use block's name counts as output", () => {
    const m = new StreamMeter("anthropic");
    assert.deepEqual(m.observe(anBlock(1, { type: "tool_use", id: "t", name: "get_weather_for_city", input: {} })), { grew: true, final: false });
    assert.equal(m.outputTokensCounted, generatedTextTokens("get_weather_for_city"));
  });

  it("Anthropic: message_delta reports server-tool requests and a repeated (bigger) input count", () => {
    const m = new StreamMeter("anthropic");
    m.observe(anStart(10));
    m.observe(an("message_delta", { delta: { stop_reason: null }, usage: { input_tokens: 25, output_tokens: 3, server_tool_use: { web_search_requests: 2 } } }));
    assert.deepEqual(m.usage(99), { prompt_tokens: 25, completion_tokens: 3, server_tool_requests: { web_search: 2 } });
  });

  it("OpenAI: refusal and reasoning_content count as output", () => {
    for (const field of ["refusal", "reasoning_content"]) {
      const m = new StreamMeter("openai");
      m.observe(oa({ [field]: "abcdef" }));
      assert.equal(m.outputTokensCounted, generatedTextTokens("abcdef"), field);
    }
  });

  it("a multi-line data field is joined with newlines before parsing", () => {
    assert.equal(eventData('data: {"a":\ndata: 1}\n\n'), '{"a":\n1}');
    const m = new StreamMeter("openai");
    m.observe(`data: {"choices":[{"index":0,\ndata: "delta":{"content":"abcdef"}}]}\n\n`);
    assert.equal(m.outputTokensCounted, generatedTextTokens("abcdef"));
  });
});
