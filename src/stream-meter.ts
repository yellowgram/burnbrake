import { generatedTextTokens, serverToolName } from "./estimate.js";
import { anthropicInputTokens as anthropicInput, type Usage } from "./upstream.js";

/**
 * Mid-stream metering for the stream kill.
 *
 * `SseEventFramer` cuts decoded upstream text into complete server-sent events, so BurnBrake
 * can decide event by event what reaches the client, and can always stop at an event boundary.
 * `StreamMeter` reads each event and keeps a running count of what the call has consumed:
 * - Anthropic Messages: `message_start.message.usage` gives the real input count (cache tokens
 *   converted like the settle path does); `content_block_delta` text, thinking and tool-input
 *   JSON are counted as output; `message_delta.usage.output_tokens` (cumulative) is the
 *   provider's own count; `server_tool_use` blocks count server-tool requests. There is no
 *   `[DONE]`; the stream ends with `message_stop`.
 * - OpenAI-style chunks (`/v1/chat/completions`, `/v1/completions`): each choice's delta text,
 *   refusal, tool-call name/arguments and legacy function_call count as output (at least one
 *   token per choice per chunk); a chunk's `usage` (sent last with include_usage) is the
 *   provider's own count.
 * Generated text is counted with the input estimator's floor (the larger of bytes/3 and the
 * pre-tokenizer piece count), so the meter errs high. The provider's count wins when it is higher.
 */

/** No real provider event comes near this. An event that grows past it without ending is not a stream BurnBrake can meter. */
export const MAX_SSE_EVENT_CHARS = 4_000_000;

export class SseEventFramer {
  private pending = "";
  /** Where to resume searching for a blank line (avoids rescanning a long event). */
  private scanFrom = 0;

  /** Returns the complete events in `text` (each with its own trailing blank line). Throws if one event is too large. */
  push(text: string): string[] {
    this.pending += text;
    const out: string[] = [];
    let start = 0;
    const re = /\r?\n\r?\n/g;
    re.lastIndex = Math.max(0, this.scanFrom);
    for (;;) {
      const m = re.exec(this.pending);
      if (!m) break;
      const end = m.index + m[0].length;
      out.push(this.pending.slice(start, end));
      start = end;
    }
    if (start > 0) this.pending = this.pending.slice(start);
    // A separator can straddle the next chunk ("\r\n\r" | "\n"): rescan the last 3 chars.
    this.scanFrom = Math.max(0, this.pending.length - 3);
    if (this.pending.length > MAX_SSE_EVENT_CHARS) throw new Error("SSE_EVENT_TOO_LARGE");
    return out;
  }

  /** Whatever is left when the upstream ends (a final event without a blank line). */
  flush(): string {
    const rest = this.pending;
    this.pending = "";
    this.scanFrom = 0;
    return rest;
  }
}

export interface MeterStep {
  /** The event added consumption (tokens, input count or a server-tool request). */
  grew: boolean;
  /** The event reports final usage: generation is over, so there is nothing left to stop. */
  final: boolean;
}

export class StreamMeter {
  /** Real input count reported by the provider (Anthropic message_start), in input-token equivalents. */
  inputTokensReported: number | null = null;
  /** Output tokens counted from deltas. */
  outputTokensCounted = 0;
  /** Highest output count the provider reported so far. */
  outputTokensReported = 0;
  private serverToolsSeen: Record<string, number> = {};
  private serverToolsReported: Record<string, number> = {};

  constructor(readonly dialect: "anthropic" | "openai") {}

  /**
   * The consumption so far, as a usage object `costFromUsage` can price.
   *
   * `outputCeiling` is the output the reservation already covers (max_tokens × choices, as
   * estimated). The delta count errs high (bytes / 3 per delta), and a provider can't generate
   * past max_tokens, so the counted output is capped there: counting alone never pushes a
   * stream past its own reservation. The provider's own reported count is never capped.
   */
  usage(estimatedInputTokens: number, outputCeiling = Infinity): Usage {
    const names = new Set([...Object.keys(this.serverToolsSeen), ...Object.keys(this.serverToolsReported)]);
    const usage: Usage = {
      prompt_tokens: this.inputTokensReported ?? estimatedInputTokens,
      completion_tokens: Math.max(Math.min(this.outputTokensCounted, outputCeiling), this.outputTokensReported),
    };
    if (names.size) {
      usage.server_tool_requests = {};
      for (const n of names) usage.server_tool_requests[n] = Math.max(this.serverToolsSeen[n] ?? 0, this.serverToolsReported[n] ?? 0);
    }
    return usage;
  }

  /**
   * What a cut stream is charged: the input and server tools seen so far, and the whole output
   * allowance (`outputCeiling`, or more if the provider reported more). The stream is closed
   * before its final usage arrives, so output the provider billed but never streamed (Claude's
   * summarized or redacted thinking, OpenAI reasoning tokens, tokens generated after the close)
   * can't be counted; all of it lies within max_tokens, so the allowance covers it.
   */
  cutUsage(estimatedInputTokens: number, outputCeiling: number): Usage {
    const usage = this.usage(estimatedInputTokens, outputCeiling);
    usage.completion_tokens = Math.max(usage.completion_tokens, outputCeiling);
    return usage;
  }

  observe(event: string): MeterStep {
    const data = eventData(event);
    if (data == null || data === "[DONE]") return { grew: false, final: data === "[DONE]" };
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      return { grew: false, final: false };
    }
    if (!value || typeof value !== "object") return { grew: false, final: false };
    return this.dialect === "anthropic" ? this.anthropic(value as Record<string, unknown>) : this.openai(value as Record<string, unknown>);
  }

  private anthropic(obj: Record<string, unknown>): MeterStep {
    switch (obj.type) {
      case "message_start": {
        const usage = (obj.message as { usage?: Record<string, unknown> } | undefined)?.usage;
        if (!usage || typeof usage !== "object") return { grew: false, final: false };
        const input = anthropicInput(usage);
        const before = this.snapshot();
        if (input != null) this.inputTokensReported = input;
        this.reportOutput(usage.output_tokens);
        return { grew: this.snapshot() !== before, final: false };
      }
      case "content_block_start": {
        const block = obj.content_block as Record<string, unknown> | undefined;
        if (block && block.type === "server_tool_use" && typeof block.name === "string") {
          const name = serverToolName(block.name);
          this.serverToolsSeen[name] = (this.serverToolsSeen[name] ?? 0) + 1;
          return { grew: true, final: false };
        }
        // A tool_use block's name is generated output too.
        if (block && block.type === "tool_use" && typeof block.name === "string") {
          this.outputTokensCounted += generatedTextTokens(block.name);
          return { grew: true, final: false };
        }
        return { grew: false, final: false };
      }
      case "content_block_delta": {
        const d = obj.delta as Record<string, unknown> | undefined;
        if (!d) return { grew: false, final: false };
        const text =
          d.type === "text_delta" ? d.text : d.type === "thinking_delta" ? d.thinking : d.type === "input_json_delta" ? d.partial_json : null;
        if (typeof text !== "string" || !text) return { grew: false, final: false };
        this.outputTokensCounted += generatedTextTokens(text);
        return { grew: true, final: false };
      }
      case "message_delta": {
        const usage = obj.usage as Record<string, unknown> | undefined;
        const before = this.snapshot();
        if (usage && typeof usage === "object") {
          this.reportOutput(usage.output_tokens);
          // Some streams repeat input counts here (cumulative); the later report wins.
          if (typeof usage.input_tokens === "number") {
            const input = anthropicInput(usage);
            if (input != null) this.inputTokensReported = Math.max(this.inputTokensReported ?? 0, input);
          }
          this.reportServerTools(usage.server_tool_use);
        }
        const stop = (obj.delta as Record<string, unknown> | undefined)?.stop_reason;
        return { grew: this.snapshot() !== before, final: stop != null };
      }
      case "message_stop":
        return { grew: false, final: true };
      default:
        return { grew: false, final: false };
    }
  }

  private openai(obj: Record<string, unknown>): MeterStep {
    const before = this.snapshot();
    let added = 0;
    if (Array.isArray(obj.choices)) {
      for (const choice of obj.choices) {
        if (!choice || typeof choice !== "object") continue;
        const c = choice as Record<string, unknown>;
        const delta = (c.delta && typeof c.delta === "object" ? c.delta : {}) as Record<string, unknown>;
        added += textTokens(delta.content);
        added += textTokens(delta.refusal);
        added += textTokens(delta.reasoning_content);
        added += textTokens(c.text); // /v1/completions
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            const fn = (call as { function?: Record<string, unknown> } | null)?.function;
            if (fn && typeof fn === "object") added += textTokens(fn.name) + textTokens(fn.arguments);
          }
        }
        const fc = delta.function_call as Record<string, unknown> | undefined;
        if (fc && typeof fc === "object") added += textTokens(fc.name) + textTokens(fc.arguments);
      }
    }
    this.outputTokensCounted += added;
    const usage = obj.usage as Record<string, unknown> | undefined;
    const hasUsage = Boolean(usage && typeof usage === "object");
    if (usage && hasUsage) {
      this.reportOutput(usage.completion_tokens ?? usage.output_tokens);
      const prompt = usage.prompt_tokens ?? usage.input_tokens;
      if (typeof prompt === "number" && Number.isFinite(prompt) && prompt >= 0) this.inputTokensReported = Math.ceil(prompt);
    }
    // include_usage sends usage in its own last chunk, after every choice finished.
    return { grew: this.snapshot() !== before, final: hasUsage && added === 0 };
  }

  private reportOutput(v: unknown): void {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) this.outputTokensReported = Math.max(this.outputTokensReported, Math.ceil(v));
  }

  private reportServerTools(st: unknown): void {
    if (!st || typeof st !== "object") return;
    for (const [k, v] of Object.entries(st as Record<string, unknown>)) {
      if (!k.endsWith("_requests") || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
      const name = k.slice(0, -"_requests".length);
      this.serverToolsReported[name] = Math.max(this.serverToolsReported[name] ?? 0, Math.ceil(v));
    }
  }

  private snapshot(): string {
    return JSON.stringify([this.inputTokensReported, this.outputTokensCounted, this.outputTokensReported, this.serverToolsSeen, this.serverToolsReported]);
  }
}

function textTokens(v: unknown): number {
  return typeof v === "string" ? generatedTextTokens(v) : 0;
}

/** The joined `data:` lines of one event (SSE: one optional space after the colon), or null. */
export function eventData(event: string): string | null {
  let data: string[] | null = null;
  for (const raw of event.split(/\r?\n/)) {
    if (raw.startsWith("data:")) {
      const v = raw.slice(5);
      (data ??= []).push(v.startsWith(" ") ? v.slice(1) : v);
    }
  }
  return data == null ? null : data.join("\n").trim();
}

/**
 * The event that ends a cut stream. Both shapes are what each provider's SDK already treats as
 * a stream error: Anthropic's `event: error` with `{"type":"error","error":{...}}`, and an
 * OpenAI-style `data: {"error":{...}}` chunk (no `[DONE]` follows, so a client can't take the
 * cut answer for a complete one).
 */
export function terminalErrorEvent(dialect: "anthropic" | "openai", type: string, error: Record<string, unknown>): string {
  const body = { type, ...error };
  if (dialect === "anthropic") return `event: error\ndata: ${JSON.stringify({ type: "error", error: body })}\n\n`;
  return `data: ${JSON.stringify({ error: body })}\n\n`;
}
