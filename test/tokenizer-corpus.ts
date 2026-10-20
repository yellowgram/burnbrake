// Deterministic prompts for the input-estimate floor test (test/estimate-floor.test.ts).
// Real token counts for each are pinned in that test (cl100k_base and o200k_base, js-tiktoken).

function seeded(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
}

export function corpus(): Record<string, string> {
  const r = seeded(42);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return {
    one_to_ten: "1 2 3 4 5 6 7 8 9 10",
    spaced_numbers: Array.from({ length: 3000 }, (_, i) => String(i)).join(" "),
    random_numbers: Array.from({ length: 2000 }, () => String(Math.floor(r() * 1e7))).join(" "),
    decimals: Array.from({ length: 1000 }, () => (r() * 1000).toFixed(3)).join(", "),
    csv: Array.from({ length: 300 }, (_, i) => `${i},${(r() * 100).toFixed(2)},${Math.floor(r() * 1e6)},2026-10-${String(1 + (i % 28)).padStart(2, "0")}`).join("\n"),
    logs: Array.from({ length: 300 }, (_, i) => `2026-10-20T06:${String(i % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z INFO req=${i} status=200 latency_ms=${Math.floor(r() * 900)} ip=10.${i % 256}.${(i * 7) % 256}.1`).join("\n"),
    markdown_table: Array.from({ length: 200 }, (_, i) => `| ${i} | ${i * 3} | ${(i / 7).toFixed(4)} |`).join("\n"),
    uuids: Array.from({ length: 300 }, () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`).join(" "),
    url: Array.from({ length: 200 }, (_, i) => `https://example.com/api/v2/items/${i}?q=${Math.floor(r() * 1e6)}&sort=desc`).join(" "),
    english: "Summarize the following meeting notes and list action items. ".repeat(200),
    code: "function f(x){return x*2+1;}\nconst a = [1, 2, 3].map((v) => v ** 2);\n".repeat(150),
    whitespace: "a  b   c    d\t\te\n\n\nf ".repeat(300),
    cjk: "日本語のテキストを要約してください。".repeat(200),
    chinese: "我们需要在下周一之前完成这个项目的所有测试。".repeat(200),
    russian: "Пожалуйста, кратко изложите следующие заметки о встрече. ".repeat(200),
    // Known exceptions: the estimate is NOT a floor for these (see README "Limits").
    json: JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item${i}`, price: i * 1.5, ok: i % 2 === 0 }))),
    hex_ips: Array.from({ length: 500 }, () => `0x${Math.floor(r() * 2 ** 32).toString(16)} 192.168.${Math.floor(r() * 256)}.${Math.floor(r() * 256)}`).join(" "),
    punctuation: "!!! ??? ... ;;; ::: --- ___ *** ### @@@ $$$ %%% ^^^ &&& ((( ))) ".repeat(100),
    base64: Buffer.from(Array.from({ length: 6000 }, () => Math.floor(r() * 256))).toString("base64"),
    korean: "다음 회의록을 요약하고 실행 항목을 나열하십시오. ".repeat(200),
    arabic: "يرجى تلخيص ملاحظات الاجتماع التالية. ".repeat(200),
    hindi: "कृपया निम्नलिखित बैठक नोट्स का सारांश दें। ".repeat(200),
    emoji: "🙂🚀✨ ".repeat(500),
    emoji_zwj: "👩‍👩‍👧‍👦🏳️‍🌈🧑🏽‍💻".repeat(300),
    math: "∑∫∂√∞≈≠≤≥±×÷ ".repeat(300),
  };
}
