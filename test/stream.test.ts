import assert from "node:assert/strict";
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { costFromUsage } from "../src/estimate.ts";
import { defaultPriceTablePath, defaultAnthropicPriceTablePath } from "../src/config.ts";
import { loadPriceTable } from "../src/prices.ts";
import { SseUsageTracker, settleUsage } from "../src/upstream.ts";
import { bootSidecar } from "./helpers.ts";

type Handler = (req: IncomingMessage, body: any, res: ServerResponse) => void | Promise<void>;

async function fakeUpstream(handler: Handler): Promise<{ url: string; server: Server; bodies: any[]; closed: () => number }> {
  const bodies: any[] = [];
  let aborted = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      bodies.push(body);
      res.on("close", () => {
        if (!res.writableFinished) aborted += 1;
      });
      void handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, server, bodies, closed: () => aborted };
}

function sse(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
}

const openaiChunk = (text: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;
const anthropicEvent = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function post(baseURL: string, route: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseURL}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-s", ...headers },
    body: JSON.stringify(body),
  });
}

function runSpent(sidecar: Awaited<ReturnType<typeof bootSidecar>>, runId = "run-s"): number {
  return sidecar.ledger.balances({ runId }).scopes.find((s) => s.scope === "run")!.spent_micros;
}

async function eventually(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const openaiTable = loadPriceTable(defaultPriceTablePath());
const anthropicTable = loadPriceTable(defaultAnthropicPriceTablePath());

describe("streaming pass-through", () => {
  it("sends the first bytes before the upstream finishes, then settles at the reported usage", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const up = await fakeUpstream(async (_req, _body, res) => {
      sse(res);
      res.write(openaiChunk("Hel"));
      await gate;
      res.write(openaiChunk("lo"));
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const response = await post(sidecar.baseURL, "/v1/chat/completions", {
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 2000,
        messages: [{ role: "user", content: "hi" }],
      }, { "idempotency-key": "s-1" });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("x-burnbrake-reservation-id"));
      const reader = response.body!.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /Hel/);
      assert.equal(runSpent(sidecar), 0, "nothing settled while the stream is open");
      release();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += new TextDecoder().decode(value);
      }
      assert.match(rest, /\[DONE\]/);
      const expected = costFromUsage(openaiTable, "gpt-4o-mini", { prompt_tokens: 11, completion_tokens: 7 }, 0)!;
      await eventually(() => runSpent(sidecar) === expected);
      assert.equal(up.bodies[0].stream_options.include_usage, true);

      // The same key replays the stored stream without a second upstream call.
      const again = await post(sidecar.baseURL, "/v1/chat/completions", {
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 2000,
        messages: [{ role: "user", content: "hi" }],
      }, { "idempotency-key": "s-1" });
      assert.equal(again.headers.get("x-burnbrake-idempotent-replay"), "true");
      assert.match(again.headers.get("content-type") ?? "", /event-stream/);
      assert.match(await again.text(), /Hello|lo/);
      assert.equal(up.bodies.length, 1);
    } finally {
      release();
      await sidecar.close();
      up.server.close();
    }
  });

  it("settles an Anthropic stream at actual usage and does not send stream_options", async () => {
    const up = await fakeUpstream((_req, body, res) => {
      sse(res);
      res.write(anthropicEvent("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", content: [], model: body.model, usage: { input_tokens: 25, output_tokens: 1 } } }));
      res.write(anthropicEvent("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }));
      res.write(anthropicEvent("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 15 } }));
      res.end(anthropicEvent("message_stop", { type: "message_stop" }));
    });
    const sidecar = await bootSidecar({ mockUpstream: false, env: { BURNBRAKE_ANTHROPIC_BASE_URL: up.url, ANTHROPIC_API_KEY: "sk-ant-test" } });
    try {
      const response = await post(sidecar.baseURL, "/v1/messages", {
        model: "claude-3-5-haiku-latest",
        stream: true,
        max_tokens: 1000,
        messages: [{ role: "user", content: "hi" }],
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /message_stop/);
      assert.equal(up.bodies[0].stream_options, undefined);
      const expected = costFromUsage(anthropicTable, "claude-3-5-haiku-latest", { prompt_tokens: 25, completion_tokens: 15 }, 0)!;
      await eventually(() => runSpent(sidecar) === expected);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("debits the estimate when the upstream stream ends without its end marker", async () => {
    const up = await fakeUpstream((_req, _body, res) => {
      sse(res);
      res.write(openaiChunk("partial"));
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
      res.end();
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const response = await post(sidecar.baseURL, "/v1/chat/completions", {
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 2000,
        messages: [{ role: "user", content: "hi" }],
      }, { "idempotency-key": "s-cut" });
      await response.text();
      const tiny = costFromUsage(openaiTable, "gpt-4o-mini", { prompt_tokens: 1, completion_tokens: 1 }, 0)!;
      await eventually(() => runSpent(sidecar) > tiny);
      const retry = await post(sidecar.baseURL, "/v1/chat/completions", {
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 2000,
        messages: [{ role: "user", content: "hi" }],
      }, { "idempotency-key": "s-cut" });
      assert.equal(retry.status, 409, "an unfinished stream is not replayed and not forwarded again");
      assert.equal((await retry.json()).error.code, "ALREADY_TERMINAL");
      assert.equal(up.bodies.length, 1);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("closes the upstream when the client leaves mid-stream and debits the estimate", async () => {
    const up = await fakeUpstream((_req, _body, res) => {
      sse(res);
      res.write(openaiChunk("one"));
      // never ends on its own
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const url = new URL(`${sidecar.baseURL}/v1/chat/completions`);
      await new Promise<void>((resolve, reject) => {
        const req = request(
          { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-s" } },
          (res) => {
            res.once("data", () => {
              req.destroy();
              resolve();
            });
          },
        );
        req.on("error", () => {});
        req.on("close", () => resolve());
        req.end(JSON.stringify({ model: "gpt-4o-mini", stream: true, max_tokens: 2000, messages: [{ role: "user", content: "hi" }] }));
        setTimeout(() => reject(new Error("no first byte")), 3000);
      });
      await eventually(() => up.closed() === 1);
      await eventually(() => runSpent(sidecar) > 0);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("does not hang when the client leaves before the upstream answers", async () => {
    let answered!: () => void;
    const sentHeaders = new Promise<void>((r) => (answered = r));
    const up = await fakeUpstream(async (_req, _body, res) => {
      await new Promise((r) => setTimeout(r, 300));
      sse(res);
      res.write(openaiChunk("late"));
      answered();
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const controller = new AbortController();
      const pending = fetch(`${sidecar.baseURL}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-s" },
        body: JSON.stringify({ model: "gpt-4o-mini", stream: true, max_tokens: 2000, messages: [{ role: "user", content: "hi" }] }),
      }).catch(() => null);
      setTimeout(() => controller.abort(), 100);
      await pending;
      await sentHeaders;
      await eventually(() => up.closed() === 1);
      await eventually(() => runSpent(sidecar) > 0);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("passes through a stream far larger than the old 2 MB buffer", async () => {
    const piece = openaiChunk("x".repeat(8000));
    const up = await fakeUpstream((_req, _body, res) => {
      sse(res);
      for (let i = 0; i < 400; i += 1) res.write(piece);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 900 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const response = await post(sidecar.baseURL, "/v1/chat/completions", {
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: 2000,
        messages: [{ role: "user", content: "hi" }],
      });
      const text = await response.text();
      assert.ok(text.length > 3_000_000);
      assert.match(text, /\[DONE\]/);
      const expected = costFromUsage(openaiTable, "gpt-4o-mini", { prompt_tokens: 3, completion_tokens: 900 }, 0)!;
      await eventually(() => runSpent(sidecar) === expected);
    } finally {
      await sidecar.close();
      up.server.close();
    }
  });

  it("the offline mock streams the real Anthropic event shape", async () => {
    const sidecar = await bootSidecar();
    try {
      const response = await post(sidecar.baseURL, "/v1/messages", {
        model: "claude-3-5-haiku-latest",
        stream: true,
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      });
      const text = await response.text();
      assert.match(text, /event: message_start/);
      assert.match(text, /event: message_stop/);
      assert.doesNotMatch(text, /\[DONE\]/);
      await eventually(() => runSpent(sidecar) > 0);
    } finally {
      await sidecar.close();
    }
  });
});

describe("stream usage reader", () => {
  it("handles events split across arbitrary chunk boundaries", () => {
    const text =
      anthropicEvent("message_start", { type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } }) +
      anthropicEvent("message_delta", { type: "message_delta", usage: { output_tokens: 9 } }) +
      anthropicEvent("message_stop", { type: "message_stop" });
    const t = new SseUsageTracker();
    for (let i = 0; i < text.length; i += 3) t.feed(text.slice(i, i + 3));
    t.end();
    assert.deepEqual(t.usage(), { prompt_tokens: 40, completion_tokens: 9 });
  });

  it("prices Anthropic prompt-cache tokens as input-token equivalents", () => {
    const withBreakdown =
      anthropicEvent("message_start", {
        type: "message_start",
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 }, output_tokens: 1 } },
      }) +
      anthropicEvent("message_delta", { type: "message_delta", usage: { output_tokens: 5 } }) +
      anthropicEvent("message_stop", { type: "message_stop" });
    // 10 + 1000*0.1 + 200*1.25 + 100*2 = 560
    assert.deepEqual(settleUsage("text/event-stream", withBreakdown), { prompt_tokens: 560, completion_tokens: 5 });
    const noBreakdown = withBreakdown.replace(/,"cache_creation":\{[^}]*\}/, "");
    // 10 + 100 + 300*2 = 710 (assumes the dearer write rate)
    assert.deepEqual(settleUsage("text/event-stream", noBreakdown), { prompt_tokens: 710, completion_tokens: 5 });
  });

  it("takes cumulative input and cache counts from message_delta when present", () => {
    const text =
      anthropicEvent("message_start", { type: "message_start", message: { usage: { input_tokens: 2679, cache_read_input_tokens: 0, output_tokens: 3 } } }) +
      anthropicEvent("message_delta", { type: "message_delta", usage: { input_tokens: 10682, cache_read_input_tokens: 0, output_tokens: 510 } }) +
      anthropicEvent("message_stop", { type: "message_stop" });
    assert.deepEqual(settleUsage("text/event-stream", text), { prompt_tokens: 10682, completion_tokens: 510 });
  });

  it("a finished Anthropic stream that never reports usage settles at the estimate", () => {
    const text =
      anthropicEvent("message_start", { type: "message_start", message: { id: "m", content: [] } }) +
      anthropicEvent("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" } }) +
      anthropicEvent("message_stop", { type: "message_stop" });
    assert.equal(settleUsage("text/event-stream", text), null);
  });

  it("an Anthropic stream that ends in an error event is unfinished", () => {
    const text =
      anthropicEvent("message_start", { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } }) +
      anthropicEvent("error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    assert.equal(settleUsage("text/event-stream", text), null);
  });

  it("an OpenAI stream without [DONE] is unfinished", () => {
    assert.equal(settleUsage("text/event-stream", `data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n`), null);
  });
});
