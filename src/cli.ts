#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { decisionsToCsv, Ledger, type ScopeName } from "./ledger.js";
import { microsToUsd, usdToMicros } from "./money.js";
import { loadPriceTable, priceTableFreshness } from "./prices.js";
import { startSidecar } from "./server.js";

interface Io {
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  error: (line: string) => void;
}

const HELP = `BurnBrake — request-path spend governor (cap + kill)

  burnbrake serve
  burnbrake balances [--user id] [--run id] [--json]
  burnbrake decisions [--deny-only] [--user id] [--run id] [--limit n] [--format json|csv]
  burnbrake export --run id [--user id] [--format json|csv]
  burnbrake kill --run id
  burnbrake pause --run id | --global
  burnbrake resume --run id | --global
  burnbrake caps set --scope user|run|day [--key id] (--usd N | --micros N)
  burnbrake force-release --reservation id --reason "..." --attest-no-charge
  burnbrake top-runs [--window 1h|24h]
  burnbrake reservations [--state FORWARDED] [--run id]

The CLI reads the SQLite ledger directly (BURNBRAKE_LEDGER_PATH or --ledger).
Auth rotation: change BURNBRAKE_KEY and restart the sidecar. Every agent on this
deploy must pick up the new key. Do not rotate by pasting the provider key.
`;

export async function execute(argv: string[], io: Io = defaultIo()): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.log(HELP);
      return 0;
    }
    if (command === "serve") return await serve(args, io);
    if (command === "balances") return balances(args, io);
    if (command === "decisions") return decisions(args, io);
    if (command === "export") return decisions(args.includes("--format") ? args : ["--format", "json", ...args], io);
    if (command === "kill") {
      if (!args.includes("--run")) throw new Error("--run is required");
      return pause(args, io, true);
    }
    if (command === "pause") return pause(args, io, true);
    if (command === "resume") return pause(args, io, false);
    if (command === "caps") return caps(args[0] === "set" ? args.slice(1) : args, io);
    if (command === "force-release") return forceRelease(args, io);
    if (command === "top-runs") return topRuns(args, io);
    if (command === "reservations") return reservations(args, io);
    io.error(`Unknown command: ${command}\n${HELP}`);
    return 1;
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function serve(argv: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      ledger: { type: "string" },
      mock: { type: "boolean", default: false },
    },
    strict: true,
  });
  const env = { ...io.env };
  if (values.host) env.BURNBRAKE_HOST = values.host;
  if (values.port) env.BURNBRAKE_PORT = values.port;
  if (values.ledger) env.BURNBRAKE_LEDGER_PATH = values.ledger;
  if (values.mock) env.BURNBRAKE_MOCK_UPSTREAM = "1";
  const preview = loadConfig(env);
  mkdirSync(dirname(preview.ledgerPath), { recursive: true });
  const sidecar = await startSidecar({ env });
  const warning = sidecar.ledger.scopeWarning();
  io.log(`BurnBrake listening on http://${sidecar.host}:${sidecar.port}`);
  io.log("Auth required (X-BurnBrake-Key or Bearer bb_…). Provider key stays on the upstream hop only.");
  io.log("Point OPENAI_BASE_URL at this sidecar. BurnBrake only governs traffic that hits it.");
  io.log("402 BUDGET_EXHAUSTED means halt. Do not treat it as a rate limit.");
  if (warning) io.log(`warning: ${warning}`);
  if (sidecar.config.mockUpstream) io.log("mock upstream: on");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await sidecar.close();
  return 0;
}

function balances(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      user: { type: "string" },
      run: { type: "string" },
      ledger: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  const { ledger, table, config } = openLedger(values.ledger, io.env);
  try {
    const report = ledger.balances({ userId: values.user ?? null, runId: values.run ?? null });
    const fresh = priceTableFreshness(table, ledger.now(), config.staleWarnDays);
    const payload = {
      ...report,
      price_table: { version: table.version, priced_at: table.pricedAt, stale: fresh.stale, stale_warn_days: config.staleWarnDays },
      estimate: { default_max_tokens: config.defaultMaxTokens },
    };
    if (values.json) {
      io.log(JSON.stringify(payload, null, 2));
      return 0;
    }
    if (payload.warning) io.log(`warning: ${payload.warning}`);
    io.log(`day ${payload.day_key} UTC  price ${table.version} priced_at ${table.pricedAt}${fresh.stale ? " STALE" : ""}`);
    io.log(`default max_tokens ${config.defaultMaxTokens}  global paused ${payload.paused.global}`);
    for (const scope of payload.scopes) {
      io.log(
        `${scope.scope} ${scope.key}  cap ${microsToUsd(scope.cap_micros)} USD  spent ${microsToUsd(scope.spent_micros)}  held ${microsToUsd(scope.held_micros)}  remaining ${microsToUsd(scope.remaining_micros)}  debt ${microsToUsd(scope.debt_micros)}  overshoot ${microsToUsd(scope.overshoot_micros)}  active ${scope.active_reservations}`,
      );
    }
    if (payload.scopes.length === 0) io.log("no scope accounts yet");
    return 0;
  } finally {
    ledger.close();
  }
}

function decisions(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      "deny-only": { type: "boolean", default: false },
      user: { type: "string" },
      run: { type: "string" },
      limit: { type: "string" },
      format: { type: "string", default: "json" },
      ledger: { type: "string" },
    },
    strict: false,
  });
  const { ledger } = openLedger(typeof values.ledger === "string" ? values.ledger : undefined, io.env);
  try {
    const rows = ledger.listDecisions({
      denyOnly: values["deny-only"] === true,
      userId: typeof values.user === "string" ? values.user : undefined,
      runId: typeof values.run === "string" ? values.run : undefined,
      limit: values.limit ? Number(values.limit) : 100,
    });
    io.log(values.format === "csv" ? decisionsToCsv(rows) : JSON.stringify({ decisions: rows }, null, 2));
    return 0;
  } finally {
    ledger.close();
  }
}

function pause(argv: string[], io: Io, paused: boolean): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string" },
      global: { type: "boolean", default: false },
      ledger: { type: "string" },
    },
    strict: false,
  });
  const run = typeof values.run === "string" ? values.run : "";
  if (!run && values.global !== true) throw new Error("Provide --run or --global");
  const { ledger } = openLedger(typeof values.ledger === "string" ? values.ledger : undefined, io.env);
  try {
    if (values.global === true) ledger.pauseGlobal(paused);
    if (run) ledger.pauseRun(run, paused);
    io.log(paused ? `paused ${run ? `run ${run}` : "global"}` : `resumed ${run ? `run ${run}` : "global"}`);
    return 0;
  } finally {
    ledger.close();
  }
}

function caps(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string" },
      key: { type: "string" },
      usd: { type: "string" },
      micros: { type: "string" },
      ledger: { type: "string" },
    },
    strict: true,
  });
  if (values.scope !== "user" && values.scope !== "run" && values.scope !== "day") {
    throw new Error("--scope must be user, run, or day");
  }
  if ((values.usd == null) === (values.micros == null)) {
    throw new Error("Provide exactly one of --usd or --micros");
  }
  const micros = values.micros != null ? Number(values.micros) : usdToMicros(values.usd ?? "0");
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error("invalid cap");
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    const scope = values.scope as ScopeName;
    const key = values.key ?? null;
    if (!key) {
      ledger.setDefaultCap(scope, micros);
      if (scope === "day") ledger.setCap("day", ledger.utcDay(), micros);
    } else {
      const resolved = scope === "day" && key === "today" ? ledger.utcDay() : key;
      ledger.setCap(scope, resolved, micros);
    }
    const warning = ledger.scopeWarning();
    io.log(`cap ${scope}${key ? ` ${key}` : " default"} = ${microsToUsd(micros)} USD`);
    if (warning) io.log(`warning: ${warning}`);
    return 0;
  } finally {
    ledger.close();
  }
}

function forceRelease(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      reservation: { type: "string" },
      reason: { type: "string" },
      "attest-no-charge": { type: "boolean", default: false },
      ledger: { type: "string" },
    },
    strict: true,
  });
  if (!values["attest-no-charge"]) {
    throw new Error("Refusing force-release without --attest-no-charge. TTL after forward debits the estimate.");
  }
  if (!values.reservation || !values.reason) throw new Error("--reservation and --reason are required");
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    ledger.forceRelease(values.reservation, values.reason);
    io.log(`FORCE_RELEASE_AUDITED ${values.reservation}`);
    return 0;
  } finally {
    ledger.close();
  }
}

function topRuns(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      window: { type: "string", default: "24h" },
      ledger: { type: "string" },
    },
    strict: true,
  });
  const windowMs = values.window === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    io.log(JSON.stringify({ window: values.window === "1h" ? "1h" : "24h", runs: ledger.topRuns(windowMs) }, null, 2));
    return 0;
  } finally {
    ledger.close();
  }
}

function reservations(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      state: { type: "string" },
      run: { type: "string" },
      ledger: { type: "string" },
    },
    strict: true,
  });
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    io.log(JSON.stringify({ reservations: ledger.listReservations({ state: values.state, runId: values.run }) }, null, 2));
    return 0;
  } finally {
    ledger.close();
  }
}

function openLedger(path: string | undefined, env: NodeJS.ProcessEnv): {
  ledger: Ledger;
  table: ReturnType<typeof loadPriceTable>;
  config: ReturnType<typeof loadConfig>;
} {
  const config = loadConfig(
    { ...env, ...(path ? { BURNBRAKE_LEDGER_PATH: path } : {}) },
    { requireKey: false },
  );
  mkdirSync(dirname(config.ledgerPath), { recursive: true });
  const table = loadPriceTable(config.priceTablePath);
  const ledger = new Ledger(config.ledgerPath, { reservationTtlMs: config.reservationTtlMs });
  return { ledger, table, config };
}

function defaultIo(): Io {
  return {
    env: process.env,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };
}

const invokedDirectly = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (invokedDirectly) {
  execute(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
