// The input estimate is a floor (estimate >= real prompt tokens) on GPT tokenizers, for every
// fixture class in test/tokenizer-corpus.ts and for tool-call and tool-schema JSON. The real counts
// are pinned (cl100k_base and o200k_base via js-tiktoken 1.0.21, a devDependency) and re-checked
// against the live tokenizer. See also test/estimate-fuzz.test.ts (seeded fuzz over many shapes).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateRequest, floorTokens, pieceCount } from "../src/estimate.ts";
import { loadPriceTable } from "../src/prices.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { getEncoding } from "js-tiktoken";
import { corpus } from "./tokenizer-corpus.ts";

const table = loadPriceTable(defaultPriceTablePath());
// One user message on /v1/chat/completions: 3 per message + 1 role + 3 reply priming.
const CHAT_FRAMING = 7;
const estimate = (content: string) => {
  const r = estimateRequest({ model: "gpt-4o-mini", messages: [{ role: "user", content }], max_tokens: 1 }, table, 4096, "/v1/chat/completions");
  assert.equal(r.ok, true);
  return r.ok ? r.inputTokens : 0;
};

// floorTokens adds one token of margin per text part; the unit checks below look at the rest.
const counted = (text: string) => floorTokens(text) - 1;

type Real = { cl100k: number; o200k: number };
// Real token counts of every corpus() fixture (content only, no chat framing).
const REAL: Record<string, Real> = {
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
  mixed_whitespace: { cl100k: 1002, o200k: 1002 },
  punct_pairs: { cl100k: 2470, o200k: 2490 },
  control_chars: { cl100k: 4974, o200k: 4968 },
  short_base64: { cl100k: 22313, o200k: 21276 },
  short_hex: { cl100k: 11179, o200k: 11188 },
  random_ascii: { cl100k: 15051, o200k: 14827 },
  indented_code: { cl100k: 4650, o200k: 4650 },
  long_random_letters: { cl100k: 13121, o200k: 12613 },
  aws_key_ids: { cl100k: 3850, o200k: 3761 },
  ulids: { cl100k: 5641, o200k: 5531 },
  base32_secrets: { cl100k: 6490, o200k: 6304 },
  base36_ids: { cl100k: 3489, o200k: 3414 },
  k8s_pod_names: { cl100k: 5639, o200k: 5602 },
  rand_lower_words: { cl100k: 9546, o200k: 9143 },
  rand_mixed_case_words: { cl100k: 17081, o200k: 15991 },
};

const texts = corpus();

describe("input estimate vs real GPT tokenizer counts", () => {
  it("space-separated numbers: '1 2 3 4 5 6 7 8 9 10' is 19 pieces and 19 tokens, as on cl100k and o200k", () => {
    assert.equal(pieceCount("1 2 3 4 5 6 7 8 9 10"), 19);
    assert.equal(counted("1 2 3 4 5 6 7 8 9 10"), 19);
    assert.ok(estimate("1 2 3 4 5 6 7 8 9 10") >= 19 + CHAT_FRAMING);
  });

  it("numeric prompts are counted exactly, plus the one-token margin (3,000 spaced numbers: 8,007 = 7,999 + framing + 1; was 37% under)", () => {
    for (const k of ["one_to_ten", "spaced_numbers", "random_numbers", "decimals", "csv"]) {
      assert.equal(estimate(texts[k]), REAL[k].o200k + CHAT_FRAMING + 1, k);
    }
  });

  it("every fixture class in tokenizer-corpus.ts has a pinned real count", () => {
    assert.deepEqual(Object.keys(texts).sort(), Object.keys(REAL).sort());
  });

  it("estimate >= real on cl100k and on o200k for every fixture class", () => {
    for (const [k, text] of Object.entries(texts)) {
      const est = estimate(text);
      assert.ok(est >= REAL[k].cl100k + CHAT_FRAMING, `${k}: estimate ${est} < cl100k ${REAL[k].cl100k + CHAT_FRAMING}`);
      assert.ok(est >= REAL[k].o200k + CHAT_FRAMING, `${k}: estimate ${est} < o200k ${REAL[k].o200k + CHAT_FRAMING}`);
    }
  });

  it("byte-counted runs: non-ASCII, base64-like, hex-like and letter+digit runs count one token per UTF-8 byte", () => {
    assert.equal(counted("日本"), 6);
    assert.equal(counted("🙂"), 4);
    assert.equal(counted("aB3dE5fG"), 8);
    assert.equal(counted("0xdeadbeef1"), 11);
    assert.equal(counted("AKIAIOSFODNN7EXAMPLE"), 20); // single-case letters + digits
    assert.equal(counted("FV6S 3XWR"), 9); // grouped base32 secret: two 4-char runs + the space's piece
    assert.equal(counted("61Nc"), 4); // a short letter+digit run is byte-counted too
    assert.equal(counted("1Div-TeaR+cGn"), 13); // short base64url-like run (8+ chars)
    assert.equal(counted("\u0001\u0002\u0003"), 3);
    assert.equal(counted('a},{"b'), 1 + 4 + 1); // punctuation runs at their length
  });

  it("letter pieces: words stay near bytes/3, random letters count about one token per uncommon pair", () => {
    assert.equal(counted(" the"), 2); // max(4/3, 1) rounded up
    assert.equal(counted("kubernetes"), 4); // 10/3 < 1 + boundaries + 1
    assert.ok(counted("xqzvkwjp") >= 8); // every pair rare: 1 + 7 + 1
    assert.ok(counted("getUserName") >= 4); // two camelCase steps
    // Strings the fuzz sweeps found under the real count, with today's rules or with one of them
    // removed; each holds even without the per-part margin.
    const found = [
      "RtPbCStobDapxGwXKcag", // random mixed case
      "XZUJTHETXVIOKNDILSE", // random capitals
      "havethes thistheer", // run-together words
      "Hd H5g rO 61Nc CLea wG", // short letter+digit groups
      " \u000b\u000b \f\r\u000b\u000b\n\f\f\u000b\r\n\t\u000b", // mixed whitespace with \v \f \r
      "\t\n\r\f\f\t\f\f  \u000b\t\r\r\n\r\f  \u000b\f\r\t\t\f\f \r\f\u000b\r\f\f \r\u000b",
      "ssn".repeat(85), // repeated letter units count at bytes
      "l".repeat(70),
      "ab".repeat(150),
      "ss".repeat(10) + "x", // a repeated run inside a longer piece
      "LIliLIliLILIlili".repeat(6), // repetitions in flipped case
      "MEMEmeMEmemememeMEmeMEmeMEMEmeMEmemem",
      "lllllllll", // a short repeated run (9 letters)
      "odnf".repeat(20) + "OCZKRT".repeat(10), // two repeated runs run together
    ];
    for (const e of [getEncoding("cl100k_base"), getEncoding("o200k_base")]) {
      for (const s of found) assert.ok(counted(s) >= e.encode(s).length, JSON.stringify(s));
    }
    // Known one-token miss (P3, documented in the README): a random run-together lowercase string
    // from a fresh fuzz seed. cl100k counts 9 and o200k 8; the estimate, margin included, is 8.
    // Pinned so that a change that widens the miss fails here.
    const miss = "kxioroeesicetrrp";
    assert.equal(floorTokens(miss), 8);
    assert.equal(getEncoding("cl100k_base").encode(miss).length, 9);
    assert.ok(floorTokens(miss) >= getEncoding("o200k_base").encode(miss).length);
  });

  it("tool-call arguments and tool schemas (the JSON path) are floors too", () => {
    const enc = [getEncoding("cl100k_base"), getEncoding("o200k_base")];
    const args = JSON.stringify({ file_b64: Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 73 + 41) % 256)).toString("base64"), id: "k3j9x0q2zt" });
    const calls = [{ id: "call_9f8e7d", type: "function", function: { name: "upload_file", arguments: args } }];
    const tools = [{ type: "function", function: { name: "lookup_order", description: `Look up an order by its id, e.g. 7f3kq92mzx or ${"AKIA"}2Q7ZJX4MNB3PRS6T.`, // split: not a real key, keeps secret scanners quiet
      parameters: { type: "object", properties: { order_id: { type: "string", examples: ["9xk2m4qz7w", "b7t3n8v2kp", "q4w8e2r6ty"] }, region: { type: "string", enum: ["us-east-1", "eu-west-2", "ap-south-1"] } }, required: ["order_id"] } } }];
    const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: null, tool_calls: calls }, { role: "tool", tool_call_id: "call_9f8e7d", content: "ok" }];
    const r = estimateRequest({ model: "gpt-4o-mini", max_tokens: 1, messages, tools }, table, 4096, "/v1/chat/completions");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    for (const e of enc) {
      // Proxy for the real count: the serialized calls and schema (OpenAI's own serialization is
      // not public), the message texts, 4 per message + 3.
      const real = e.encode(JSON.stringify(calls[0])).length + e.encode(JSON.stringify(tools)).length + e.encode("hi").length + e.encode("call_9f8e7d").length + e.encode("ok").length + messages.length * 4 + 3;
      assert.ok(r.inputTokens >= real, `estimate ${r.inputTokens} < real ${real}`);
    }
  });

  it("pins match the live tokenizer (js-tiktoken, devDependency, offline)", () => {
    const cl = getEncoding("cl100k_base");
    const o2 = getEncoding("o200k_base");
    for (const [k, s] of Object.entries(texts)) {
      // emoji_zwj is a single 16 KB pre-token piece and js-tiktoken's BPE is quadratic on it
      // (about 23 s); its pin was checked once offline, and the fuzz test covers ZWJ emoji.
      if (k === "emoji_zwj") continue;
      assert.equal(cl.encode(s).length, REAL[k].cl100k, `${k} cl100k`);
      assert.equal(o2.encode(s).length, REAL[k].o200k, `${k} o200k`);
    }
  });
});
