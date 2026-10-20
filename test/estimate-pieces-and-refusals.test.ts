// Input estimate at least the pre-tokenizer piece count (bytes/3 under-counted text made of very
// short tokens); requests with mcp_servers or container are refused (they can't be priced); and
// Anthropic-defined client tools are refused with an accurate reason.
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

describe("input tokens are at least the pre-tokenizer piece count", () => {
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
  it("ordinary English: at or above the real count, under 2.5x it, and at least bytes/3", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(200);
    const r = chat(text);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const bytes = Buffer.byteLength(text, "utf8");
    assert.ok(pieceCount(text) < Math.ceil(bytes / 3));
    // Real: 2,001 tokens on cl100k and o200k, + 7 framing. The pangram is rich in uncommon letter
    // pairs (qu, ck, wn, fox, mps, zy), so the letter-pair rule holds 4,476 (2.2x); common prose is ~1.9x.
    assert.equal(r.inputTokens, 4_476);
    assert.ok(r.inputTokens >= 2_001 + 7 && r.inputTokens <= 2.5 * (2_001 + 7));
    assert.ok(r.inputTokens >= Math.ceil(bytes / 3) + 4 + 3);
  });
});

describe("MCP connector servers and code-execution containers are refused", () => {
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

describe("Anthropic-defined client tools are refused with an accurate reason", () => {
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
