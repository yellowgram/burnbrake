// R4b-2: the input estimate is a floor (estimate >= real prompt tokens) for the text kinds below,
// checked against real GPT tokenizer counts. The counts are pinned (computed offline with
// js-tiktoken 1.0.21, cl100k_base and o200k_base); set BURNBRAKE_TIKTOKEN to a js-tiktoken entry
// file (or install js-tiktoken) to re-check the pins against the live tokenizer. burnbrake does
// not depend on js-tiktoken; without it the live check is skipped and the pins are used.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateRequest, pieceCount } from "../src/estimate.ts";
import { loadPriceTable } from "../src/prices.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { corpus } from "./tokenizer-corpus.ts";

const table = loadPriceTable(defaultPriceTablePath());
// One user message on /v1/chat/completions: 3 per message + 1 role + 3 reply priming.
const CHAT_FRAMING = 7;
const estimate = (content: string) => {
  const r = estimateRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content }], max_tokens: 1 }, table, 4096, "/v1/chat/completions");
  assert.equal(r.ok, true);
  return r.ok ? r.inputTokens : 0;
};

type Real = { cl100k: number; o200k: number };
// The estimate is proven a floor for these (numeric-heavy first).
const FLOOR: Record<string, Real> = {
  one_to_ten: { cl100k: 19, o200k: 19 },
  spaced_numbers: { cl100k: 7999, o200k: 7999 },
  random_numbers: { cl100k: 7780, o200k: 7780 },
  decimals: { cl100k: 4998, o200k: 4998 },
  csv: { cl100k: 4799, o200k: 4799 },
  logs: { cl100k: 10799, o200k: 10799 },
  markdown_table: { cl100k: 2600, o200k: 2600 },
  uuids: { cl100k: 6854, o200k: 6839 },
  url: { cl100k: 3600, o200k: 3600 },
  english: { cl100k: 2401, o200k: 2401 },
  code: { cl100k: 4950, o200k: 4950 },
  whitespace: { cl100k: 3301, o200k: 3301 },
  cjk: { cl100k: 3000, o200k: 2200 },
  chinese: { cl100k: 3200, o200k: 2800 },
  russian: { cl100k: 5201, o200k: 3001 },
};
// NOT a floor on at least one tokenizer: README "Limits" lists these as exceptions.
const EXCEPTIONS: Record<string, Real> = {
  json: { cl100k: 3602, o200k: 3602 },
  hex_ips: { cl100k: 7521, o200k: 7524 },
  punctuation: { cl100k: 2101, o200k: 2201 },
  base64: { cl100k: 5730, o200k: 5448 },
  korean: { cl100k: 4801, o200k: 3202 },
  arabic: { cl100k: 5000, o200k: 2002 },
  hindi: { cl100k: 9401, o200k: 3202 },
  emoji: { cl100k: 3002, o200k: 2001 },
  emoji_zwj: { cl100k: 11100, o200k: 7500 },
  math: { cl100k: 6601, o200k: 4801 },
};

const texts = corpus();

describe("R4b-2: input estimate vs real GPT tokenizer counts", () => {
  it("space-separated numbers: '1 2 3 4 5 6 7 8 9 10' is 19 pieces, as on cl100k and o200k (the old regex gave 10)", () => {
    assert.equal(pieceCount("1 2 3 4 5 6 7 8 9 10"), 19);
    assert.ok(estimate("1 2 3 4 5 6 7 8 9 10") >= 19 + CHAT_FRAMING);
  });

  it("numeric-heavy prompts are counted exactly (3,000 spaced numbers: 8,006 = 7,999 + framing; was 37% under)", () => {
    for (const k of ["one_to_ten", "spaced_numbers", "random_numbers", "decimals", "csv", "markdown_table"]) {
      const real = Math.max(FLOOR[k].cl100k, FLOOR[k].o200k) + CHAT_FRAMING;
      assert.equal(estimate(texts[k]), real, k);
    }
  });

  it("the estimate is >= the real count on cl100k and o200k for every floor text kind", () => {
    for (const [k, real] of Object.entries(FLOOR)) {
      const est = estimate(texts[k]);
      assert.ok(est >= real.cl100k + CHAT_FRAMING, `${k}: estimate ${est} < cl100k ${real.cl100k + CHAT_FRAMING}`);
      assert.ok(est >= real.o200k + CHAT_FRAMING, `${k}: estimate ${est} < o200k ${real.o200k + CHAT_FRAMING}`);
    }
  });

  it("documented exceptions really are under on some tokenizer (keeps the README's exception list honest)", () => {
    for (const [k, real] of Object.entries(EXCEPTIONS)) {
      const est = estimate(texts[k]);
      assert.ok(est < Math.max(real.cl100k, real.o200k) + CHAT_FRAMING, `${k} is now a floor: move it to FLOOR and update README`);
    }
  });

  it("pins match the live tokenizer when js-tiktoken is available offline", async (t) => {
    let mod: { getEncoding: (n: string) => { encode: (s: string) => number[] } };
    try {
      mod = await import(process.env.BURNBRAKE_TIKTOKEN ?? "js-tiktoken");
    } catch {
      t.skip("js-tiktoken not installed (set BURNBRAKE_TIKTOKEN to its dist/index.js)");
      return;
    }
    const cl = mod.getEncoding("cl100k_base");
    const o2 = mod.getEncoding("o200k_base");
    for (const [k, real] of Object.entries({ ...FLOOR, ...EXCEPTIONS })) {
      assert.equal(cl.encode(texts[k]).length, real.cl100k, `${k} cl100k`);
      assert.equal(o2.encode(texts[k]).length, real.o200k, `${k} o200k`);
    }
  });
});
