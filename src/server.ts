import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { VERSION } from "./constants.js";
import { authenticate } from "./auth.js";
import { assertProductionScopes, DUAL_CLIENT_NOTE, EXHAUST_CONTRACT, HOSTED_FENCE_NOTE } from "./deploy.js";
import { BrakeConfigError, mergeBrakeConfig, sleepMs, type BrakeConfig } from "./brake.js";
import { loadConfig, type AppConfig } from "./config.js";
import { errorBody, httpStatusForEstimate, type ErrorFields } from "./errors.js";
import { costFromUsage, estimateRequest, type GovernedRoute } from "./estimate.js";
import { decisionsToCsv, Ledger, type BrakePreview, type DecisionInput, type DefaultCaps, type ReserveResult } from "./ledger.js";
import { loadPriceTable, priceTableFreshness, type PriceTable } from "./prices.js";
import { forwardToUpstream, settleUsage, type MockState } from "./upstream.js";
import { usdToMicros } from "./money.js";

const GOVERNED = new Set<GovernedRoute>(["/v1/chat/completions", "/v1/completions"]);

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
  });
  console.warn(`BurnBrake deploy invariant: ${DUAL_CLIENT_NOTE}`);
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
    void handleRequest(req, res, { config, ledger, table, mock, beforeForward: options.beforeForward, sleep }).catch((err) => {
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
    } catch (err) {
      console.error("BurnBrake reservation sweep failed", err instanceof Error ? err.message : err);
    }
  }, 30_000);
  timer.unref?.();
  return {
    baseURL: `http://${config.host}:${port}`,
    host: config.host,
    port,
    config,
    ledger,
    mock,
    close: async () => {
      clearInterval(timer);
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
        message: `Route ${path} is not governed. BurnBrake forwards only /v1/chat/completions and /v1/completions. Unknown routes are not proxied.`,
        halt: true,
        retryable: false,
      }),
    );
    return;
  }
  sendJson(res, 404, errorBody({ code: "NOT_FOUND", httpStatus: 404, message: "Not found.", halt: false, retryable: false }));
}

function healthBody(ctx: { config: AppConfig; ledger: Ledger; table: PriceTable; mock: MockState }): Record<string, unknown> {
  const fresh = priceTableFreshness(ctx.table, ctx.ledger.now(), ctx.config.staleWarnDays);
  const writable = ctx.ledger.isWritable();
  return {
    ok: writable,
    version: VERSION,
    listen: ctx.config.host,
    port: ctx.config.port,
    auth: { required: true },
    ledger: { writable },
    fail_closed: true,
    price_table: {
      version: ctx.table.version,
      priced_at: ctx.table.pricedAt,
      stale: fresh.stale,
      age_days: Number(fresh.ageDays.toFixed(2)),
      stale_warn_days: fresh.staleWarnDays,
    },
    estimate: { default_max_tokens: ctx.config.defaultMaxTokens },
    reservation_ttl_seconds: Math.round(ctx.config.reservationTtlMs / 1000),
    day_boundary: "UTC",
    scopes_warning: ctx.ledger.scopeWarning(),
    operator_http: Boolean(ctx.config.operatorKey),
    mock_upstream: ctx.config.mockUpstream
      ? { enabled: true, forward_count: ctx.mock.forwardCount }
      : { enabled: false },
    routes: ["/v1/chat/completions", "/v1/completions"],
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
      this_process: "single-tenant self-host kit",
      hosted_monthly_sku: "separate product; not this process",
      multi_tenant_runtime: false,
      note: HOSTED_FENCE_NOTE,
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
    mock: MockState;
    beforeForward?: () => Promise<void>;
    sleep: (ms: number) => Promise<void>;
  },
  route: GovernedRoute,
): Promise<void> {
  const started = Date.now();
  const auth = authenticate(req.headers, ctx.config.apiKey);
  if (!auth.ok) {
    const fields: ErrorFields = {
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: auth.message,
      halt: true,
      retryable: false,
    };
    ctx.ledger.logDecision(decisionBase(ctx, started, {
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
  if (!ctx.config.mockUpstream && !ctx.config.openaiApiKey) {
    sendJson(
      res,
      503,
      errorBody({
        code: "UPSTREAM_NOT_CONFIGURED",
        httpStatus: 503,
        message: "OPENAI_API_KEY is not set. Refusing to forward. Set BURNBRAKE_MOCK_UPSTREAM=1 to use the offline mock.",
        halt: true,
        retryable: false,
      }),
    );
    return;
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
  const estimate = estimateRequest(parsed, ctx.table, ctx.config.defaultMaxTokens, route);
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
    ctx.ledger.logDecision(decisionBase(ctx, started, {
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
    priceTableVersion: ctx.table.version,
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
    ctx.ledger.logDecision(decisionBase(ctx, started, {
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
    ctx.ledger.logDecision(decisionBase(ctx, started, {
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
    const replayType = reserved.body.startsWith("data:") ? "text/event-stream" : "application/json; charset=utf-8";
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
      ctx.ledger.logDecision(decisionBase(ctx, started, {
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

  let upstream;
  try {
    upstream = await forwardToUpstream({
      mock: ctx.config.mockUpstream,
      mockState: ctx.mock,
      upstreamBaseURL: ctx.config.upstreamBaseURL,
      openaiApiKey: ctx.config.openaiApiKey,
      route,
      body: estimate.forwardBody,
      completionTokenOverride: ctx.config.mockUpstream ? headerInt(req, "x-burnbrake-mock-completion-tokens") : null,
      statusOverride: ctx.config.mockUpstream ? headerInt(req, "x-burnbrake-mock-status") : null,
      inputTokensHint: estimate.inputTokens,
    });
  } catch (err) {
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
    ctx.ledger.logDecision(decisionBase(ctx, started, {
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

  const usage = settleUsage(upstream.contentType, upstream.bodyText);
  let terminalReason = "SETTLED";
  let settledMicros: number | null = null;
  let debtDelta = 0;
  try {
    if (upstream.status >= 200 && upstream.status < 300) {
      if (usage) {
        const actual = costFromUsage(ctx.table, estimate.model, usage, estimate.flatMicros);
        if (actual == null) {
          const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
          terminalReason = debited.terminalReason;
          settledMicros = estimate.micros;
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
    } else if (upstream.status >= 400 && upstream.status < 500 && !usage) {
      ctx.ledger.releaseNoCharge(reservationId);
      const row = ctx.ledger.getReservation(reservationId);
      terminalReason = row?.terminal_reason ?? "RELEASE_UPSTREAM_NO_CHARGE";
      settledMicros = row?.actual_micros ?? 0;
    } else if (usage) {
      const actual = costFromUsage(ctx.table, estimate.model, usage, estimate.flatMicros);
      if (actual == null) {
        const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
        terminalReason = debited.terminalReason;
        settledMicros = estimate.micros;
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
  } catch (err) {
    const row = ctx.ledger.getReservation(reservationId);
    terminalReason = row?.terminal_reason ?? "DEBIT_UPSTREAM_UNKNOWN";
    settledMicros = row?.actual_micros ?? estimate.micros;
    if (row?.state === "FORWARDED") {
      const debited = ctx.ledger.debitReserved(reservationId, "DEBIT_UPSTREAM_UNKNOWN");
      terminalReason = debited.terminalReason;
      settledMicros = estimate.micros;
    }
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
    ctx.ledger.logDecision(decisionBase(ctx, started, {
      userId,
      runId,
      decision: "ALLOW",
      code: "LEDGER_UNAVAILABLE",
      requestedMicros: estimate.micros,
      remainingAfterMicros: minRemaining(ctx.ledger, userId, runId),
      upstreamForwarded: true,
      route,
      model: estimate.model,
      idempotencyKey: idem,
      reservationId,
      estimatedMicros: estimate.micros,
      settledMicros,
      terminalReason,
      maxTokensSource: estimate.maxTokensSource,
    }));
    sendRaw(res, 502, "application/json; charset=utf-8", raw, { "x-burnbrake-reservation-id": reservationId });
    console.error("settle failed closed", err instanceof Error ? err.message : err);
    return;
  }

  if (idem) ctx.ledger.completeIdempotency(idem, upstream.status, upstream.bodyText);
  ctx.ledger.logDecision(decisionBase(ctx, started, {
    userId,
    runId,
    decision: "ALLOW",
    code: upstream.status >= 200 && upstream.status < 300 ? "OK" : `UPSTREAM_${upstream.status}`,
    requestedMicros: estimate.micros,
    remainingAfterMicros: minRemaining(ctx.ledger, userId, runId),
    debtDeltaMicros: debtDelta,
    upstreamForwarded: true,
    route,
    model: estimate.model,
    idempotencyKey: idem,
    reservationId,
    estimatedMicros: estimate.micros,
    settledMicros,
    terminalReason,
    maxTokensSource: estimate.maxTokensSource,
  }));
  const extra: Record<string, string> = { "x-burnbrake-reservation-id": reservationId };
  if (upstream.status === 200 && color) {
    extra["X-BurnBrake-Zone"] = color.zone;
    extra["X-BurnBrake-Remaining-Micros"] = String(color.remaining_micros);
    extra["X-BurnBrake-Delay-Ms"] = String(color.delay_ms);
    extra["X-BurnBrake-Scope"] = color.scope;
  }
  sendRaw(res, upstream.status, upstream.contentType, upstream.bodyText, extra);
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
  const auth = authenticate(req.headers, ctx.config.operatorKey);
  if (!auth.ok) {
    sendJson(res, 401, errorBody({ code: "AUTH_REQUIRED", httpStatus: 401, message: auth.message, halt: true, retryable: false }));
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
