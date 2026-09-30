import { tokensToMicros } from "./money.js";
import type { PriceTable } from "./prices.js";

export type MaxTokensSource = "request" | "injected";

export interface EstimateSuccess {
  ok: true;
  micros: number;
  maxTokens: number;
  maxTokensSource: MaxTokensSource;
  inputTokens: number;
  outputTokens: number;
  flatMicros: number;
  model: string;
  forwardBody: Record<string, unknown>;
}

export interface EstimateFailure {
  ok: false;
  code: "UNPRICED_MODEL" | "UNKNOWN_SURCHARGE" | "BAD_REQUEST";
  message: string;
}

export type EstimateResult = EstimateSuccess | EstimateFailure;

export type GovernedRoute = "/v1/chat/completions" | "/v1/completions";

/** Mandatory floors. A price-table value below these is raised. Fail closed; never lowered. */
export const VISION_INPUT_TOKEN_FLOOR = 1600;
export const VISION_FLAT_MICROS_FLOOR = 5_000;
export const TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR = 512;
export const TOOLS_FLAT_MICROS_FLOOR = 10_000;

export function estimateRequest(
  body: Record<string, unknown>,
  table: PriceTable,
  defaultMaxTokens: number,
  route: GovernedRoute,
): EstimateResult {
  try {
    if (route === "/v1/chat/completions") {
      return estimateChat(body, table, defaultMaxTokens);
    }
    return estimateCompletion(body, table, defaultMaxTokens);
  } catch (err) {
    if (isEstimateFailure(err)) return err;
    throw err;
  }
}

export function costFromUsage(
  table: PriceTable,
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number },
  flatMicros: number,
): number | null {
  const price = table.models[model];
  if (!price) return null;
  if (price.inputMicrosPerMillion === 0 && price.outputMicrosPerMillion === 0 && !price.allowZeroPrice) {
    return null;
  }
  const input = tokensToMicros(usage.prompt_tokens, price.inputMicrosPerMillion);
  const output = tokensToMicros(usage.completion_tokens, price.outputMicrosPerMillion);
  const total = input + output + flatMicros;
  return total <= 0 ? 0 : total;
}

function estimateChat(
  body: Record<string, unknown>,
  table: PriceTable,
  defaultMaxTokens: number,
): EstimateSuccess {
  const model = requireModel(body);
  const price = requirePrice(table, model);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    fail("BAD_REQUEST", "chat completions require a non-empty messages array.");
  }
  const acc = { text: "", images: 0 };
  for (const message of body.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      fail("BAD_REQUEST", "each message must be an object.");
    }
    const msg = message as Record<string, unknown>;
    walkContent(msg.content, acc, table);
    if (typeof msg.refusal === "string") acc.text += msg.refusal;
  }
  if (body.modalities != null || body.audio != null) {
    fail("UNKNOWN_SURCHARGE", "audio/modalities are not in the price table; refusing the request.");
  }
  const toolsPresent = hasTools(body);
  const ceiling = outputCeiling(body, defaultMaxTokens);
  const choices = choiceCount(body);
  const inputTokens =
    textTokens(acc.text) +
    body.messages.length * 4 +
    3 +
    acc.images * visionInputTokens(table);
  const outputTokens = scaleOutputTokens(ceiling.maxTokens, toolsExtraOutput(table, toolsPresent), choices);
  const flatMicros = acc.images * visionFlatMicros(table) + toolsFlatMicros(table, toolsPresent);
  const micros = atLeastOne(
    tokensToMicros(inputTokens, price.inputMicrosPerMillion) +
      tokensToMicros(outputTokens, price.outputMicrosPerMillion) +
      flatMicros,
    price,
  );
  return {
    ok: true,
    micros,
    maxTokens: ceiling.maxTokens,
    maxTokensSource: ceiling.source,
    inputTokens,
    outputTokens,
    flatMicros,
    model,
    forwardBody: ceiling.forwardBody,
  };
}

function estimateCompletion(
  body: Record<string, unknown>,
  table: PriceTable,
  defaultMaxTokens: number,
): EstimateSuccess {
  const model = requireModel(body);
  const price = requirePrice(table, model);
  if (body.prompt == null) {
    fail("BAD_REQUEST", "completions require a prompt.");
  }
  const acc = { text: "", images: 0 };
  collectPrompt(body.prompt, acc);
  if (acc.images > 0) {
    fail("UNKNOWN_SURCHARGE", "image prompts are not priced on /v1/completions.");
  }
  const toolsPresent = hasTools(body);
  const ceiling = outputCeiling(body, defaultMaxTokens);
  const choices = choiceCount(body);
  const inputTokens = textTokens(acc.text) + 2;
  const outputTokens = scaleOutputTokens(ceiling.maxTokens, toolsExtraOutput(table, toolsPresent), choices);
  const flatMicros = toolsFlatMicros(table, toolsPresent);
  const micros = atLeastOne(
    tokensToMicros(inputTokens, price.inputMicrosPerMillion) +
      tokensToMicros(outputTokens, price.outputMicrosPerMillion) +
      flatMicros,
    price,
  );
  return {
    ok: true,
    micros,
    maxTokens: ceiling.maxTokens,
    maxTokensSource: ceiling.source,
    inputTokens,
    outputTokens,
    flatMicros,
    model,
    forwardBody: ceiling.forwardBody,
  };
}

function collectPrompt(prompt: unknown, acc: { text: string; images: number }): void {
  if (typeof prompt === "string") {
    acc.text += prompt;
    return;
  }
  if (Array.isArray(prompt) && prompt.every((p) => typeof p === "string")) {
    acc.text += prompt.join("\n");
    return;
  }
  fail("UNKNOWN_SURCHARGE", "unsupported prompt shape on /v1/completions.");
}

function walkContent(
  content: unknown,
  acc: { text: string; images: number },
  table: PriceTable,
): void {
  if (content == null) return;
  if (typeof content === "string") {
    acc.text += content;
    return;
  }
  if (!Array.isArray(content)) {
    fail("UNKNOWN_SURCHARGE", "message content shape is not priced.");
  }
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      fail("UNKNOWN_SURCHARGE", "message content part is not priced.");
    }
    const row = part as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "text";
    if (!table.surcharges.knownContentTypes.has(type)) {
      fail("UNKNOWN_SURCHARGE", `content type "${type}" is not in the price table; refusing the request.`);
    }
    if (type === "text" || type === "input_text") {
      if (typeof row.text === "string") acc.text += row.text;
    } else if (type === "image_url" || type === "image") {
      acc.images += 1;
    }
  }
}

function hasTools(body: Record<string, unknown>): boolean {
  if (Array.isArray(body.tools) && body.tools.length > 0) return true;
  if (Array.isArray(body.functions) && body.functions.length > 0) return true;
  return false;
}

function outputCeiling(
  body: Record<string, unknown>,
  defaultMaxTokens: number,
): { maxTokens: number; source: MaxTokensSource; forwardBody: Record<string, unknown> } {
  const fromMax = readOptionalPositiveInt(body.max_tokens, "max_tokens");
  const fromCompletion = readOptionalPositiveInt(body.max_completion_tokens, "max_completion_tokens");
  const forwardBody: Record<string, unknown> = { ...body };
  if (fromMax == null && fromCompletion == null) {
    forwardBody.max_tokens = defaultMaxTokens;
    if (forwardBody.stream === true) {
      const existing =
        forwardBody.stream_options && typeof forwardBody.stream_options === "object" && !Array.isArray(forwardBody.stream_options)
          ? { ...(forwardBody.stream_options as Record<string, unknown>) }
          : {};
      if (existing.include_usage === undefined) existing.include_usage = true;
      forwardBody.stream_options = existing;
    }
    return { maxTokens: defaultMaxTokens, source: "injected", forwardBody };
  }
  const maxTokens = Math.max(fromMax ?? 0, fromCompletion ?? 0);
  if (forwardBody.stream === true) {
    const existing =
      forwardBody.stream_options && typeof forwardBody.stream_options === "object" && !Array.isArray(forwardBody.stream_options)
        ? { ...(forwardBody.stream_options as Record<string, unknown>) }
        : {};
    if (existing.include_usage === undefined) existing.include_usage = true;
    forwardBody.stream_options = existing;
  }
  return { maxTokens, source: "request", forwardBody };
}

function choiceCount(body: Record<string, unknown>): number {
  const n = readOptionalPositiveInt(body.n, "n") ?? 1;
  const bestOf = readOptionalPositiveInt(body.best_of, "best_of") ?? 1;
  return Math.max(n, bestOf);
}

function scaleOutputTokens(ceiling: number, toolsExtra: number, choices: number): number {
  if (!Number.isSafeInteger(ceiling) || !Number.isSafeInteger(toolsExtra) || !Number.isSafeInteger(choices)) {
    fail("BAD_REQUEST", "n or best_of times the output ceiling is too large to reserve.");
  }
  const perChoice = ceiling + toolsExtra;
  if (!Number.isSafeInteger(perChoice)) {
    fail("BAD_REQUEST", "n or best_of times the output ceiling is too large to reserve.");
  }
  const product = perChoice * choices;
  if (!Number.isSafeInteger(product)) {
    fail("BAD_REQUEST", "n or best_of times the output ceiling is too large to reserve.");
  }
  return product;
}

function readOptionalPositiveInt(value: unknown, label: string): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail("BAD_REQUEST", `${label} must be a positive integer when present. BurnBrake will not rewrite it.`);
  }
  return value;
}

function requireModel(body: Record<string, unknown>): string {
  if (typeof body.model !== "string" || body.model.trim() === "") {
    fail("BAD_REQUEST", "model is required.");
  }
  return body.model.trim();
}

function requirePrice(table: PriceTable, model: string): { inputMicrosPerMillion: number; outputMicrosPerMillion: number; allowZeroPrice: boolean } {
  const price = table.models[model];
  if (!price) {
    fail("UNPRICED_MODEL", `model "${model}" is not in price table ${table.version}. Unpriced models are denied.`);
  }
  if (price.inputMicrosPerMillion === 0 && price.outputMicrosPerMillion === 0 && !price.allowZeroPrice) {
    fail("UNPRICED_MODEL", `model "${model}" has no positive rate. Refusing silent $0.`);
  }
  return price;
}

function visionInputTokens(table: PriceTable): number {
  return Math.max(table.surcharges.visionPerImageInputTokens, VISION_INPUT_TOKEN_FLOOR);
}

function visionFlatMicros(table: PriceTable): number {
  return Math.max(table.surcharges.visionPerImageMicros, VISION_FLAT_MICROS_FLOOR);
}

function toolsExtraOutput(table: PriceTable, toolsPresent: boolean): number {
  if (!toolsPresent) return 0;
  return Math.max(table.surcharges.toolsExtraOutputTokens, TOOLS_EXTRA_OUTPUT_TOKEN_FLOOR);
}

function toolsFlatMicros(table: PriceTable, toolsPresent: boolean): number {
  if (!toolsPresent) return 0;
  return Math.max(table.surcharges.toolsFlatMicros, TOOLS_FLAT_MICROS_FLOOR);
}

function textTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function atLeastOne(
  micros: number,
  price: { inputMicrosPerMillion: number; outputMicrosPerMillion: number; allowZeroPrice: boolean },
): number {
  if (micros > 0) return micros;
  if (price.allowZeroPrice) return 0;
  return 1;
}

function fail(code: EstimateFailure["code"], message: string): never {
  throw { ok: false as const, code, message };
}

function isEstimateFailure(err: unknown): err is EstimateFailure {
  return Boolean(
    err &&
      typeof err === "object" &&
      "ok" in err &&
      (err as EstimateFailure).ok === false &&
      "code" in err,
  );
}
