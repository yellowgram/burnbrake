// Runs the fuzz shapes through the estimator and a real tokenizer (js-tiktoken, a devDependency).
import { estimateRequest } from "../src/estimate.ts";
import { loadPriceTable } from "../src/prices.ts";
import { defaultPriceTablePath } from "../src/config.ts";
import { type Rng, rng } from "./fuzz-shapes.ts";

/** One user message on /v1/chat/completions: 3 per message + 1 role + 3 reply priming. */
export const CHAT_FRAMING = 7;
const table = loadPriceTable(defaultPriceTablePath());

export type Encoder = { encode: (s: string) => number[] };
export type Case = { shape: string; seed: number; path: "message" | "tool_call"; text: string; est: number; cl100k: number; o200k: number; ratio: number };
export type ShapeStats = { shape: string; cases: number; worst: Case; meanRatio: number };

function estimateOf(body: Record<string, unknown>): number {
  const r = estimateRequest({ model: "gpt-4o-mini", max_tokens: 1, ...body }, table, 4096, "/v1/chat/completions");
  if (!r.ok) throw new Error(`estimate refused: ${r.code}`);
  return r.inputTokens;
}

/**
 * Each case is estimated as a user message; shapes listed in `toolShapes` are also sent as the
 * arguments of an earlier assistant tool call (the addJson path), whose real count is the
 * tokens of the serialized call (a proxy: OpenAI's own tool serialization is not public).
 */
export function runFuzz(
  shapes: Record<string, (r: Rng) => string>,
  seeds: Iterable<number>,
  enc: { cl100k: Encoder; o200k: Encoder },
  toolShapes: ReadonlySet<string> = new Set(),
  onCase?: (c: Case) => void,
): ShapeStats[] {
  const stats = new Map<string, ShapeStats>();
  const record = (c: Case) => {
    onCase?.(c);
    const key = c.path === "tool_call" ? `${c.shape} (tool_call)` : c.shape;
    const s = stats.get(key);
    if (!s) stats.set(key, { shape: key, cases: 1, worst: c, meanRatio: c.ratio });
    else {
      s.meanRatio = (s.meanRatio * s.cases + c.ratio) / (s.cases + 1);
      s.cases += 1;
      if (c.ratio < s.worst.ratio) s.worst = c;
    }
  };
  for (const seed of seeds) {
    for (const [shape, gen] of Object.entries(shapes)) {
      const text = gen(rng(seed * 7919 + hash(shape)));
      if (!text) continue;
      const cl = enc.cl100k.encode(text).length + CHAT_FRAMING;
      const o2 = enc.o200k.encode(text).length + CHAT_FRAMING;
      const est = estimateOf({ messages: [{ role: "user", content: text }] });
      record({ shape, seed, path: "message", text, est, cl100k: cl, o200k: o2, ratio: est / Math.max(cl, o2) });
      if (toolShapes.has(shape)) {
        const call = { id: "call_1", type: "function", function: { name: "lookup", arguments: text } };
        const serialized = JSON.stringify(call);
        const tcl = enc.cl100k.encode(serialized).length + CHAT_FRAMING;
        const to2 = enc.o200k.encode(serialized).length + CHAT_FRAMING;
        const test = estimateOf({ messages: [{ role: "assistant", content: null, tool_calls: [call] }] });
        record({ shape, seed, path: "tool_call", text, est: test, cl100k: tcl, o200k: to2, ratio: test / Math.max(tcl, to2) });
      }
    }
  }
  return [...stats.values()].sort((a, b) => a.shape.localeCompare(b.shape));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
