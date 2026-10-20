import assert from "node:assert/strict";
import { createServer, request, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { bootSidecar } from "./helpers.ts";

const BODY = { model: "gpt-4o-mini", stream: true, max_tokens: 100, messages: [{ role: "user", content: "hi" }] };
const HEADERS = { "content-type": "application/json", "x-burnbrake-key": "bb_test_key", "x-burnbrake-run-id": "run-l" };

async function listen(handler: (res: ServerResponse) => void) {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => handler(res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

async function eventually(check: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("upstream lifecycle", () => {
  it("a client that leaves before the provider answers cancels the provider call", async () => {
    let upstreamClosed = false;
    const up = await listen((res) => res.on("close", () => (upstreamClosed = true))); // never answers
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const ctl = new AbortController();
      const pending = fetch(`${sidecar.baseURL}/v1/chat/completions`, { method: "POST", headers: HEADERS, body: JSON.stringify(BODY), signal: ctl.signal }).catch(() => null);
      await new Promise((r) => setTimeout(r, 100));
      ctl.abort();
      await pending;
      await eventually(() => upstreamClosed, 1000);
      // Outcome unknown: the reservation is charged at the estimate, not left open.
      await eventually(() => sidecar.ledger.balances({ runId: "run-l" }).scopes.find((s) => s.scope === "run")!.spent_micros > 0, 1000);
    } finally {
      up.server.closeAllConnections();
      up.server.close();
      await sidecar.close();
    }
  });

  it("a slow reader slows the provider stream instead of being buffered in memory", async () => {
    const CHUNK = Buffer.alloc(64 * 1024, "a");
    const TOTAL = 32 * 1024 * 1024;
    let written = 0;
    const up = await listen(async (res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      while (written < TOTAL) {
        const line = Buffer.concat([Buffer.from("data: "), CHUNK, Buffer.from("\n\n")]);
        written += line.length;
        if (!res.write(line)) await new Promise((r) => res.once("drain", r));
      }
      res.end("data: [DONE]\n\n");
    });
    const sidecar = await bootSidecar({ mockUpstream: false, upstreamBaseURL: up.url, env: { OPENAI_API_KEY: "sk-test-upstream" } });
    try {
      const { port } = new URL(sidecar.baseURL);
      const done = new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST", headers: HEADERS }, (res) => {
          res.pause();
          setTimeout(() => {
            // While the client wasn't reading, the provider could not get far ahead.
            if (written >= TOTAL / 2) {
              res.destroy();
              reject(new Error(`provider wrote ${written} bytes to a paused client`));
              return;
            }
            let got = 0;
            res.on("data", (c: Buffer) => (got += c.length));
            res.on("end", () => resolve(got));
            res.resume();
          }, 700);
        });
        req.on("error", reject);
        req.end(JSON.stringify(BODY));
      });
      const got = await done;
      assert.ok(got >= TOTAL, `client got ${got}`);
    } finally {
      up.server.closeAllConnections();
      up.server.close();
      await sidecar.close();
    }
  });
});
