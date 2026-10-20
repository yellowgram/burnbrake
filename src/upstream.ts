export interface MockState {
  forwardCount: number;
  lastBody: unknown | null;
  lastRoute: string | null;
}

export type ForwardResult =
  | { kind: "buffered"; status: number; contentType: string; bodyText: string }
  | {
      kind: "stream";
      status: number;
      contentType: string;
      /** Upstream bytes as they arrive. Iterate once. */
      body: AsyncIterable<Uint8Array>;
      /** Stop reading and close the upstream connection (client went away). */
      abort: () => void;
    };

/** Non-streamed upstream bodies above this size are refused (the provider has billed; we debit the estimate). */
const BUFFERED_BODY_LIMIT = 8_000_000;
/**
 * How long to wait for the provider's response headers (and, for a non-streamed reply,
 * its whole body). Non-streamed replies send headers only when generation ends, so this
 * is long; it stays under the 15-minute reservation TTL.
 */
export const UPSTREAM_RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;

export async function forwardToUpstream(opts: {
  mock: boolean;
  mockState: MockState;
  upstreamBaseURL: string;
  openaiApiKey: string | null;
  anthropicBaseURL?: string;
  anthropicApiKey?: string | null;
  provider?: "openai" | "anthropic";
  route: string;
  body: Record<string, unknown>;
  completionTokenOverride: number | null;
  statusOverride: number | null;
  inputTokensHint: number;
  /** Aborts the upstream call (the client went away). */
  signal?: AbortSignal;
  responseTimeoutMs?: number;
}): Promise<ForwardResult> {
  if (opts.mock) return mockForward(opts);
  const anthropic = opts.provider === "anthropic";
  if (anthropic && !opts.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Refusing to forward. Use BURNBRAKE_MOCK_UPSTREAM=1 for the offline demo.");
  }
  if (!anthropic && !opts.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set. Refusing to forward. Use BURNBRAKE_MOCK_UPSTREAM=1 for the offline demo.");
  }
  const base = anthropic ? opts.anthropicBaseURL || "https://api.anthropic.com" : opts.upstreamBaseURL;
  const url = new URL(opts.route, base.endsWith("/") ? base : `${base}/`);
  const headers: Record<string, string> = anthropic
    ? {
        "content-type": "application/json",
        "x-api-key": opts.anthropicApiKey as string,
        "anthropic-version": "2023-06-01",
      }
    : {
        "content-type": "application/json",
        authorization: `Bearer ${opts.openaiApiKey}`,
      };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("upstream response timeout")), opts.responseTimeoutMs ?? UPSTREAM_RESPONSE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body),
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    throw err;
  }
  const contentType = response.headers.get("content-type") ?? "application/json";
  if (response.body && contentType.toLowerCase().includes("event-stream")) {
    // Headers arrived; the stream itself is governed by the client connection.
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    const reader = response.body.getReader();
    return {
      kind: "stream",
      status: response.status,
      contentType,
      abort: () => controller.abort(),
      body: {
        async *[Symbol.asyncIterator]() {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              if (value) yield value;
            }
          } finally {
            reader.releaseLock();
          }
        },
      },
    };
  }
  try {
    const bodyText = await readLimitedText(response, BUFFERED_BODY_LIMIT);
    return { kind: "buffered", status: response.status, contentType, bodyText };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function mockForward(opts: {
  mockState: MockState;
  route: string;
  body: Record<string, unknown>;
  completionTokenOverride: number | null;
  statusOverride: number | null;
  inputTokensHint: number;
}): ForwardResult {
  opts.mockState.forwardCount += 1;
  opts.mockState.lastBody = opts.body;
  opts.mockState.lastRoute = opts.route;
  if (opts.statusOverride != null && opts.statusOverride >= 400) {
    return {
      kind: "buffered",
      status: opts.statusOverride,
      contentType: "application/json",
      bodyText: JSON.stringify({
        error: {
          message: "mock upstream error",
          type: "upstream_error",
          code: opts.statusOverride === 429 ? "rate_limit_exceeded" : "upstream_error",
        },
      }),
    };
  }
  const maxTokens = typeof opts.body.max_tokens === "number" ? opts.body.max_tokens : 16;
  const completion = opts.completionTokenOverride ?? Math.min(8, maxTokens);
  const prompt = Math.max(1, opts.inputTokensHint);
  const usage = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
  if (opts.body.stream === true) {
    const chunks =
      opts.route === "/v1/messages"
        ? anthropicMockStream(String(opts.body.model), prompt, completion)
        : [
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
            "data: [DONE]\n\n",
          ];
    return {
      kind: "stream",
      status: 200,
      contentType: "text/event-stream",
      abort: () => {},
      body: (async function* () {
        for (const c of chunks) yield Buffer.from(c);
      })(),
    };
  }
  if (opts.route === "/v1/messages") {
    return {
      kind: "buffered",
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: opts.body.model,
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: prompt, output_tokens: completion },
      }),
    };
  }
  const object = opts.route === "/v1/completions" ? "text_completion" : "chat.completion";
  const body =
    opts.route === "/v1/completions"
      ? {
          id: "cmpl-mock",
          object,
          model: opts.body.model,
          choices: [{ text: "ok", index: 0, finish_reason: "stop" }],
          usage,
        }
      : {
          id: "chatcmpl-mock",
          object,
          model: opts.body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage,
        };
  return { kind: "buffered", status: 200, contentType: "application/json", bodyText: JSON.stringify(body) };
}

/** The event sequence Anthropic documents for a streamed Messages call (no `[DONE]`). */
function anthropicMockStream(model: string, input: number, output: number): string[] {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev("message_start", {
      type: "message_start",
      message: { id: "msg_mock", type: "message", role: "assistant", content: [], model, stop_reason: null, usage: { input_tokens: input, output_tokens: 1 } },
    }),
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
    ev("content_block_stop", { type: "content_block_stop", index: 0 }),
    ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } }),
    ev("message_stop", { type: "message_stop" }),
  ];
}

const UPSTREAM_BODY_LIMIT_LABEL = "UPSTREAM_BODY_TOO_LARGE";

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) throw new Error(UPSTREAM_BODY_LIMIT_LABEL);
    return text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(UPSTREAM_BODY_LIMIT_LABEL);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  /** Provider-run tool calls billed per use, e.g. { web_search: 3 }. */
  server_tool_requests?: Record<string, number>;
}

/**
 * Reads a server-sent-event stream as it passes through, without keeping it.
 * Knows both stream dialects BurnBrake governs:
 * - OpenAI: usage arrives in a chunk's `usage` (with `stream_options.include_usage`),
 *   the stream ends with `data: [DONE]`.
 * - Anthropic Messages: input tokens arrive in `message_start.message.usage`, output
 *   tokens (cumulative) in `message_delta.usage`, the stream ends with `message_stop`.
 */
export class SseUsageTracker {
  private pending = "";
  private openai: Usage | null = null;
  /** Latest value of each Anthropic usage field. `message_delta` counts are cumulative, so later wins. */
  private anthropic: Record<string, unknown> | null = null;
  /** message_start carries a placeholder output count; only a message_delta count is final. */
  private anthropicOutputFinal = false;
  finished = false;

  feed(chunk: string): void {
    this.pending += chunk;
    let nl: number;
    while ((nl = this.pending.indexOf("\n")) >= 0) {
      this.line(this.pending.slice(0, nl));
      this.pending = this.pending.slice(nl + 1);
    }
    // A line this long is content, never a usage event. Do not let it grow without bound.
    if (this.pending.length > 1_000_000) this.pending = "";
  }

  /** Call at end of stream so a final line without a newline still counts. */
  end(): void {
    if (this.pending) this.line(this.pending);
    this.pending = "";
  }

  /** Usage if the stream finished and reported it, else null (settle at the estimate). */
  usage(): Usage | null {
    if (!this.finished) return null;
    if (this.anthropic) {
      const input = anthropicInputTokens(this.anthropic);
      const output = tokenCount(this.anthropic, "output_tokens", "output_tokens");
      if (!this.anthropicOutputFinal) return null;
      return input != null && output != null ? withServerTools({ prompt_tokens: input, completion_tokens: output }, this.anthropic) : null;
    }
    return this.openai;
  }

  private mergeAnthropic(usage: unknown): void {
    if (!usage || typeof usage !== "object") return;
    this.anthropic = { ...(this.anthropic ?? {}), ...(usage as Record<string, unknown>) };
  }

  private line(raw: string): void {
    const line = raw.trim();
    if (line === "event: message_stop" || line === "event:message_stop") {
      this.finished = true;
      return;
    }
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      this.finished = true;
      return;
    }
    if (!payload) return;
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    switch (obj.type) {
      case "message_start":
        this.mergeAnthropic((obj.message as { usage?: unknown } | undefined)?.usage);
        return;
      case "message_delta":
        this.mergeAnthropic(obj.usage);
        if (obj.usage && typeof (obj.usage as Record<string, unknown>).output_tokens === "number") this.anthropicOutputFinal = true;
        return;
      case "message_stop":
        this.finished = true;
        return;
    }
    const usage = parseUsageObject(obj);
    if (usage) this.openai = usage;
  }
}

/**
 * Anthropic bills prompt-cache tokens at different rates than plain input:
 * reads at 0.1x (a few newer models charge less; BurnBrake uses the higher rate), 5-minute writes at 1.25x, 1-hour writes at 2x. BurnBrake prices
 * one input rate per model, so it converts cache tokens to input-token equivalents
 * (rounding up). If the write breakdown is missing it assumes the dearer 2x.
 */
export function anthropicInputTokens(usage: Record<string, unknown>): number | null {
  const n = (k: string) => (typeof usage[k] === "number" && Number.isFinite(usage[k]) && (usage[k] as number) >= 0 ? (usage[k] as number) : 0);
  if (typeof usage.input_tokens !== "number") return null;
  const breakdown = usage.cache_creation as Record<string, unknown> | undefined;
  let writes: number;
  if (breakdown && typeof breakdown === "object") {
    const b = (k: string) => (typeof breakdown[k] === "number" ? (breakdown[k] as number) : 0);
    writes = b("ephemeral_5m_input_tokens") * 1.25 + b("ephemeral_1h_input_tokens") * 2;
  } else {
    writes = n("cache_creation_input_tokens") * 2;
  }
  return Math.ceil(n("input_tokens") + writes + n("cache_read_input_tokens") * 0.1);
}

/** Usage that is safe to settle. A stream that never reached its end marker is unfinished. */
export function settleUsage(contentType: string, bodyText: string): Usage | null {
  if (contentType.toLowerCase().includes("event-stream")) {
    const tracker = new SseUsageTracker();
    tracker.feed(bodyText);
    tracker.end();
    return tracker.usage();
  }
  return parseUsageText(contentType, bodyText);
}

export function parseUsageText(contentType: string, bodyText: string): Usage | null {
  const type = contentType.toLowerCase();
  const isJson = type.includes("json");
  const looksLikeSse = bodyText.includes("\ndata:") || bodyText.startsWith("data:");
  if (type.includes("event-stream") || (!isJson && looksLikeSse)) {
    const tracker = new SseUsageTracker();
    tracker.feed(bodyText);
    tracker.end();
    tracker.finished = true;
    return tracker.usage();
  }
  if (isJson) {
    const direct = parseJsonUsage(bodyText);
    if (direct) return direct;
    const head = bodyText.split("\ndata:")[0];
    if (head !== bodyText) return parseJsonUsage(head);
    return null;
  }
  return parseJsonUsage(bodyText);
}

function parseJsonUsage(bodyText: string): Usage | null {
  try {
    return parseUsageObject(JSON.parse(bodyText) as unknown);
  } catch {
    return null;
  }
}

function parseUsageObject(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const row = usage as Record<string, unknown>;
  const prompt = typeof row.prompt_tokens === "number" ? tokenCount(row, "prompt_tokens", "input_tokens") : anthropicInputTokens(row);
  const completion = tokenCount(row, "completion_tokens", "output_tokens");
  if (prompt == null || completion == null) return null;
  return withServerTools({ prompt_tokens: prompt, completion_tokens: completion }, row);
}

/** Anthropic reports `usage.server_tool_use.web_search_requests` and the like. */
function withServerTools(usage: Usage, row: Record<string, unknown>): Usage {
  const st = row.server_tool_use;
  if (!st || typeof st !== "object") return usage;
  const requests: Record<string, number> = {};
  for (const [k, v] of Object.entries(st as Record<string, unknown>)) {
    if (!k.endsWith("_requests")) continue;
    // An unreadable count is charged as unknown (the estimate), never as zero.
    requests[k.slice(0, -"_requests".length)] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.ceil(v) : Number.NaN;
  }
  return { ...usage, server_tool_requests: requests };
}

function tokenCount(row: Record<string, unknown>, primary: string, alternate: string): number | null {
  const chosen = typeof row[primary] === "number" ? row[primary] : row[alternate];
  if (typeof chosen !== "number" || !Number.isFinite(chosen) || chosen < 0) return null;
  return Math.floor(chosen);
}
