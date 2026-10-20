import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { VERSION } from "./constants.js";
import { authenticate } from "./auth.js";
import { assertProductionScopes, DUAL_CLIENT_NOTE, EXHAUST_CONTRACT, TENANCY_NOTE } from "./deploy.js";
import { BrakeConfigError, mergeBrakeConfig, sleepMs, type BrakeConfig } from "./brake.js";
import { loadConfig, type AppConfig } from "./config.js";
import { errorBody, httpStatusForEstimate, type ErrorFields } from "./errors.js";
import {
  costFromUsage,
  estimateRequest,
  TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR,
  TOOLS_FLAT_MICROS_FLOOR,
  VISION_FLAT_MICROS_FLOOR,
  VISION_INPUT_TOKEN_FLOOR,
  type GovernedRoute,
} from "./estimate.js";
import { decisionsToCsv, Ledger, type BrakePreview, type DecisionInput, type DefaultCaps, type ExtendResult, type ReserveResult, type ScopeName } from "./ledger.js";
import { loadPriceTable, priceTableFreshness, type PriceTable } from "./prices.js";
import { deriveReplayKey, openReplayBody, sealReplayBody } from "./replay-body.js";
import { forwardToUpstream, settleUsage, SseUsageTracker, type MockState, type Usage } from "./upstream.js";
import { SseEventFramer, StreamMeter, terminalErrorEvent } from "./stream-meter.js";
import { usdToMicros } from "./money.js";

const GOVERNED = new Set<GovernedRoute>(["/v1/chat/completions", "/v1/completions", "/v1/messages"]);

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  host?: string;
  port?: number;
  allowPublicBind?: boolean;
  apiKey?: string;
  operatorKey?: string;
  ledgerPath?: string;
  priceTablePath?: string;
  mockUpstream?: boolean;
  upstreamBaseURL?: string;
  openaiApiKey?: string | null;
  defaultMaxTokens?: number;
  reservationTtlMs?: number;
  caps?: DefaultCaps;
  now?: () => number;
  beforeForward?: () => Promise<void>;
  /** Test hook. Production waits with setTimeout. Must not run inside a ledger transaction. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunningSidecar {
  baseURL: string;
  host: string;
  port: number;
  config: AppConfig;
  ledger: Ledger;
  mock: MockState;
  close: () => Promise<void>;
}

export async function startSidecar(options: StartOptions = {}): Promise<RunningSidecar> {
  const env = { ...process.env, ...options.env };
  if (options.apiKey) env.BURNBRAKE_KEY = options.apiKey;
  if (options.operatorKey != null) env.BURNBRAKE_OPERATOR_KEY = options.operatorKey;
  if (options.host) env.BURNBRAKE_HOST = options.host;
  if (options.port != null) env.BURNBRAKE_PORT = String(options.port);
  if (options.allowPublicBind != null) env.BURNBRAKE_ALLOW_PUBLIC_BIND = options.allowPublicBind ? "1" : "0";
  if (options.ledgerPath) env.BURNBRAKE_LEDGER_PATH = options.ledgerPath;
  if (options.priceTablePath) env.BURNBRAKE_PRICE_TABLE = options.priceTablePath;
  if (options.mockUpstream != null) env.BURNBRAKE_MOCK_UPSTREAM = options.mockUpstream ? "1" : "0";
  if (options.upstreamBaseURL) env.BURNBRAKE_UPSTREAM_BASE_URL = options.upstreamBaseURL;
  if (options.openaiApiKey) env.OPENAI_API_KEY = options.openaiApiKey;
  if (options.defaultMaxTokens != null) env.BURNBRAKE_DEFAULT_MAX_TOKENS = String(options.defaultMaxTokens);
  if (options.reservationTtlMs != null) env.BURNBRAKE_RESERVATION_TTL_MS = String(options.reservationTtlMs);

  const config = loadConfig(env);
  const effectiveCaps = options.caps ?? config.caps;
  assertProductionScopes(effectiveCaps, env);
  const table = loadPriceTable(config.priceTablePath);
  const anthropicTable = loadPriceTable(config.anthropicPriceTablePath);
  const replayKey = config.replayKey ? deriveReplayKey(config.replayKey) : null;
  const freshness = priceTableFreshness(table, Date.now(), config.staleWarnDays);
  if (freshness.stale) {
    console.warn(
      `BurnBrake price table ${table.version} priced_at ${table.pricedAt} is older than ${config.staleWarnDays} days. Still enforcing (not fail-open). Update the YAML.`,
    );
  }
  const ledger = new Ledger(config.ledgerPath, {
    reservationTtlMs: config.reservationTtlMs,
    now: options.now,
    defaultCaps: effectiveCaps,
    productionDurableScope: config.production,
    writerLease: config.writerLease ?? undefined,
    replayBodyTtlMs: config.idempotencyBodyTtlMs,
    replaySeal: replayKey ? (plain) => sealReplayBody(plain, replayKey) : undefined,
    replayOpen: replayKey ? (stored) => openReplayBody(stored, replayKey) : undefined,
  });
  console.warn(`BurnBrake deploy invariant: ${DUAL_CLIENT_NOTE}`);
  console.warn(
    "BurnBrake day clock: UTC keys use this process clock. More than one writer requires one shared store and one clock. This is not a multi-pod ledger.",
  );
  if (!effectiveCaps.user && !effectiveCaps.day) {
    console.warn(
      "BurnBrake scope warning: run-only or empty caps. Production requires a user cap and/or a day cap. Caller-chosen run ids can be rotated.",
    );
  }
  ledger.setBrake(config.brake);
  ledger.sweep();
  const sleep = options.sleep ?? sleepMs;
  const mock: MockState = { forwardCount: 0, lastBody: null, lastRoute: null };
  const server = createServer((req, res) => {
    void handleRequest(req, res, { config, ledger, table, anthropicTable, mock, beforeForward: options.beforeForward, sleep }).catch((err) => {
      if (!res.headersSent) {
        sendJson(
          res,
          503,
          errorBody({
            code: "LEDGER_UNAVAILABLE",
            httpStatus: 503,
            message: "Spend path failed closed.",
            halt: true,
            retryable: false,
          }),
        );
      } else {
        res.destroy();
      }
      console.error("BurnBrake request failed closed", err instanceof Error ? err.message : err);
    });
  });
  await listen(server, config.port, config.host);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  config.port = port;
  const timer = setInterval(() => {
    try {
      ledger.sweep();
      ledger.renewWriterLease();
    } catch (err) {
      console.error("BurnBrake reservation sweep failed", err instanceof Error ? err.message : err);
    }
  }, 30_000);
  timer.unref?.();
  const leaseTimer =
    config.writerLease == null
      ? null
      : setInterval(() => {
          try {
            ledger.renewWriterLease();
          } catch (err) {
            console.error("BurnBrake writer lease renew failed", err instanceof Error ? err.message : err);
          }
        }, Math.max(1_000, Math.floor(config.writerLease.ttlMs / 3)));
  leaseTimer?.unref?.();
  return {
    baseURL: `http://${config.host}:${port}`,
    host: config.host,
    port,
    config,
    ledger,
    mock,
    close: async () => {
      clearInterval(timer);
      if (leaseTimer) clearInterval(leaseTimer);
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      ledger.close();
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    config: AppConfig;
    ledger: Ledger;
    table: PriceTable;
    anthropicTable: PriceTable;
    mock: MockState;
    beforeForward?: () => Promise<void>;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, healthBody(ctx));
    return;
  }
  if (req.method === "POST" && path === "/v1/burnbrake/heartbeat") {
    await handleHeartbeat(req, res, ctx);
    return;
  }
  if (path.startsWith("/v1/operator/")) {
    try {
      await handleOperator(req, res, ctx, path, url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Bad operator request";
      if (message === "BODY_TOO_LARGE" || message === "JSON object required" || err instanceof SyntaxError) {
        sendJson(
          res,
          message === "BODY_TOO_LARGE" ? 413 : 400,
          errorBody({
            code: message === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : "BAD_REQUEST",
            httpStatus: message === "BODY_TOO_LARGE" ? 413 : 400,
            message: message === "BODY_TOO_LARGE" ? "Request body exceeds 1 MiB." : "Operator body must be a JSON object.",
            halt: false,
            retryable: false,
          }),
        );
        return;
      }
      throw err;
    }
    return;
  }
  if (req.method === "POST" && GOVERNED.has(path as GovernedRoute)) {
    await handleGoverned(req, res, ctx, path as GovernedRoute);
    return;
  }
  if (path.startsWith("/v1/")) {
    sendJson(
      res,
      404,
      errorBody({
        code: "ROUTE_NOT_GOVERNED",
        httpStatus: 404,
        message: `Route ${path} is not governed. BurnBrake forwards only /v1/chat/completions, /v1/completions, and /v1/messages. Unknown routes are not proxied.`,
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  sendJson(res, 404, errorBody({ code: "NOT_FOUND", httpStatus: 404, message: "Not found.", halt: false, retryable: false }));
}

function healthBody(ctx: {
  config: AppConfig;
  ledger: Ledger;
  table: PriceTable;
  anthropicTable: PriceTable;
  mock: MockState;
}): Record<string, unknown> {
  const fresh = priceTableFreshness(ctx.table, ctx.ledger.now(), ctx.config.staleWarnDays);
  const anthropicFresh = priceTableFreshness(ctx.anthropicTable, ctx.ledger.now(), ctx.config.staleWarnDays);
  const writable = ctx.ledger.isWritable();
  return {
    ok: writable,
    version: VERSION,
    listen: ctx.config.host,
    port: ctx.config.port,
    auth: { required: true, rotation_overlap: ctx.config.apiKeys.length > 1 },
    ledger: { writable },
    fail_closed: true,
    price_table: {
      version: ctx.table.version,
      priced_at: ctx.table.pricedAt,
      stale: fresh.stale,
      age_days: Number(fresh.ageDays.toFixed(2)),
      stale_warn_days: fresh.staleWarnDays,
    },
    estimate: {
      default_max_tokens: ctx.config.defaultMaxTokens,
      floors: {
        vision_input_tokens: VISION_INPUT_TOKEN_FLOOR,
        vision_flat_micros: VISION_FLAT_MICROS_FLOOR,
        tools_extra_output_tokens: TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR,
        tools_flat_micros: TOOLS_FLAT_MICROS_FLOOR,
      },
    },
    stream_kill: { enabled: ctx.config.streamKill },
    reservation_ttl_seconds: Math.round(ctx.config.reservationTtlMs / 1000),
    day_boundary: "UTC",
    day_clock: {
      boundary: "UTC",
      source: "process",
      multi_writer: "unsupported without one shared store and one process clock",
      writer_lease: ctx.config.writerLease ? "required" : "off",
      writer_lease_held: ctx.ledger.writerLeaseHeld(),
    },
    scopes_warning: ctx.ledger.scopeWarning(),
    operator_http: Boolean(ctx.config.operatorKey),
    mock_upstream: ctx.config.mockUpstream
      ? { enabled: true, forward_count: ctx.mock.forwardCount }
      : { enabled: false },
    routes: ["/v1/chat/completions", "/v1/completions", "/v1/messages"],
    anthropic_price_table: {
      version: ctx.anthropicTable.version,
      priced_at: ctx.anthropicTable.pricedAt,
      stale: anthropicFresh.stale,
    },
    replay: {
      body_ttl_seconds: Math.round(ctx.config.idempotencyBodyTtlMs / 1000),
      encrypted: Boolean(ctx.config.replayKey),
    },
    heartbeat: {
      path: "/v1/burnbrake/heartbeat",
      proves: "this request reached the sidecar",
      does_not_prove: "absence of a second client",
    },
    deploy: deployBody(ctx),
  };
}

function deployBody(ctx: { config: AppConfig; ledger: Ledger }): Record<string, unknown> {
  const posture = ctx.ledger.scopePosture();
  return {
    product: "http request-path spend governor",
    stops_all_spend: false,
    dual_client: {
      bypass_possible: true,
      detected_here: false,
      note: DUAL_CLIENT_NOTE,
    },
    exhaust: EXHAUST_CONTRACT,
    scopes: {
      production: ctx.config.production,
      require: "user_or_day",
      user: posture.user,
      run: posture.run,
      day: posture.day,
      run_alone: posture.run_alone,
      durable: posture.durable,
      warning: ctx.ledger.scopeWarning(),
    },
    hosted: {
      this_process: "single-tenant (one SQLite ledger)",
      multi_tenant_runtime: false,
      note: TENANCY_NOTE,
    },
  };
}

async function handleGoverned(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    config: AppConfig;
    ledger: Ledger;
    table: PriceTable;
    anthropicTable: PriceTable;
    mock: MockState;
    beforeForward?: () => Promise<void>;
    sleep: (ms: number) => Promise<void>;
  },
  route: GovernedRoute,
): Promise<void> {
  const table = route === "/v1/messages" ? ctx.anthropicTable : ctx.table;
  const started = Date.now();
  const auth = authenticate(req.headers, ctx.config.apiKeys);
  if (!auth.ok) {
    const fields: ErrorFields = {
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: auth.message,
      halt: true,
      retryable: false,
    };
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId: null,
      runId: null,
      decision: "DENY",
      code: "AUTH_REQUIRED",
      upstreamForwarded: false,
      route,
    }));
    sendJson(res, 401, errorBody(fields));
    return;
  }
  if (!ctx.ledger.isWritable()) {
    sendJson(
      res,
      503,
      errorBody({
        code: "LEDGER_UNAVAILABLE",
        httpStatus: 503,
        message: "Ledger is not writable. Fail closed: refusing to forward.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  if (!ctx.config.mockUpstream) {
    const missingAnthropic = route === "/v1/messages" && !ctx.config.anthropicApiKey;
    const missingOpenAI = route !== "/v1/messages" && !ctx.config.openaiApiKey;
    if (missingAnthropic || missingOpenAI) {
      sendJson(
        res,
        503,
        errorBody({
          code: "UPSTREAM_NOT_CONFIGURED",
          httpStatus: 503,
          message: missingAnthropic
            ? "ANTHROPIC_API_KEY is not set. Refusing to forward. Set BURNBRAKE_MOCK_UPSTREAM=1 to use the offline mock."
            : "OPENAI_API_KEY is not set. Refusing to forward. Set BURNBRAKE_MOCK_UPSTREAM=1 to use the offline mock.",
          halt: true,
          retryable: false,
        }),
      );
      return;
    }
  }

  const idem = readIdempotency(req);
  if (idem === "mismatch") {
    sendJson(
      res,
      400,
      errorBody({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Idempotency-Key and x-burnbrake-request-id disagree.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  if (idem && !callerTokenOk(idem)) {
    sendJson(
      res,
      400,
      errorBody({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "Idempotency-Key must be 1–200 characters and must not contain control characters.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    const value = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON object required");
    }
    parsed = value as Record<string, unknown>;
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === "BODY_TOO_LARGE";
    sendJson(
      res,
      tooLarge ? 413 : 400,
      errorBody({
        code: tooLarge ? "BODY_TOO_LARGE" : "BAD_REQUEST",
        httpStatus: tooLarge ? 413 : 400,
        message: tooLarge ? "Request body exceeds 1 MiB." : "Request body must be a JSON object.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }

  const userHeader = headerValue(req, "x-burnbrake-user-id");
  const runHeader = headerValue(req, "x-burnbrake-run-id");
  if ((userHeader && !callerTokenOk(userHeader)) || (runHeader && !callerTokenOk(runHeader))) {
    sendJson(
      res,
      400,
      errorBody({
        code: "BAD_REQUEST",
        httpStatus: 400,
        message: "x-burnbrake-user-id and x-burnbrake-run-id must be 1–200 characters and must not contain control characters.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  // OpenAI `user` is request content, not the budget identity. A client that stamps a new
  // `user` per end-user would otherwise mint a fresh cap on every call.
  const userId = userHeader;
  const runId = runHeader;
  const estimate = estimateRequest(parsed, table, ctx.config.defaultMaxTokens, route);
  if (!estimate.ok) {
    const status = httpStatusForEstimate(estimate.code);
    const fields: ErrorFields = {
      code: estimate.code,
      httpStatus: status,
      message: `${estimate.message} Halt. This is not a rate limit.`,
      halt: true,
      retryable: false,
      user_id: userId,
      run_id: runId,
    };
    const raw = JSON.stringify(errorBody(fields));
    if (idem) {
      ctx.ledger.rememberTerminal({
        key: idem,
        userId,
        runId,
        reservationId: null,
        httpStatus: status,
        body: raw,
      });
    }
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId,
      runId,
      decision: "DENY",
      code: estimate.code,
      upstreamForwarded: false,
      route,
      model: typeof parsed.model === "string" ? parsed.model : null,
      idempotencyKey: idem,
    }));
    sendRaw(res, status, "application/json; charset=utf-8", raw);
    return;
  }

  const reserveInput = {
    userId,
    runId,
    estimateMicros: estimate.micros,
    idempotencyKey: idem,
    model: estimate.model,
    route,
    maxTokens: estimate.maxTokens,
    maxTokensSource: estimate.maxTokensSource,
    priceTableVersion: table.version,
  };
  const respondDeny = (denied: Extract<ReserveResult, { kind: "deny" }>, curve: { delay_ms: number } | null): void => {
    const fields: ErrorFields = {
      code: denied.code,
      httpStatus: denied.httpStatus,
      message: denied.message,
      scope: denied.scope,
      remaining_micros: denied.remaining_micros,
      requested_micros: denied.requested_micros,
      user_id: denied.user_id,
      run_id: denied.run_id,
      halt: denied.code !== "IDEMPOTENCY_MISMATCH",
      retryable: false,
    };
    if (curve && (denied.code === "BUDGET_EXHAUSTED" || denied.code === "SPEND_PAUSED")) {
      fields.zone = "black";
      fields.delay_ms = curve.delay_ms;
    }
    const raw = JSON.stringify(errorBody(fields));
    if (idem && denied.code !== "IDEMPOTENCY_MISMATCH") {
      ctx.ledger.rememberTerminal({
        key: idem,
        userId,
        runId,
        reservationId: null,
        httpStatus: denied.httpStatus,
        body: raw,
      });
    }
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId,
      runId,
      decision: "DENY",
      code: denied.code,
      scope: denied.scope,
      requestedMicros: denied.requested_micros,
      remainingAfterMicros: denied.remaining_micros,
      upstreamForwarded: false,
      route,
      model: estimate.model,
      idempotencyKey: idem,
      estimatedMicros: estimate.micros,
      maxTokensSource: estimate.maxTokensSource,
    }));
    sendRaw(res, denied.httpStatus, "application/json; charset=utf-8", raw);
  };

  // Curve is off by default. That path must stay the pre-curve reserve, with no zone headers.
  const brake = ctx.ledger.getBrake();
  let color: Extract<BrakePreview, { kind: "color" }> | null = null;
  if (brake.enabled) {
    const preview = ctx.ledger.previewBrake(reserveInput, brake);
    if (preview.kind === "black") {
      if (preview.delay_ms > 0) await ctx.sleep(preview.delay_ms);
      if (clientGone(res)) return;
      // Wait does not flip the verdict. Do not reserve after this sleep.
      // rememberTerminal will not overwrite a key claimed during the wait.
      respondDeny(preview.deny, { delay_ms: preview.delay_ms });
      return;
    }
    if (preview.kind === "color" && preview.delay_ms > 0) {
      await ctx.sleep(preview.delay_ms);
      if (clientGone(res)) return;
    }
    if (preview.kind === "color") color = preview;
  }

  let reserved;
  try {
    reserved = ctx.ledger.reserve(reserveInput);
  } catch (err) {
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId,
      runId,
      decision: "DENY",
      code: "LEDGER_UNAVAILABLE",
      upstreamForwarded: false,
      route,
      model: estimate.model,
      idempotencyKey: idem,
      estimatedMicros: estimate.micros,
      maxTokensSource: estimate.maxTokensSource,
    }));
    sendJson(
      res,
      503,
      errorBody({
        code: "LEDGER_UNAVAILABLE",
        httpStatus: 503,
        message: "Ledger refused the reserve. Fail closed: no upstream call.",
        halt: true,
        retryable: false,
        user_id: userId,
        run_id: runId,
        requested_micros: estimate.micros,
      }),
    );
    console.error("reserve failed closed", err instanceof Error ? err.message : err);
    return;
  }

  if (reserved.kind === "replay") {
    const replayType = /^(data|event):/.test(reserved.body) ? "text/event-stream" : "application/json; charset=utf-8";
    sendRaw(res, reserved.httpStatus, replayType, reserved.body, {
      "x-burnbrake-idempotent-replay": "true",
    });
    return;
  }
  if (reserved.kind === "in_flight") {
    sendJson(
      res,
      409,
      errorBody({
        code: "REQUEST_IN_FLIGHT",
        httpStatus: 409,
        message: "This idempotency key is already in flight. Do not start a second forward. Wait, or reuse the key after the first call finishes.",
        halt: false,
        retryable: false,
        user_id: userId,
        run_id: runId,
        requested_micros: estimate.micros,
      }),
      reserved.reservationId ? { "x-burnbrake-reservation-id": reserved.reservationId } : {},
    );
    return;
  }
  if (reserved.kind === "deny") {
    const becameBlack = brake.enabled && (reserved.code === "BUDGET_EXHAUSTED" || reserved.code === "SPEND_PAUSED");
    respondDeny(reserved, becameBlack ? { delay_ms: color?.delay_ms ?? 0 } : null);
    return;
  }

  const reservationId = reserved.reservationId;
  try {
    ctx.ledger.markForwarded(reservationId);
  } catch (err) {
    try {
      ctx.ledger.release(reservationId);
    } catch {
      /* already not RESERVED */
    }
    sendJson(
      res,
      503,
      errorBody({
        code: "LEDGER_UNAVAILABLE",
        httpStatus: 503,
        message: "Could not mark the reservation forwarded. Released the pre-forward hold. No upstream call.",
        halt: true,
        retryable: false,
        user_id: userId,
        run_id: runId,
      }),
    );
    console.error("markForwarded failed", err instanceof Error ? err.message : err);
    return;
  }

  if (ctx.beforeForward) {
    try {
      await ctx.beforeForward();
    } catch (err) {
      const settled = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
      const payload = errorBody({
        code: "UPSTREAM_ERROR",
        httpStatus: 502,
        message:
          "Failed after the reservation was marked forwarded. Reservation debited at the estimate (DEBIT_RESERVED). Retry only with the same idempotency key.",
        halt: false,
        retryable: false,
        user_id: userId,
        run_id: runId,
        requested_micros: estimate.micros,
      });
      const raw = JSON.stringify(payload);
      if (idem) ctx.ledger.completeIdempotency(idem, 502, raw);
      ctx.ledger.logDecision(decisionBase({ table }, started, {
        userId,
        runId,
        decision: "ALLOW",
        code: "UPSTREAM_ERROR",
        requestedMicros: estimate.micros,
        remainingAfterMicros: minRemaining(ctx.ledger, userId, runId),
        upstreamForwarded: false,
        route,
        model: estimate.model,
        idempotencyKey: idem,
        reservationId,
        estimatedMicros: estimate.micros,
        settledMicros: estimate.micros,
        terminalReason: settled.terminalReason,
        maxTokensSource: estimate.maxTokensSource,
      }));
      sendRaw(res, 502, "application/json; charset=utf-8", raw, { "x-burnbrake-reservation-id": reservationId });
      console.error("beforeForward failed closed", err instanceof Error ? err.message : err);
      return;
    }
  }

  // A client that leaves before the provider answers cancels the provider call.
  const earlyAbort = new AbortController();
  const onEarlyClose = () => {
    if (!res.writableEnded) earlyAbort.abort();
  };
  res.on("close", onEarlyClose);
  let upstream;
  try {
    upstream = await forwardToUpstream({
      signal: earlyAbort.signal,
      mock: ctx.config.mockUpstream,
      mockState: ctx.mock,
      upstreamBaseURL: ctx.config.upstreamBaseURL,
      openaiApiKey: ctx.config.openaiApiKey,
      anthropicBaseURL: ctx.config.anthropicBaseURL,
      anthropicApiKey: ctx.config.anthropicApiKey,
      provider: route === "/v1/messages" ? "anthropic" : "openai",
      route,
      body: estimate.forwardBody,
      completionTokenOverride: ctx.config.mockUpstream ? headerInt(req, "x-burnbrake-mock-completion-tokens") : null,
      statusOverride: ctx.config.mockUpstream ? headerInt(req, "x-burnbrake-mock-status") : null,
      inputTokensHint: estimate.inputTokens,
    });
    res.off("close", onEarlyClose);
  } catch (err) {
    res.off("close", onEarlyClose);
    const settled = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
    const payload = errorBody({
      code: "UPSTREAM_ERROR",
      httpStatus: 502,
      message: "Upstream call failed after forward. Reservation debited at the estimate (DEBIT_RESERVED). Retry only with the same idempotency key.",
      halt: false,
      retryable: false,
      user_id: userId,
      run_id: runId,
      requested_micros: estimate.micros,
    });
    const raw = JSON.stringify(payload);
    if (idem) ctx.ledger.completeIdempotency(idem, 502, raw);
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId,
      runId,
      decision: "ALLOW",
      code: "UPSTREAM_ERROR",
      requestedMicros: estimate.micros,
      remainingAfterMicros: minRemaining(ctx.ledger, userId, runId),
      upstreamForwarded: true,
      route,
      model: estimate.model,
      idempotencyKey: idem,
      reservationId,
      estimatedMicros: estimate.micros,
      settledMicros: estimate.micros,
      terminalReason: settled.terminalReason,
      maxTokensSource: estimate.maxTokensSource,
    }));
    sendRaw(res, 502, "application/json; charset=utf-8", raw, { "x-burnbrake-reservation-id": reservationId });
    return;
  }

  // Settles a forwarded reservation from the upstream status and usage. Throws if the ledger fails.
  const settleForwarded = (status: number, usage: Usage | null) => {
    let terminalReason = "SETTLED";
    let settledMicros: number | null = null;
    let debtDelta = 0;
    if (status >= 200 && status < 300) {
      if (usage) {
        const actual = costFromUsage(table, estimate.model, usage, estimate.flatMicros);
        if (actual == null) {
          const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
          terminalReason = debited.terminalReason;
          settledMicros = debited.debitedMicros;
        } else {
          const settled = ctx.ledger.settle(reservationId, actual);
          terminalReason = settled.terminalReason;
          debtDelta = settled.debtDeltaMicros;
          settledMicros = actual;
        }
      } else {
        const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
        terminalReason = debited.terminalReason;
        settledMicros = debited.debitedMicros;
      }
    } else if (status >= 400 && status < 500 && !usage) {
      ctx.ledger.releaseNoCharge(reservationId);
      const row = ctx.ledger.getReservation(reservationId);
      terminalReason = row?.terminal_reason ?? "RELEASE_UPSTREAM_NO_CHARGE";
      settledMicros = row?.actual_micros ?? 0;
    } else if (usage) {
      const actual = costFromUsage(table, estimate.model, usage, estimate.flatMicros);
      if (actual == null) {
        const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
        terminalReason = debited.terminalReason;
        settledMicros = debited.debitedMicros;
      } else {
        const settled = ctx.ledger.settle(reservationId, actual);
        terminalReason = settled.terminalReason;
        debtDelta = settled.debtDeltaMicros;
        settledMicros = actual;
      }
    } else {
      const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
      terminalReason = debited.terminalReason;
      settledMicros = estimate.micros;
    }
    return { terminalReason, settledMicros, debtDelta };
  };
  // After a settle failure: whatever the ledger holds now, and debit at the estimate if still forwarded.
  const settleFallback = () => {
    const row = ctx.ledger.getReservation(reservationId);
    let terminalReason = row?.terminal_reason ?? "DEBIT_UPSTREAM_UNKNOWN";
    let settledMicros: number | null = row?.actual_micros ?? estimate.micros;
    if (row?.state === "FORWARDED") {
      const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
      terminalReason = debited.terminalReason;
      settledMicros = debited.debitedMicros;
    }
    return { terminalReason, settledMicros, debtDelta: 0 };
  };
  const logAllowed = (
    code: string,
    outcome: { terminalReason: string; settledMicros: number | null; debtDelta: number },
    more: Partial<DecisionInput> = {},
  ) =>
    ctx.ledger.logDecision(decisionBase({ table }, started, {
      userId,
      runId,
      decision: "ALLOW",
      code,
      requestedMicros: estimate.micros,
      remainingAfterMicros: minRemaining(ctx.ledger, userId, runId),
      debtDeltaMicros: outcome.debtDelta,
      upstreamForwarded: true,
      route,
      model: estimate.model,
      idempotencyKey: idem,
      reservationId,
      estimatedMicros: estimate.micros,
      settledMicros: outcome.settledMicros,
      terminalReason: outcome.terminalReason,
      maxTokensSource: estimate.maxTokensSource,
      ...more,
    }));
  const extra: Record<string, string> = { "x-burnbrake-reservation-id": reservationId };
  if (upstream.status === 200 && color) {
    extra["X-BurnBrake-Zone"] = color.zone;
    extra["X-BurnBrake-Remaining-Micros"] = String(color.remaining_micros);
    extra["X-BurnBrake-Delay-Ms"] = String(color.delay_ms);
    extra["X-BurnBrake-Scope"] = color.scope;
  }
  const okCode = (status: number) => (status >= 200 && status < 300 ? "OK" : `UPSTREAM_${status}`);

  if (upstream.kind === "stream") {
    // Pass bytes to the client as they arrive. Read usage on the way through and keep
    // a copy only up to the replay limit. Settle once, when the stream ends, breaks or is cut.
    const stream = upstream;
    const tracker = new SseUsageTracker();
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const replay: Buffer[] = [];
    let replayBytes = 0;
    let replayable = true;
    const keepCopy = (buf: Buffer) => {
      if (!replayable) return;
      replayBytes += buf.byteLength;
      if (replayBytes > STREAM_REPLAY_LIMIT) {
        replayable = false;
        replay.length = 0;
      } else replay.push(buf);
    };
    let clientLeft = clientGone(res);
    const onClose = () => {
      if (!res.writableFinished) {
        clientLeft = true;
        stream.abort();
      }
    };
    res.on("close", onClose);
    let streamError: unknown = null;

    // Mid-stream kill (on unless BURNBRAKE_STREAM_KILL=0). Only a successful stream is metered.
    const metering = ctx.config.streamKill && stream.status >= 200 && stream.status < 300;
    const dialect = route === "/v1/messages" ? "anthropic" : "openai";
    const meter = new StreamMeter(dialect);
    const framer = new SseEventFramer();
    let hold = estimate.micros;
    let cut: StreamCut | null = null;
    /** Meter one event. False means: do not forward it; the stream is cut before it. */
    const admit = (event: string): boolean => {
      const step = meter.observe(event);
      // Nothing new was consumed, or generation is already over (nothing left to stop).
      if (!step.grew || step.final) return true;
      // Output counted from deltas is capped at the reserved output (R4-1): a stream inside its
      // own reservation is never cut; only input, cache and server-tool surprises can cross.
      const projected = costFromUsage(table, estimate.model, meter.usage(estimate.inputTokens, estimate.outputTokens), estimate.flatMicros);
      if (projected == null) {
        cut = { code: "UNKNOWN_SURCHARGE", scope: null, remaining: 0, needed: 0 };
        return false;
      }
      if (projected <= hold) return true;
      let ext: ExtendResult;
      try {
        ext = ctx.ledger.extendHold(reservationId, projected - hold);
      } catch (err) {
        console.error("extending the stream hold failed closed", err instanceof Error ? err.message : err);
        cut = { code: "LEDGER_UNAVAILABLE", scope: null, remaining: 0, needed: projected - hold };
        return false;
      }
      if (ext.ok) {
        hold = ext.hold_micros;
        return true;
      }
      cut = {
        code: ext.code === "SPEND_PAUSED" ? "SPEND_PAUSED" : "BUDGET_EXHAUSTED",
        scope: ext.scope,
        remaining: ext.remaining_micros,
        needed: projected - hold,
      };
      return false;
    };
    /** Frame, meter and forward decoded text. Stops at the first event that would cross the budget. */
    const forwardText = async (text: string, final: boolean): Promise<void> => {
      let events: string[];
      try {
        events = framer.push(text);
        if (final) {
          const rest = framer.flush();
          if (rest) events.push(rest);
        }
      } catch {
        cut = { code: "UPSTREAM_STREAM_BROKEN", scope: null, remaining: 0, needed: 0 };
        return;
      }
      let out = "";
      for (const event of events) {
        if (!admit(event)) break;
        tracker.feed(event);
        out += event;
      }
      if (!out || clientLeft) return;
      const buf = Buffer.from(out, "utf8");
      keepCopy(buf);
      if (!res.write(buf)) await waitDrainOrClose(res);
    };
    /**
     * The provider stream is already closed. Settle at the metered input and server tools
     * (including the event that crossed) plus the whole output allowance: output the provider
     * billed but never streamed (hidden thinking or reasoning, tokens generated after the close)
     * can't be seen, and it is all within max_tokens (R4-2). Then end the client stream with one
     * terminal error event. A cut stream is never stored for replay.
     */
    const finishCutStream = async (c: StreamCut): Promise<void> => {
      let outcome: { terminalReason: string; settledMicros: number | null; debtDelta: number };
      try {
        const actual =
          c.code === "BUDGET_EXHAUSTED" || c.code === "SPEND_PAUSED"
            ? costFromUsage(table, estimate.model, meter.cutUsage(estimate.inputTokens, estimate.outputTokens), estimate.flatMicros)
            : null;
        if (actual == null) {
          // Unreadable stream, unpriced tool or ledger trouble: the outcome is unknown, charge the hold.
          const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
          outcome = { terminalReason: debited.terminalReason, settledMicros: debited.debitedMicros, debtDelta: 0 };
        } else {
          const settled = ctx.ledger.settle(reservationId, actual);
          outcome = { terminalReason: settled.terminalReason, settledMicros: actual, debtDelta: settled.debtDeltaMicros };
        }
      } catch (err) {
        outcome = settleFallback();
        console.error("settle after a stream cut failed closed", err instanceof Error ? err.message : err);
      }
      const fields = errorBody({
        code: c.code,
        httpStatus: c.code === "BUDGET_EXHAUSTED" || c.code === "SPEND_PAUSED" || c.code === "UNKNOWN_SURCHARGE" ? 402 : 502,
        message: cutMessage(c),
        scope: c.scope,
        remaining_micros: c.remaining,
        requested_micros: c.needed,
        user_id: userId,
        run_id: runId,
        halt: true,
        retryable: false,
      }).error;
      fields.stream_cut = true;
      fields.charged_micros = outcome.settledMicros;
      if (!clientLeft && !res.destroyed) {
        const type = c.code === "BUDGET_EXHAUSTED" ? "budget_exhausted" : c.code === "SPEND_PAUSED" ? "spend_paused" : "api_error";
        res.end(terminalErrorEvent(dialect, type, fields));
      }
      try {
        if (idem) ctx.ledger.completeIdempotency(idem, stream.status, "", { replay: false });
        logAllowed(`STREAM_CUT_${c.code}`, outcome, { scope: c.scope, remainingAfterMicros: minRemaining(ctx.ledger, userId, runId) });
      } catch (err) {
        console.error("recording the cut stream failed", err instanceof Error ? err.message : err);
      }
    };
    try {
      if (clientLeft) throw new Error("client left before the stream started");
      res.writeHead(stream.status, {
        "content-type": stream.contentType,
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        ...extra,
      });
      res.flushHeaders();
      for await (const chunk of stream.body) {
        if (metering) {
          await forwardText(decoder.decode(chunk, { stream: true }), false);
          if ((cut as StreamCut | null) || clientLeft) break;
          continue;
        }
        tracker.feed(decoder.decode(chunk, { stream: true }));
        keepCopy(Buffer.from(chunk));
        if (clientLeft) break;
        if (!res.write(chunk)) await waitDrainOrClose(res);
        if (clientLeft) break;
      }
      if (!(cut as StreamCut | null) && !clientLeft) {
        if (metering) await forwardText(decoder.decode(), true);
        else tracker.feed(decoder.decode());
        tracker.end();
      }
    } catch (err) {
      streamError = err;
    } finally {
      res.off("close", onClose);
      if (clientLeft || streamError || (cut as StreamCut | null)) stream.abort();
    }
    const cutNow = cut as StreamCut | null;
    if (cutNow) {
      await finishCutStream(cutNow);
      return;
    }
    if (!clientLeft && !res.destroyed) res.end();
    let outcome;
    try {
      outcome = settleForwarded(stream.status, tracker.usage());
    } catch (err) {
      outcome = settleFallback();
      console.error("settle failed closed", err instanceof Error ? err.message : err);
    }
    // A stream that did not finish, or is too large to keep, is not replayed:
    // a retry with this key gets 409 ALREADY_TERMINAL instead of a second forward.
    const keep = replayable && tracker.finished && !streamError && !clientLeft;
    const code = clientLeft ? "CLIENT_CLOSED" : streamError || !tracker.finished ? "UPSTREAM_STREAM_BROKEN" : okCode(stream.status);
    try {
      if (idem) ctx.ledger.completeIdempotency(idem, stream.status, keep ? Buffer.concat(replay).toString("utf8") : "", { replay: keep });
      logAllowed(code, outcome);
    } catch (err) {
      console.error("recording the finished stream failed", err instanceof Error ? err.message : err);
    }
    if (streamError && !clientLeft) console.error("upstream stream broke", streamError instanceof Error ? streamError.message : streamError);
    return;

  }

  const usage = settleUsage(upstream.contentType, upstream.bodyText);
  let outcome;
  try {
    outcome = settleForwarded(upstream.status, usage);
  } catch (err) {
    outcome = settleFallback();
    const payload = errorBody({
      code: "LEDGER_UNAVAILABLE",
      httpStatus: 502,
      message:
        "Spend path failed after forward. If the reservation was still forwarded, it was debited at the estimate. Retry only with the same idempotency key.",
      halt: false,
      retryable: false,
      user_id: userId,
      run_id: runId,
      requested_micros: estimate.micros,
    });
    const raw = JSON.stringify(payload);
    if (idem) ctx.ledger.completeIdempotency(idem, 502, raw);
    logAllowed("LEDGER_UNAVAILABLE", outcome);
    sendRaw(res, 502, "application/json; charset=utf-8", raw, { "x-burnbrake-reservation-id": reservationId });
    console.error("settle failed closed", err instanceof Error ? err.message : err);
    return;
  }

  if (idem) ctx.ledger.completeIdempotency(idem, upstream.status, upstream.bodyText);
  logAllowed(okCode(upstream.status), outcome);
  sendRaw(res, upstream.status, upstream.contentType, upstream.bodyText, extra);
}

interface StreamCut {
  code: "BUDGET_EXHAUSTED" | "SPEND_PAUSED" | "UNKNOWN_SURCHARGE" | "LEDGER_UNAVAILABLE" | "UPSTREAM_STREAM_BROKEN";
  scope: ScopeName | null;
  remaining: number;
  /** Micros the stream needed beyond its hold when it was cut. */
  needed: number;
}

function cutMessage(c: StreamCut): string {
  const tail = "BurnBrake closed the provider stream; the answer above is incomplete. Halt; this is not a rate limit.";
  switch (c.code) {
    case "BUDGET_EXHAUSTED":
      return `Budget exhausted for scope ${c.scope ?? "unknown"} while streaming. ${tail}`;
    case "SPEND_PAUSED":
      return `Spend was paused while this stream needed more budget. ${tail}`;
    case "UNKNOWN_SURCHARGE":
      return `The stream used something the price table cannot price. Charged the hold. ${tail}`;
    case "LEDGER_UNAVAILABLE":
      return `The ledger could not extend the hold. Fail closed. ${tail}`;
    default:
      return `The provider stream could not be read (an event exceeded the size limit). Charged the hold. ${tail}`;
  }
}

/** A streamed reply larger than this is still passed through in full, but not stored for replay. */
const STREAM_REPLAY_LIMIT = 1_500_000;

function waitDrainOrClose(res: ServerResponse): Promise<void> {
  if (res.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}

async function handleOperator(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { config: AppConfig; ledger: Ledger; table: PriceTable; mock: MockState },
  path: string,
  url: URL,
): Promise<void> {
  if (!ctx.config.operatorKey) {
    sendJson(
      res,
      403,
      errorBody({
        code: "OPERATOR_KEY_REQUIRED",
        httpStatus: 403,
        message:
          "Operator HTTP is disabled until BURNBRAKE_OPERATOR_KEY is set to a bb_ secret distinct from BURNBRAKE_KEY. The spend key cannot change caps. Use the CLI on the ledger file, or set the operator key and restart.",
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  const auth = authenticate(req.headers, ctx.config.operatorKeys);
  if (!auth.ok) {
    sendJson(res, 401, errorBody({ code: "AUTH_REQUIRED", httpStatus: 401, message: auth.message, halt: true, retryable: false }));
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/allowances") {
    sendJson(res, 200, {
      allowances: ctx.ledger.listAllowances({
        scope: url.searchParams.get("scope") ?? undefined,
        key: url.searchParams.get("key") ?? undefined,
        limit: numberParam(url, "limit") ?? 50,
      }),
      exhaust: EXHAUST_CONTRACT,
    });
    return;
  }
  if (req.method === "POST" && path === "/v1/operator/allowances") {
    const body = await readJson(req);
    const forbidden = ["halt", "retryable", "exhaust", "enabled", "soft_allow", "fail_open", "halt_mode"];
    if (forbidden.some((key) => key in body)) {
      sendJson(
        res,
        400,
        errorBody({
          code: "BAD_REQUEST",
          httpStatus: 400,
          message: "An allowance grant cannot change the exhaust contract.",
          halt: false,
          retryable: false,
        }),
      );
      return;
    }
    const scope = body.scope;
    if (scope !== "user" && scope !== "run" && scope !== "day") {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "scope must be user, run, or day.", halt: false, retryable: false }));
      return;
    }
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const resolvedKey = scope === "day" && (key === "" || key === "today") ? ctx.ledger.utcDay() : key;
    if (!resolvedKey) {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "key is required.", halt: false, retryable: false }));
      return;
    }
    const grant = typeof body.grant_micros === "number" ? body.grant_micros : null;
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (grant == null || !Number.isSafeInteger(grant) || grant < 1 || !reason.trim()) {
      sendJson(
        res,
        400,
        errorBody({
          code: "BAD_REQUEST",
          httpStatus: 400,
          message: "grant_micros (integer >= 1) and reason are required. This does not change exhaust.",
          halt: false,
          retryable: false,
        }),
      );
      return;
    }
    const row = ctx.ledger.grantAllowance(scope, resolvedKey, grant, reason);
    sendJson(res, 200, { ok: true, allowance: row, exhaust: EXHAUST_CONTRACT, note: "One reserve may use this grant. Exhaust stays a hard halt." });
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/estimate-error") {
    sendJson(res, 200, {
      estimate_error: ctx.ledger.estimateErrorSummary(),
      note: "under_reserve means settled micros exceeded the reserve. The next call stays fail-closed. This is not a soft open.",
    });
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/balances") {
    sendJson(res, 200, {
      ...ctx.ledger.balances({
        userId: url.searchParams.get("user_id"),
        runId: url.searchParams.get("run_id"),
      }),
      price_table: {
        version: ctx.table.version,
        priced_at: ctx.table.pricedAt,
        stale: priceTableFreshness(ctx.table, ctx.ledger.now(), ctx.config.staleWarnDays).stale,
        stale_warn_days: ctx.config.staleWarnDays,
      },
      estimate: { default_max_tokens: ctx.config.defaultMaxTokens },
    });
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/decisions") {
    const rows = ctx.ledger.listDecisions({
      denyOnly: url.searchParams.get("deny_only") === "1" || url.searchParams.get("deny_only") === "true",
      userId: url.searchParams.get("user_id") ?? undefined,
      runId: url.searchParams.get("run_id") ?? undefined,
      limit: numberParam(url, "limit") ?? 100,
    });
    if ((url.searchParams.get("format") ?? "json") === "csv") {
      const csv = decisionsToCsv(rows);
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-length": Buffer.byteLength(csv),
      });
      res.end(csv);
      return;
    }
    sendJson(res, 200, { decisions: rows });
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/reservations") {
    sendJson(res, 200, {
      reservations: ctx.ledger.listReservations({
        state: url.searchParams.get("state") ?? undefined,
        runId: url.searchParams.get("run_id") ?? undefined,
        limit: numberParam(url, "limit") ?? 50,
      }),
      reservation_ttl_seconds: Math.round(ctx.config.reservationTtlMs / 1000),
    });
    return;
  }
  if (req.method === "GET" && path === "/v1/operator/runs/top") {
    const window = url.searchParams.get("window") === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    sendJson(res, 200, { window: url.searchParams.get("window") === "1h" ? "1h" : "24h", runs: ctx.ledger.topRuns(window) });
    return;
  }
  if (req.method === "POST" && (path === "/v1/operator/pause" || path === "/v1/operator/resume" || path === "/v1/operator/runs/kill")) {
    const body = await readJson(req);
    const paused = path !== "/v1/operator/resume";
    const runId = typeof body.run_id === "string" ? body.run_id : "";
    if (path === "/v1/operator/runs/kill" && !runId) {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "run_id is required.", halt: false, retryable: false }));
      return;
    }
    if (body.global === true) ctx.ledger.pauseGlobal(paused);
    if (runId) ctx.ledger.pauseRun(runId, path === "/v1/operator/runs/kill" ? true : paused);
    if (!runId && body.global !== true) {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "Provide run_id or global: true.", halt: false, retryable: false }));
      return;
    }
    sendJson(res, 200, { ok: true, paused_global: ctx.ledger.isGlobalPaused(), run_id: runId || null, paused });
    return;
  }
  if (req.method === "POST" && path === "/v1/operator/caps") {
    const body = await readJson(req);
    const scope = body.scope;
    if (scope !== "user" && scope !== "run" && scope !== "day") {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "scope must be user, run, or day.", halt: false, retryable: false }));
      return;
    }
    const micros = readCapBody(body);
    if (micros == null) {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "Provide cap_micros or cap_usd.", halt: false, retryable: false }));
      return;
    }
    const key = typeof body.key === "string" ? body.key : null;
    const appliedKey = applyCap(ctx.ledger, scope, key, micros);
    sendJson(res, 200, { ok: true, scope, key: appliedKey, cap_micros: micros, warning: ctx.ledger.scopeWarning() });
    return;
  }
  if ((req.method === "GET" || req.method === "POST") && path === "/v1/operator/brake") {
    if (req.method === "GET") {
      sendJson(res, 200, brakePayload(ctx.ledger.getBrake()));
      return;
    }
    const body = await readJson(req);
    try {
      const next = mergeBrakeConfig(ctx.ledger.getBrake(), body);
      ctx.ledger.setBrake(next);
    } catch (err) {
      if (err instanceof BrakeConfigError) {
        sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: err.message, halt: false, retryable: false }));
        return;
      }
      throw err;
    }
    sendJson(res, 200, brakePayload(ctx.ledger.getBrake()));
    return;
  }
  if (req.method === "POST" && path === "/v1/operator/force-release") {
    const body = await readJson(req);
    if (body.attest_no_charge !== true) {
      sendJson(
        res,
        400,
        errorBody({
          code: "BAD_REQUEST",
          httpStatus: 400,
          message: "force-release requires attest_no_charge: true. Default TTL path debits after forward.",
          halt: false,
          retryable: false,
        }),
      );
      return;
    }
    if (typeof body.reservation_id !== "string" || typeof body.reason !== "string") {
      sendJson(res, 400, errorBody({ code: "BAD_REQUEST", httpStatus: 400, message: "reservation_id and reason are required.", halt: false, retryable: false }));
      return;
    }
    ctx.ledger.forceRelease(body.reservation_id, body.reason);
    sendJson(res, 200, { ok: true, terminal_reason: "FORCE_RELEASE_AUDITED" });
    return;
  }
  sendJson(res, 404, errorBody({ code: "NOT_FOUND", httpStatus: 404, message: "Unknown operator route.", halt: false, retryable: false }));
}

function decisionBase(
  ctx: { table: PriceTable },
  started: number,
  fields: Partial<DecisionInput> & Pick<DecisionInput, "userId" | "runId" | "decision" | "upstreamForwarded">,
): DecisionInput {
  return {
    userId: fields.userId,
    runId: fields.runId,
    decision: fields.decision,
    code: fields.code ?? null,
    scope: fields.scope ?? null,
    requestedMicros: fields.requestedMicros ?? null,
    remainingAfterMicros: fields.remainingAfterMicros ?? null,
    debtDeltaMicros: fields.debtDeltaMicros ?? 0,
    model: fields.model ?? null,
    route: fields.route ?? null,
    latencyMs: Date.now() - started,
    idempotencyKey: fields.idempotencyKey ?? null,
    priceTableVersion: ctx.table.version,
    upstreamForwarded: fields.upstreamForwarded,
    reservationId: fields.reservationId ?? null,
    estimatedMicros: fields.estimatedMicros ?? null,
    settledMicros: fields.settledMicros ?? null,
    terminalReason: fields.terminalReason ?? null,
    maxTokensSource: fields.maxTokensSource ?? null,
  };
}

function minRemaining(ledger: Ledger, userId: string | null, runId: string | null): number | null {
  const report = ledger.balances({ userId, runId });
  if (report.scopes.length === 0) return null;
  return Math.min(...report.scopes.map((scope) => scope.remaining_micros));
}

function readIdempotency(req: IncomingMessage): string | null | "mismatch" {
  const a = headerValue(req, "idempotency-key");
  const b = headerValue(req, "x-burnbrake-request-id");
  if (a && b && a !== b) return "mismatch";
  return a ?? b;
}

function callerTokenOk(value: string): boolean {
  if (value.length < 1 || value.length > 200) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function clientGone(res: ServerResponse): boolean {
  // After the body is read, IncomingMessage.aborted stays false and the request
  // stream is already destroyed. The response socket flips only when the client leaves.
  return res.destroyed || res.closed || res.socket?.destroyed === true;
}

function brakePayload(brake: BrakeConfig): { brake: BrakeConfig; note: string } {
  return {
    brake,
    note: "brake.enabled is not a halt-off switch. A black delay is a pre-402 pause only; the wait does not change the exhaust verdict.",
  };
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function headerInt(req: IncomingMessage, name: string): number | null {
  const value = headerValue(req, name);
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function numberParam(url: URL, name: string): number | null {
  const value = url.searchParams.get(name);
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function applyCap(ledger: Ledger, scope: "user" | "run" | "day", key: string | null, micros: number): string | null {
  if (!key) {
    ledger.setDefaultCap(scope, micros);
    if (scope === "day") {
      const today = ledger.utcDay();
      ledger.setCap("day", today, micros);
      return today;
    }
    return null;
  }
  const resolved = scope === "day" && key === "today" ? ledger.utcDay() : key;
  ledger.setCap(scope, resolved, micros);
  return resolved;
}

function readCapBody(body: Record<string, unknown>): number | null {
  if (typeof body.cap_micros === "number" && Number.isSafeInteger(body.cap_micros) && body.cap_micros >= 0) {
    return body.cap_micros;
  }
  if (typeof body.cap_usd === "string" || typeof body.cap_usd === "number") {
    return usdToMicros(body.cap_usd);
  }
  return null;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  const value = JSON.parse(raw.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}

function readBody(req: IncomingMessage, limit = 1_048_576): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (body: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", (err) => fail(err instanceof Error ? err : new Error("CLIENT_CLOSED")));
    req.on("aborted", () => fail(new Error("CLIENT_CLOSED")));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  sendRaw(res, status, "application/json; charset=utf-8", JSON.stringify(body), extra);
}

function sendRaw(res: ServerResponse, status: number, contentType: string, body: string, extra: Record<string, string> = {}): void {
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  try {
    res.writeHead(status, {
      "content-type": contentType,
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      ...extra,
    });
    res.end(body);
  } catch {
    // The client already went away. Settle/debit already happened; do not turn that into a 503.
  }
}

async function handleHeartbeat(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { config: AppConfig; ledger: Ledger },
): Promise<void> {
  const auth = authenticate(req.headers, ctx.config.apiKeys);
  if (!auth.ok) {
    sendJson(res, 401, errorBody({ code: "AUTH_REQUIRED", httpStatus: 401, message: auth.message, halt: true, retryable: false }));
    return;
  }
  const userId = headerValue(req, "x-burnbrake-user-id");
  const runId = headerValue(req, "x-burnbrake-run-id");
  ctx.ledger.logDecision({
    userId,
    runId,
    decision: "ALLOW",
    code: "HEARTBEAT",
    scope: null,
    requestedMicros: null,
    remainingAfterMicros: null,
    debtDeltaMicros: 0,
    model: null,
    route: "/v1/burnbrake/heartbeat",
    latencyMs: 0,
    idempotencyKey: null,
    priceTableVersion: null,
    upstreamForwarded: false,
    reservationId: null,
    estimatedMicros: null,
    settledMicros: null,
    terminalReason: null,
    maxTokensSource: null,
  });
  sendJson(res, 200, {
    ok: true,
    sidecar: true,
    proves: "this request reached the BurnBrake sidecar",
    does_not_prove: "absence of a second client, or that every provider call is gated",
    stops_all_spend: false,
    ts: ctx.ledger.now(),
  });
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
