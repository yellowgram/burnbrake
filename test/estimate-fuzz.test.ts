// Seeded, deterministic fuzz of the input-estimate floor: thousands of generated prompts (ids and
// keys, JSON, code, logs, URLs, mixed scripts and emoji, punctuation and whitespace shapes) are
// counted with the real cl100k_base and o200k_base tokenizers (js-tiktoken, a devDependency, no
// network) and the estimate must be at or above both. BURNBRAKE_FUZZ_SEEDS raises the seed count;
// scripts/fuzz-floor-sweep.mts runs large sweeps and prints the worst ratio per shape.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEncoding } from "js-tiktoken";
import { ALL_SHAPES } from "./fuzz-shapes.ts";
import { runFuzz, type Case } from "./fuzz-runner.ts";

const SEEDS = Number(process.env.BURNBRAKE_FUZZ_SEEDS ?? 200);
const FIRST_SEED = Number(process.env.BURNBRAKE_FUZZ_FIRST_SEED ?? 1);
const seeds = Array.from({ length: SEEDS }, (_, i) => FIRST_SEED + i);
const enc = { cl100k: getEncoding("cl100k_base"), o200k: getEncoding("o200k_base") };
const SHAPES = ALL_SHAPES();
const TOOL_SHAPES = new Set(["json", "id_mixed_list", "url", "code"]);
const HEAVY = new Set(["letters_repeated_long", "letters_short_runs"]);

describe("input estimate fuzz floor (seeded, offline, cl100k and o200k)", () => {
  it(`estimate >= real for every shape over ${SEEDS} seeds, as a message and as tool-call JSON`, (t) => {
    const under: string[] = [];
    const onCase = (c: Case) => {
      if (c.ratio < 1 && under.length < 10) under.push(`${c.shape}/${c.path} seed ${c.seed}: estimate ${c.est} < real ${Math.max(c.cl100k, c.o200k)} for ${JSON.stringify(c.text.slice(0, 120))}`);
    };
    // Units of 7-16 letters repeated, and short runs of one letter, are slow to tokenize (BPE is
    // quadratic in a piece's length), so they run on a quarter of the seeds here; the offline
    // sweep runs them on every seed.
    const heavy = Object.fromEntries(Object.entries(SHAPES).filter(([k]) => HEAVY.has(k)));
    const light = Object.fromEntries(Object.entries(SHAPES).filter(([k]) => !HEAVY.has(k)));
    const stats = [
      ...runFuzz(light, seeds, enc, TOOL_SHAPES, onCase),
      ...runFuzz(heavy, seeds.slice(0, Math.ceil(seeds.length / 4)), enc, TOOL_SHAPES, onCase),
    ];
    t.diagnostic(stats.map((s) => `${s.shape} ${s.worst.ratio.toFixed(3)}`).join(", "));
    assert.equal(stats.length, Object.keys(SHAPES).length + TOOL_SHAPES.size);
    assert.deepEqual(under, []);
  });
});
