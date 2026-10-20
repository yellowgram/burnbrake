// LaunchGate re-review P3/P4 items fixed in round 2b: BB-R2 (bytes/3 under-counts text made of very
// short tokens), BB-R3 (mcp_servers / container accepted unpriced), BB-R4 (Anthropic-defined client
// tools refused with a misleading message).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateRequest, pieceCount } from "../src/estimate.ts";
import { loadPriceTable } from "../src/prices.ts";
import { defaultAnthropicPriceTablePath, defaultPriceTablePath } from "../src/config.ts";

const table = loadPriceTable(defaultPriceTablePath());
const anthropicTable = loadPriceTable(defaultAnthropicPriceTablePath());
const chat = (content: string) =>
  estimateRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content }], max_tokens: 1 }, table, 4096, "/v1/chat/completions");
const claude = (extra: Record<string, unknown>) =>
  estimateRequest({ model: "claude-3-5-haiku-latest", max_tokens: 16, messages: [{ role: "user", content: "hi" }], ...extra }, anthropicTable, 4096, "/v1/messages");

describe("BB-R2: input tokens are at least the pre-tokenizer piece count", () => {
  it("30k space-separated single letters reserve at least 30k input tokens (bytes/3 gave 20,004)", () => {
    const text = Array.from({ length: 30_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(" ");
    const r = chat(text);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.inputTokens >= 30_000, `inputTokens ${r.inputTokens}`);
  });
  it("digits count at most three per piece, punctuation runs one each", () => {
    assert.equal(pieceCount("1234567"), 3); // 123 456 7
    assert.equal(pieceCount("a,b,c"), 5);
  });
  it("ordinary English keeps the bytes/3 estimate (it is already the larger one)", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(200);
    const r = chat(text);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const bytes = Buffer.byteLength(text, "utf8");
    assert.ok(pieceCount(text) < Math.ceil(bytes / 3));
    assert.equal(r.inputTokens, Math.ceil(bytes / 3) + 4 + 3);
  });
});

describe("BB-R3: MCP connector servers and code-execution containers are refused", () => {
  for (const extra of [
    { mcp_servers: [{ type: "url", url: "https://example.invalid/mcp", name: "x" }] },
    { container: "container_123" },
  ]) {
    it(`refuses ${Object.keys(extra)[0]}`, () => {
      const r = claude(extra);
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.code, "UNKNOWN_SURCHARGE");
      assert.match(r.message, new RegExp(Object.keys(extra)[0]!));
    });
  }
});

describe("BB-R4: Anthropic-defined client tools are refused with an accurate reason", () => {
  for (const type of ["bash_20250124", "text_editor_20250728", "computer_20250124"]) {
    it(`refuses ${type} as an unpriced Anthropic-defined client tool`, () => {
      const r = claude({ tools: [{ type, name: "t" }] });
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.code, "UNKNOWN_SURCHARGE");
      assert.match(r.message, /Anthropic-defined client tool/);
      assert.match(r.message, /custom tool/);
    });
  }
});
