export interface BurnBrakeOptions {
  baseURL: string;
  /** BurnBrake secret (`bb_…`). Sent as `X-BurnBrake-Key`. Never the provider API key. */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionParams {
  model: string;
  messages: unknown[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: unknown[];
  user?: string;
  [key: string]: unknown;
}

export interface CompletionParams {
  model: string;
  prompt: string | string[];
  max_tokens?: number;
  [key: string]: unknown;
}

export interface MessageParams {
  model: string;
  messages: unknown[];
  max_tokens?: number;
  system?: unknown;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface HeartbeatReceipt {
  ok: true;
  sidecar: true;
  proves: string;
  does_not_prove: string;
  stops_all_spend: false;
}

/** Required on the SDK happy path. Reuse the same key if you retry after a forward. */
export interface CallOptions {
  idempotencyKey: string;
  userId?: string;
  runId?: string;
  signal?: AbortSignal;
}

export class IdempotencyKeyRequired extends Error {
  readonly code = "IDEMPOTENCY_KEY_REQUIRED";
  constructor() {
    super(
      "BurnBrake SDK calls require idempotencyKey on the options argument (not the JSON body). Raw HTTP may omit it, but retries after a forward must carry the same key or you risk a second provider call.",
    );
    this.name = "IdempotencyKeyRequired";
  }
}

export class BudgetExhausted extends Error {
  readonly code = "BUDGET_EXHAUSTED";
  readonly httpStatus = 402;
  readonly scope: string | null;
  readonly remaining_micros: number | null;
  readonly requested_micros: number | null;
  readonly run_id: string | null;
  readonly user_id: string | null;
  readonly halt = true;
  readonly retryable = false;

  constructor(fields: {
    message: string;
    scope?: string | null;
    remaining_micros?: number | null;
    requested_micros?: number | null;
    run_id?: string | null;
    user_id?: string | null;
  }) {
    super(fields.message);
    this.name = "BudgetExhausted";
    this.scope = fields.scope ?? null;
    this.remaining_micros = fields.remaining_micros ?? null;
    this.requested_micros = fields.requested_micros ?? null;
    this.run_id = fields.run_id ?? null;
    this.user_id = fields.user_id ?? null;
  }
}

export class SpendPaused extends Error {
  readonly code = "SPEND_PAUSED";
  readonly httpStatus = 402;
  readonly halt = true;
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "SpendPaused";
  }
}

export class BurnBrakeError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly halt: boolean;
  readonly retryable: boolean;
  readonly body: unknown;
  constructor(fields: { message: string; code: string; httpStatus: number; halt?: boolean; retryable?: boolean; body?: unknown }) {
    super(fields.message);
    this.name = "BurnBrakeError";
    this.code = fields.code;
    this.httpStatus = fields.httpStatus;
    this.halt = fields.halt ?? false;
    this.retryable = fields.retryable ?? false;
    this.body = fields.body;
  }
}

export function isBudgetExhausted(err: unknown): err is BudgetExhausted {
  return err instanceof BudgetExhausted;
}

/**
 * Thin client for the BurnBrake sidecar. Same reject contract as raw HTTP.
 * Happy-path calls require an idempotency key.
 */
export class BurnBrake {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BurnBrakeOptions) {
    if (!options.baseURL) throw new Error("baseURL is required");
    if (!options.apiKey) throw new Error("apiKey is required");
    if (options.apiKey.startsWith("sk-")) {
      throw new Error("Do not use a provider API key as the BurnBrake apiKey.");
    }
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  readonly chat = {
    completions: {
      create: (body: ChatCompletionParams, options: CallOptions): Promise<unknown> =>
        this.post("/v1/chat/completions", body, options),
    },
  };

  readonly completions = {
    create: (body: CompletionParams, options: CallOptions): Promise<unknown> =>
      this.post("/v1/completions", body, options),
  };

  readonly messages = {
    create: (body: MessageParams, options: CallOptions): Promise<unknown> => this.post("/v1/messages", body, options),
  };

  /**
   * Proves this call reached the sidecar. It does not prove there is no second client.
   */
  async heartbeat(): Promise<HeartbeatReceipt> {
    const response = await this.fetchImpl(`${this.baseURL}/v1/burnbrake/heartbeat`, {
      method: "POST",
      headers: { "x-burnbrake-key": this.apiKey },
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (response.status < 200 || response.status >= 300) {
      const error = errorObject(parsed);
      throw new BurnBrakeError({
        message: typeof error?.message === "string" ? error.message : `BurnBrake heartbeat failed with HTTP ${response.status}`,
        code: typeof error?.code === "string" ? error.code : "HTTP_ERROR",
        httpStatus: response.status,
        halt: error?.halt === true,
        retryable: error?.retryable === true,
        body: parsed,
      });
    }
    const body = parsed as Partial<HeartbeatReceipt> | null;
    return {
      ok: true,
      sidecar: true,
      proves: typeof body?.proves === "string" ? body.proves : "this request reached the BurnBrake sidecar",
      does_not_prove:
        typeof body?.does_not_prove === "string"
          ? body.does_not_prove
          : "absence of a second client, or that every provider call is gated",
      stops_all_spend: false,
    };
  }

  private async post(path: string, body: object, options: CallOptions): Promise<unknown> {
    const idempotencyKey = requireCallerToken(options?.idempotencyKey, "idempotencyKey");
    const userId = optionalCallerToken(options?.userId, "userId");
    const runId = optionalCallerToken(options?.runId, "runId");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-burnbrake-key": this.apiKey,
      "idempotency-key": idempotencyKey,
    };
    if (userId) headers["x-burnbrake-user-id"] = userId;
    if (runId) headers["x-burnbrake-run-id"] = runId;
    const response = await this.fetchImpl(`${this.baseURL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (response.status === 402) {
      // Curve delay is sidecar-side only. Do not sleep again on 402.
      const error = errorObject(parsed);
      if (error?.code === "BUDGET_EXHAUSTED") {
        throw new BudgetExhausted({
          message: typeof error.message === "string" ? error.message : "Budget exhausted. Halt.",
          scope: typeof error.scope === "string" ? error.scope : null,
          remaining_micros: typeof error.remaining_micros === "number" ? error.remaining_micros : null,
          requested_micros: typeof error.requested_micros === "number" ? error.requested_micros : null,
          run_id: typeof error.run_id === "string" ? error.run_id : null,
          user_id: typeof error.user_id === "string" ? error.user_id : null,
        });
      }
      if (error?.code === "SPEND_PAUSED") {
        throw new SpendPaused(typeof error.message === "string" ? error.message : "Spend is paused. Halt.");
      }
    }
    if (response.status < 200 || response.status >= 300) {
      const error = errorObject(parsed);
      throw new BurnBrakeError({
        message: typeof error?.message === "string" ? error.message : `BurnBrake request failed with HTTP ${response.status}`,
        code: typeof error?.code === "string" ? error.code : "HTTP_ERROR",
        httpStatus: response.status,
        halt: error?.halt === true || response.status === 402,
        retryable: error?.retryable === true,
        body: parsed,
      });
    }
    return parsed;
  }
}

function requireCallerToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !callerTokenOk(value.trim())) {
    if (label === "idempotencyKey") throw new IdempotencyKeyRequired();
    throw new BurnBrakeError({
      message: `${label} must be 1–200 characters and must not contain control characters.`,
      code: "BAD_REQUEST",
      httpStatus: 400,
      halt: true,
      retryable: false,
    });
  }
  return value.trim();
}

function optionalCallerToken(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  return requireCallerToken(value, label);
}

function callerTokenOk(value: string): boolean {
  if (value.length < 1 || value.length > 200) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function errorObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  return error as Record<string, unknown>;
}
