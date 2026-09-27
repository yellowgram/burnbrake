import { Ledger } from "../src/ledger.ts";

const ledger = new Ledger(process.env.LEDGER_PATH ?? "", { reservationTtlMs: 60_000 });
const result = ledger.reserve({
  userId: null,
  runId: process.env.RUN_ID ?? "race-run",
  estimateMicros: Number(process.env.ESTIMATE_MICROS ?? "800"),
  idempotencyKey: process.env.IDEM_KEY ?? null,
  model: "gpt-4o-mini",
  route: "/v1/chat/completions",
  maxTokens: 16,
  maxTokensSource: "request",
  priceTableVersion: "test",
});
ledger.close();
process.stdout.write(JSON.stringify(result));
