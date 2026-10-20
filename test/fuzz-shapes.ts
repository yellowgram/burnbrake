// Seeded, deterministic generators of prompt text for the input-estimate fuzz floor test
// (test/estimate-fuzz.test.ts). Each shape returns one prompt; the same seed always gives the
// same text. Shapes model what agent loops send: ids and keys, JSON, code, logs, URLs, mixed
// scripts and emoji, punctuation and whitespace runs.

export type Rng = () => number;

/** xorshift32 seeded through splitmix-style scrambling: fast, deterministic, no dependencies. */
export function rng(seed: number): Rng {
  let x = (seed ^ 0x9e3779b9) >>> 0 || 1;
  for (let i = 0; i < 4; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
  }
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chars = (r: Rng, alphabet: string, n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
};
const bytes = (r: Rng, n: number) => Buffer.from(Array.from({ length: n }, () => int(r, 0, 255)));
const list = (r: Rng, lo: number, hi: number, f: () => string, sep: string) => Array.from({ length: int(r, lo, hi) }, f).join(sep);

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "0123456789";
const HEX = "0123456789abcdef";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const B36 = DIGITS + LOWER;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const K8S = "bcdfghjklmnpqrstvwxz2456789";
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

export const WORDS = (
  "the of and to in is it for on with as was at by an be this that from or have not are but " +
  "user id name email status error request response token cost budget run agent tool call model " +
  "message content value result data item list count total price time date server client cache " +
  "config deploy service api key secret queue worker task job retry timeout limit offset page " +
  "summarize following meeting notes action items please return json format output input " +
  "function const let var return if else for while class import export async await new null " +
  "true false undefined string number boolean object array map filter reduce push length " +
  "internationalization configuration authentication authorization infrastructure kubernetes " +
  "pod node cluster namespace container image registry volume ingress replica deployment"
).split(" ");

const word = (r: Rng) => pick(r, WORDS);
const camel = (r: Rng) => { const n = int(r, 1, 4); let s = word(r); for (let i = 1; i < n; i++) { const w = word(r); s += w[0].toUpperCase() + w.slice(1); } return s; };
const snake = (r: Rng) => list(r, 1, 4, () => word(r), "_");
const sentence = (r: Rng) => { const s = list(r, 3, 14, () => word(r), " "); return s[0].toUpperCase() + s.slice(1) + pick(r, [".", ".", "?", "!", ":", ""]); };

// ---- ids and keys ----
const uuid = (r: Rng) => { const h = chars(r, HEX, 32); const u = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${pick(r, ["8", "9", "a", "b"])}${h.slice(17, 20)}-${h.slice(20)}`; return r() < 0.2 ? u.toUpperCase() : u; };
const ulid = (r: Rng) => chars(r, "01234567", 1) + chars(r, CROCKFORD, 25);
const akia = (r: Rng) => pick(r, ["AKIA", "ASIA", "AIDA", "AROA"]) + chars(r, B32.replace(/[01]/g, ""), 16);
const base32 = (r: Rng) => { const s = chars(r, B32, pick(r, [16, 26, 32, 52])); return r() < 0.3 ? s + "=".repeat(int(r, 0, 6)) : s; };
const totp = (r: Rng) => { const s = chars(r, B32, pick(r, [16, 32])); const t = r() < 0.4 ? s.toLowerCase() : s; return r() < 0.4 ? t.match(/.{4}/g)!.join(" ") : t; };
const base36 = (r: Rng) => chars(r, B36, int(r, 6, 16));
const base58 = (r: Rng) => chars(r, B58, pick(r, [11, 22, 32, 44]));
const base64 = (r: Rng) => bytes(r, int(r, 3, 96)).toString(pick(r, ["base64", "base64url"] as const));
const hexId = (r: Rng) => { const s = chars(r, HEX, pick(r, [4, 6, 7, 8, 12, 16, 32, 40, 64])); return (r() < 0.15 ? "0x" : "") + (r() < 0.2 ? s.toUpperCase() : s); };
const k8s = (r: Rng) => `${list(r, 1, 3, () => word(r), "-")}-${chars(r, K8S, int(r, 8, 10))}-${chars(r, K8S, 5)}`;
const jwt = (r: Rng) => [JSON.stringify({ alg: "HS256", typ: "JWT" }), JSON.stringify({ sub: uuid(r), iat: int(r, 1.6e9, 1.8e9), scope: word(r) })]
  .map((p) => Buffer.from(p).toString("base64url")).join(".") + "." + bytes(r, 32).toString("base64url");
const apiKey = (r: Rng) => pick(r, ["sk-proj-", "sk-ant-api03-", "ghp_", "xoxb-", "sk_test_", "AIza", "glpat-"]) + chars(r, B58 + "_-", int(r, 20, 48));
const nanoid = (r: Rng) => chars(r, "_-" + DIGITS + LOWER + UPPER, 21);
const ID_SHAPES = { uuid, ulid, akia, base32, totp, base36, base58, base64, hexId, k8s, jwt, apiKey, nanoid };

const anyId = (r: Rng) => pick(r, Object.values(ID_SHAPES))(r);

// ---- structured text ----
const url = (r: Rng) => {
  const path = list(r, 0, 5, () => (r() < 0.5 ? word(r) : anyId(r)), "/");
  const q = r() < 0.6 ? "?" + list(r, 1, 4, () => `${word(r)}=${r() < 0.5 ? int(r, 0, 99999) : anyId(r)}`, "&") : "";
  return `${pick(r, ["https", "http", "s3", "wss"])}://${word(r)}.${pick(r, ["com", "io", "dev", "internal"])}/${path}${q}${r() < 0.2 ? "#" + word(r) : ""}`;
};
const number = (r: Rng) => pick(r, [
  () => String(int(r, -1e6, 1e9)),
  () => (r() * 1000).toFixed(int(r, 1, 6)),
  () => (r() * 10).toExponential(int(r, 1, 4)),
  () => String(int(r, 0, 9)),
  () => `${int(r, 1, 31)}/${int(r, 1, 12)}/${int(r, 1990, 2030)}`,
  () => new Date(int(r, 0, 2e12)).toISOString(),
  () => `${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 0, 255)}`,
  () => `+1-${int(r, 200, 999)}-${int(r, 200, 999)}-${int(r, 1000, 9999)}`,
])();
const jsonValue = (r: Rng, depth: number): unknown => {
  const k = r();
  if (depth > 0 && k < 0.25) return Array.from({ length: int(r, 0, 5) }, () => jsonValue(r, depth - 1));
  if (depth > 0 && k < 0.5) return Object.fromEntries(Array.from({ length: int(r, 0, 6) }, () => [pick(r, [word, camel, snake])(r), jsonValue(r, depth - 1)]));
  return pick(r, [
    () => int(r, -1e6, 1e6), () => r() * 1e4, () => r() < 0.5, () => null,
    () => sentence(r), () => anyId(r), () => url(r), () => mixedScripts(r).slice(0, 40), () => `line1\nline2\t"q" \\ é`,
  ])();
};
const json = (r: Rng) => JSON.stringify(jsonValue(r, int(r, 1, 4)), null, pick(r, [0, 0, 2, 4, "\t"] as const));

const code = (r: Rng) => list(r, 3, 30, () => {
  const ind = " ".repeat(pick(r, [0, 2, 4, 8, 12])) ;
  return ind + pick(r, [
    () => `const ${camel(r)} = ${pick(r, [number, () => JSON.stringify(word(r)), camel])(r)};`,
    () => `if (${camel(r)} ${pick(r, ["===", "!==", "<=", ">=", "&&", "||"])} ${int(r, 0, 99)}) {`,
    () => `}`,
    () => `return ${camel(r)}(${list(r, 0, 3, () => camel(r), ", ")});`,
    () => `def ${snake(r)}(self, ${snake(r)}=None):`,
    () => `${snake(r)} = [x ** 2 for x in range(${int(r, 1, 100)})]`,
    () => `// ${sentence(r)}`,
    () => `# ${sentence(r)}`,
    () => `${camel(r)}.${camel(r)}(${JSON.stringify(anyId(r))}, { ${word(r)}: ${int(r, 0, 9)} });`,
    () => `SELECT ${snake(r)}, COUNT(*) FROM ${snake(r)} WHERE id = '${anyId(r)}' GROUP BY 1;`,
    () => `<div class="${word(r)}-${word(r)}">${sentence(r)}</div>`,
  ])();
}, pick(r, ["\n", "\r\n"]));

const logs = (r: Rng) => list(r, 1, 20, () =>
  `${new Date(int(r, 1.6e12, 1.9e12)).toISOString()} ${pick(r, ["INFO", "WARN", "ERROR", "DEBUG"])} [${k8s(r)}] trace=${chars(r, HEX, 32)} ${word(r)}=${anyId(r)} latency_ms=${int(r, 0, 9999)} ${sentence(r)}`, "\n");

// ---- scripts, emoji ----
const RANGES: Array<[number, number]> = [
  [0xc0, 0x17f], [0x370, 0x3ff], [0x400, 0x4ff], [0x5d0, 0x5ea], [0x600, 0x6ff], [0x900, 0x97f],
  [0xe00, 0xe7f], [0x3040, 0x30ff], [0x4e00, 0x9fff], [0xac00, 0xd7a3], [0x2200, 0x22ff], [0x2500, 0x257f],
  [0x20000, 0x2a6df], [0x1d400, 0x1d7ff], [0x300, 0x36f], [0x200b, 0x200f], [0xfe00, 0xfe0f],
];
const EMOJI = ["🙂", "🚀", "✨", "👍🏽", "👩‍👩‍👧‍👦", "🏳️‍🌈", "🧑🏽‍💻", "🇺🇸", "🇯🇵", "❤️", "🔥", "✅", "❌", "⚠️", "1️⃣", "©", "™", "😀😃😄"];
const mixedScripts = (r: Rng) => list(r, 1, 30, () => {
  const k = r();
  if (k < 0.2) return word(r);
  if (k < 0.35) return pick(r, EMOJI);
  const [lo, hi] = pick(r, RANGES);
  return Array.from({ length: int(r, 1, 8) }, () => String.fromCodePoint(int(r, lo, hi))).join("");
}, pick(r, [" ", "", "\n", ", "]));
const emoji = (r: Rng) => list(r, 1, 60, () => pick(r, EMOJI), pick(r, ["", " ", "\n"]));

// ---- punctuation, whitespace, ascii ----
const punctuation = (r: Rng) => list(r, 1, 60, () => chars(r, PUNCT, int(r, 1, 8)), pick(r, ["", " ", "a", "\n"]));
const whitespace = (r: Rng) => list(r, 1, 40, () => (r() < 0.4 ? word(r) : chars(r, pick(r, [" \t\n\r\u000b\u000c", " \n", "\t\n", " "]), int(r, 1, 30))), "");
const asciiNoise = (r: Rng) => Array.from({ length: int(r, 1, 300) }, () => String.fromCharCode(int(r, 0, 127))).join("");
const prose = (r: Rng) => list(r, 1, 12, () => sentence(r), " ");
const idList = (r: Rng) => list(r, 1, 20, () => anyId(r), pick(r, [" ", "\n", ", ", ","]));

/** Shapes the estimate must be a floor for (estimate >= real on cl100k and on o200k). */
export const FLOOR_SHAPES: Record<string, (r: Rng) => string> = {
  ...Object.fromEntries(Object.entries(ID_SHAPES).map(([k, f]) => [`id_${k}`, (r: Rng) => list(r, 1, 6, () => f(r), pick(r, [" ", "\n", ", "]))])),
  id_mixed_list: idList,
  url: (r) => list(r, 1, 5, () => url(r), "\n"),
  numbers: (r) => list(r, 1, 50, () => number(r), pick(r, [" ", ",", "\n", ", ", "\t"])),
  json,
  code,
  logs,
  mixed_scripts: mixedScripts,
  emoji,
  punctuation,
  whitespace,
  ascii_noise: asciiNoise,
  prose,
  prose_upper: (r) => prose(r).toUpperCase(),
  prose_title: (r) => list(r, 3, 30, () => { const w = word(r); return w[0].toUpperCase() + w.slice(1); }, " "),
  identifiers: (r) => list(r, 1, 30, () => pick(r, [camel, snake, (q: Rng) => camel(q)[0].toUpperCase() + camel(q).slice(1), (q: Rng) => snake(q).toUpperCase()])(r), pick(r, [" ", "\n", ", ", "."])),
  concatenated: (r) => list(r, 1, 20, () => list(r, 2, 4, () => word(r), pick(r, ["", "", "-", "."])), pick(r, [" ", "\n", "/"])),
  prose_with_ids: (r) => list(r, 1, 8, () => `${sentence(r)} ${anyId(r)}`, " "),
};

/** Every shape the fuzz test checks. */
export const ALL_SHAPES = (): Record<string, (r: Rng) => string> => ({ ...FLOOR_SHAPES, ...LETTER_SHAPES });

/** Random letter-only strings (no digits): word-like pairs are rare, so they count near one token per letter. */
export const LETTER_SHAPES: Record<string, (r: Rng) => string> = {
  letters_lower: (r) => list(r, 1, 20, () => chars(r, LOWER, int(r, 2, 12)), " "),
  letters_upper: (r) => list(r, 1, 20, () => chars(r, UPPER, int(r, 2, 12)), " "),
  letters_mixed: (r) => list(r, 1, 20, () => chars(r, LOWER + UPPER, int(r, 2, 14)), " "),
  letters_run_together: (r) => chars(r, pick(r, [LOWER, UPPER, LOWER + UPPER]), int(r, 2, 60)),
  // A unit of 1-6 letters repeated ("llll", "abab", "ssnSSN"), sometimes with the case of each
  // repetition flipped at random; one to three such runs, run together or separated.
  letters_repeated: (r) => list(r, 1, 3, () => {
    const unit = chars(r, pick(r, [LOWER, UPPER, LOWER + UPPER]), int(r, 1, 6));
    const flip = r() < 0.3;
    let s = "";
    const n = int(r, 2, 300);
    while (s.length < n) s += flip && r() < 0.5 ? unit.toUpperCase() === unit ? unit.toLowerCase() : unit.toUpperCase() : unit;
    return s.slice(0, n);
  }, pick(r, ["", " ", "\n"])),
};
