export interface MockState {
  forwardCount: number;
  lastBody: unknown | null;
  lastRoute: string | null;
}

export interface ForwardResult {
  status: number;
  contentType: string;
  bodyText: string;
}

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
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
    redirect: "manual",
  });
  const bodyText = await readLimitedText(response, 2_000_000);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    bodyText,
  };
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
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "ok" } }] })}\n\n`,
      `data: ${JSON.stringify({ usage })}\n\n`,
      "data: [DONE]\n\n",
    ];
    return { status: 200, contentType: "text/event-stream", bodyText: chunks.join("") };
  }
  if (opts.route === "/v1/messages") {
    return {
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
  return { status: 200, contentType: "application/json", bodyText: JSON.stringify(body) };
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

/** Usage that is safe to settle. An event stream without a terminal `[DONE]` is unfinished. */
export function settleUsage(
  contentType: string,
  bodyText: string,
): { prompt_tokens: number; completion_tokens: number } | null {
  if (contentType.toLowerCase().includes("event-stream") && !sseFinished(bodyText)) return null;
  return parseUsageText(contentType, bodyText);
}

function sseFinished(bodyText: string): boolean {
  for (const line of bodyText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") return true;
  }
  return false;
}

export function parseUsageText(
  contentType: string,
  bodyText: string,
): { prompt_tokens: number; completion_tokens: number } | null {
  const type = contentType.toLowerCase();
  const isJson = type.includes("json");
  const looksLikeSse = bodyText.includes("\ndata:") || bodyText.startsWith("data:");
  if (type.includes("event-stream") || (!isJson && looksLikeSse)) {
    return parseSseUsage(bodyText);
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

function parseSseUsage(bodyText: string): { prompt_tokens: number; completion_tokens: number } | null {
  let found: { prompt_tokens: number; completion_tokens: number } | null = null;
  for (const line of bodyText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const usage = parseUsageObject(JSON.parse(payload) as unknown);
      if (usage) found = usage;
    } catch {
      /* keep scanning */
    }
  }
  return found;
}

function parseJsonUsage(bodyText: string): { prompt_tokens: number; completion_tokens: number } | null {
  try {
    return parseUsageObject(JSON.parse(bodyText) as unknown);
  } catch {
    return null;
  }
}

function parseUsageObject(value: unknown): { prompt_tokens: number; completion_tokens: number } | null {
  if (!value || typeof value !== "object") return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const row = usage as Record<string, unknown>;
  const prompt = tokenCount(row, "prompt_tokens", "input_tokens");
  const completion = tokenCount(row, "completion_tokens", "output_tokens");
  if (prompt == null || completion == null) return null;
  return { prompt_tokens: prompt, completion_tokens: completion };
}

function tokenCount(row: Record<string, unknown>, primary: string, alternate: string): number | null {
  const chosen = typeof row[primary] === "number" ? row[primary] : row[alternate];
  if (typeof chosen !== "number" || !Number.isFinite(chosen) || chosen < 0) return null;
  return Math.floor(chosen);
}
