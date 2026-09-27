#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BrakeConfigError, mergeBrakeConfig } from "./brake.js";
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
  burnbrake brake show [--json]
  burnbrake brake set [--enabled true|false] [--amber-pct N] [--red-pct N]
                       [--amber-delay-ms N] [--red-delay-ms N] [--black-delay-ms N]
                       [--max-delay-ms N]
  burnbrake force-release --reservation id --reason "..." --attest-no-charge
  burnbrake top-runs [--window 1h|24h]
  burnbrake reservations [--state FORWARDED] [--run id]

The CLI reads the SQLite ledger directly (BURNBRAKE_LEDGER_PATH or --ledger).
Filesystem access to that file is operator control. Protect the file.
HTTP /v1/operator/* requires BURNBRAKE_OPERATOR_KEY, a bb_ secret distinct from
BURNBRAKE_KEY and from the provider key. If it is unset, operator HTTP is off.
Auth rotation: change BURNBRAKE_KEY (agents) and BURNBRAKE_OPERATOR_KEY (operator
HTTP), then restart. Do not rotate by pasting the provider key.

brake.enabled defaults to false and is not a halt-off switch. A set applies on
the next reserve. An in-flight FORWARDED call is not delayed or rewritten.
At the cap the response is still HTTP 402 halt, not 429.
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
    if (command === "brake") return brake(args, io);
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
  io.log(
    sidecar.config.brake.enabled
      ? "brake curve: on. Delays apply on the next reserve. 402 halt is unchanged."
      : "brake curve: off. brake.enabled is not a halt-off switch.",
  );
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

function brake(argv: string[], io: Io): number {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === "show") return brakeShow(rest, io);
  if (sub === "set") return brakeSet(rest, io);
  throw new Error("usage: burnbrake brake show|set");
}

function brakeShow(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      ledger: { type: "string" },
    },
    strict: true,
  });
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    const current = ledger.getBrake();
    if (values.json) {
      io.log(JSON.stringify({ brake: current, note: BRAKE_NOTE }, null, 2));
      return 0;
    }
    io.log(`brake.enabled ${current.enabled}`);
    io.log(`amber_pct ${current.amber_pct}`);
    io.log(`red_pct ${current.red_pct}`);
    io.log(`amber_delay_ms ${current.amber_delay_ms}`);
    io.log(`red_delay_ms ${current.red_delay_ms}`);
    io.log(`black_delay_ms ${current.black_delay_ms}`);
    io.log(`max_delay_ms ${current.max_delay_ms}`);
    io.log(BRAKE_NOTE);
    return 0;
  } finally {
    ledger.close();
  }
}

function brakeSet(argv: string[], io: Io): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      enabled: { type: "string" },
      "amber-pct": { type: "string" },
      "red-pct": { type: "string" },
      "amber-delay-ms": { type: "string" },
      "red-delay-ms": { type: "string" },
      "black-delay-ms": { type: "string" },
      "max-delay-ms": { type: "string" },
      ledger: { type: "string" },
    },
    strict: true,
  });
  const patch: Record<string, unknown> = {};
  if (values.enabled != null) patch.enabled = parseEnabledFlag(values.enabled);
  if (values["amber-pct"] != null) patch.amber_pct = Number(values["amber-pct"]);
  if (values["red-pct"] != null) patch.red_pct = Number(values["red-pct"]);
  if (values["amber-delay-ms"] != null) patch.amber_delay_ms = Number(values["amber-delay-ms"]);
  if (values["red-delay-ms"] != null) patch.red_delay_ms = Number(values["red-delay-ms"]);
  if (values["black-delay-ms"] != null) patch.black_delay_ms = Number(values["black-delay-ms"]);
  if (values["max-delay-ms"] != null) patch.max_delay_ms = Number(values["max-delay-ms"]);
  const { ledger } = openLedger(values.ledger, io.env);
  try {
    const next = mergeBrakeConfig(ledger.getBrake(), patch);
    ledger.setBrake(next);
    io.log(`brake.enabled ${next.enabled}`);
    io.log(`amber_pct ${next.amber_pct}  red_pct ${next.red_pct}`);
    io.log(
      `delays amber ${next.amber_delay_ms}  red ${next.red_delay_ms}  black ${next.black_delay_ms}  max ${next.max_delay_ms}`,
    );
    io.log("applies on the next reserve. In-flight FORWARDED calls are not rewritten.");
    io.log(BRAKE_NOTE);
    return 0;
  } finally {
    ledger.close();
  }
}

function parseEnabledFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new BrakeConfigError("enabled must be true or false");
}

const BRAKE_NOTE = "brake.enabled is not a halt-off switch. A black delay does not change a 402 halt.";

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
