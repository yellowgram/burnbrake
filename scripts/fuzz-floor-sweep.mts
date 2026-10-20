// Large offline sweep of the input-estimate fuzz (not part of npm test):
//   node --import tsx scripts/fuzz-floor-sweep.mts [seeds=5000] [firstSeed=1]
// Prints the worst and mean estimate/real ratio per shape and every case under 1.0, then the
// measured worst ratio of the documented-limit shapes.
import { getEncoding } from "js-tiktoken";
import { ALL_SHAPES, LIMIT_SHAPES } from "../test/fuzz-shapes.ts";
import { runFuzz } from "../test/fuzz-runner.ts";

const n = Number(process.argv[2] ?? 5000);
const first = Number(process.argv[3] ?? 1);
const enc = { cl100k: getEncoding("cl100k_base"), o200k: getEncoding("o200k_base") };
const seeds = Array.from({ length: n }, (_, i) => first + i);
const under: string[] = [];
let cases = 0;
let underCount = 0;
let worstDeficit = 0;
const t0 = Date.now();
const floor = runFuzz(ALL_SHAPES(), seeds, enc, new Set(["json", "id_mixed_list", "url", "code"]), (c) => {
  cases += 1;
  if (c.ratio < 1) {
    underCount += 1;
    worstDeficit = Math.max(worstDeficit, Math.max(c.cl100k, c.o200k) - c.est);
  }
  if (c.ratio < 1 && under.length < 40) under.push(`  UNDER ${c.shape}/${c.path} seed ${c.seed}: est ${c.est} cl100k ${c.cl100k} o200k ${c.o200k} ${JSON.stringify(c.text.slice(0, 160))}`);
});
console.log(`${cases} cases over seeds ${first}..${first + n - 1} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const s of floor) console.log(`  ${s.worst.ratio < 1 ? "UNDER" : "ok   "} ${s.shape.padEnd(28)} cases ${String(s.cases).padStart(6)}  worst ${s.worst.ratio.toFixed(3)} (seed ${s.worst.seed})  mean ${s.meanRatio.toFixed(2)}`);
console.log(underCount ? `${underCount} case(s) under; largest miss ${worstDeficit} token(s)\n${under.join("\n")}` : "no floor case under 1.0");
// Documented limits (not floor shapes): report the measured worst ratio, nothing is asserted here.
const limits = runFuzz(LIMIT_SHAPES, seeds, enc);
for (const s of limits) console.log(`  limit ${s.shape.padEnd(28)} cases ${String(s.cases).padStart(6)}  worst ${s.worst.ratio.toFixed(3)} (seed ${s.worst.seed})  mean ${s.meanRatio.toFixed(2)}`);
