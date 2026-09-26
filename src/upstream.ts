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
  route: string;
  body: Record<string, unknown>;
  completionTokenOverride: number | null;
  statusOverride: number | null;
  inputTokensHint: number;
}): Promise<ForwardResult> {
  if (opts.mock) return mockForward(opts);
  if (!opts.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set. Refusing to forward. Use BURNBRAKE_MOCK_UPSTREAM=1 for the offline demo.");
  }
  const url = new URL(opts.route, opts.upstreamBaseURL.endsWith("/") ? opts.upstreamBaseURL : `${opts.upstreamBaseURL}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.openaiApiKey}`,
    },
    body: JSON.stringify(opts.body),
    redirect: "manual",
  });
  const bodyText = await response.text();
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

export function parseUsageText(
  contentType: string,
  bodyText: string,
): { prompt_tokens: number; completion_tokens: number } | null {
  if (contentType.includes("event-stream") || bodyText.includes("\ndata:") || bodyText.startsWith("data:")) {
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
  const prompt = (usage as { prompt_tokens?: unknown }).prompt_tokens;
  const completion = (usage as { completion_tokens?: unknown }).completion_tokens;
  if (typeof prompt !== "number" || typeof completion !== "number") return null;
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  return { prompt_tokens: Math.floor(prompt), completion_tokens: Math.floor(completion) };
}
