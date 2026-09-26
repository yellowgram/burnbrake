import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { estimateRequest } from "../src/estimate.ts";
import { loadPriceTable, priceTableFreshness } from "../src/prices.ts";
import { defaultPriceTablePath } from "../src/config.ts";

describe("estimate", () => {
  const table = loadPriceTable(defaultPriceTablePath());

  it("uses a buyer ceiling verbatim and injects 4096 only when omitted", () => {
    const injected = estimateRequest(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      table,
      4096,
      "/v1/chat/completions",
    );
    assert.equal(injected.ok, true);
    if (!injected.ok) return;
    assert.equal(injected.maxTokens, 4096);
    assert.equal(injected.maxTokensSource, "injected");
    assert.equal(injected.forwardBody.max_tokens, 4096);

    const explicit = estimateRequest(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 8000 },
      table,
      4096,
      "/v1/chat/completions",
    );
    assert.equal(explicit.ok, true);
    if (!explicit.ok) return;
    assert.equal(explicit.maxTokens, 8000);
    assert.equal(explicit.maxTokensSource, "request");
    assert.equal(explicit.forwardBody.max_tokens, 8000);
    assert.ok(explicit.micros > injected.micros);
  });

  it("denies unknown content instead of pricing it at zero", () => {
    const result = estimateRequest(
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: [{ type: "audio", data: "nope" }] }],
        max_tokens: 16,
      },
      table,
      4096,
      "/v1/chat/completions",
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "UNKNOWN_SURCHARGE");
  });

  it("warns when priced_at is older than 30 days without dropping the rate", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-price-"));
    const path = join(dir, "old.yaml");
    writeFileSync(
      path,
      `version: "old"
priced_at: "2020-01-01T00:00:00Z"
models:
  gpt-4o-mini:
    input_micros_per_million: 150000
    output_micros_per_million: 600000
surcharges:
  vision:
    per_image_input_tokens: 1100
    per_image_micros: 0
  tools:
    extra_output_tokens: 256
    flat_micros: 0
known_content_types: [text]
`,
    );
    const stale = loadPriceTable(path);
    const fresh = priceTableFreshness(stale, Date.parse("2026-09-26T00:00:00Z"), 30);
    assert.equal(fresh.stale, true);
    const estimate = estimateRequest(
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
      stale,
      4096,
      "/v1/chat/completions",
    );
    assert.equal(estimate.ok, true);
    if (!estimate.ok) return;
    assert.ok(estimate.micros > 0);
  });
});
