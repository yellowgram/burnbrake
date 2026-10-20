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
  /**
   * Server tools reserved per use (Anthropic `max_uses`, summed per tool name). The provider
   * refuses and doesn't bill a use past `max_uses`, so this is also the most it can bill.
   */
  serverToolMaxUses?: Record<string, number>;
  model: string;
  forwardBody: Record<string, unknown>;
}

export interface EstimateFailure {
  ok: false;
  code: "UNPRICED_MODEL" | "UNKNOWN_SURCHARGE" | "BAD_REQUEST";
  message: string;
}

export type EstimateResult = EstimateSuccess | EstimateFailure;

export type GovernedRoute = "/v1/chat/completions" | "/v1/completions" | "/v1/messages";

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
    if (route === "/v1/messages") {
      return estimateMessages(body, table, defaultMaxTokens);
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
  usage: { prompt_tokens: number; completion_tokens: number; server_tool_requests?: Record<string, number> },
  flatMicros: number,
): number | null {
  const price = table.models[model];
  if (!price) return null;
  if (price.inputMicrosPerMillion === 0 && price.outputMicrosPerMillion === 0 && !price.allowZeroPrice) {
    return null;
  }
  const input = tokensToMicros(usage.prompt_tokens, price.inputMicrosPerMillion);
  const output = tokensToMicros(usage.completion_tokens, price.outputMicrosPerMillion);
  let serverTools = 0;
  for (const [name, count] of Object.entries(usage.server_tool_requests ?? {})) {
    if (count === 0) continue;
    if (!Number.isFinite(count)) return null;
    const perUse = table.serverTools[name];
    if (perUse == null) return null; // a billed tool BurnBrake can't price: charge the estimate
    serverTools += count * perUse;
  }
  const total = input + output + flatMicros + serverTools;
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
  const acc: Acc = { bytes: 0, pieces: 0, images: 0 };
  for (const message of body.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      fail("BAD_REQUEST", "each message must be an object.");
    }
    const msg = message as Record<string, unknown>;
    walkContent(msg.content, acc, table);
    addText(acc, msg.refusal);
    addText(acc, msg.name);
    addText(acc, msg.tool_call_id);
    // Tool calls the assistant made earlier are input on this turn.
    if (Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) addJson(acc, call);
    } else if (msg.tool_calls != null) {
      fail("BAD_REQUEST", "tool_calls must be an array.");
    }
    if (msg.function_call != null) addJson(acc, msg.function_call);
  }
  if (body.modalities != null || body.audio != null) {
    fail("UNKNOWN_SURCHARGE", "audio/modalities are not in the price table; refusing the request.");
  }
  if (body.web_search_options != null) {
    fail("UNKNOWN_SURCHARGE", "web_search_options is billed per search and is not in the price table; refusing the request.");
  }
  checkOpenAiTools(body);
  addJson(acc, body.tools);
  addJson(acc, body.functions);
  addJson(acc, body.tool_choice);
  addJson(acc, body.response_format);
  const toolsPresent = hasTools(body);
  const ceiling = outputCeiling(body, defaultMaxTokens);
  const choices = choiceCount(body);
  const inputTokens =
    textTokens(acc) +
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
  const acc: Acc = { bytes: 0, pieces: 0, images: 0 };
  collectPrompt(body.prompt, acc);
  if (acc.images > 0) {
    fail("UNKNOWN_SURCHARGE", "image prompts are not priced on /v1/completions.");
  }
  const toolsPresent = hasTools(body);
  const ceiling = outputCeiling(body, defaultMaxTokens);
  const choices = choiceCount(body);
  const inputTokens = textTokens(acc) + 2;
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

function estimateMessages(
  body: Record<string, unknown>,
  table: PriceTable,
  defaultMaxTokens: number,
): EstimateSuccess {
  const model = requireModel(body);
  const price = requirePrice(table, model);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    fail("BAD_REQUEST", "messages require a non-empty messages array.");
  }
  // MCP connector servers and code-execution containers bring billed tool definitions and runtime
  // the estimate can't see. Anthropic needs a beta header for them that BurnBrake doesn't forward,
  // but refuse them here too, so a provider-side change can't make them silently unpriced.
  if (body.mcp_servers != null) fail("UNKNOWN_SURCHARGE", "mcp_servers adds tool definitions and calls that are not in the price table; refusing the request.");
  if (body.container != null) fail("UNKNOWN_SURCHARGE", "container (code execution) is billed by the provider and is not in the price table; refusing the request.");
  const acc: Acc = { bytes: 0, pieces: 0, images: 0, tools: hasTools(body) };
  collectSystem(body.system, acc, table);
  const serverTools = anthropicTools(body, acc, table);
  const serverToolMicros = serverTools.micros;
  for (const message of body.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      fail("BAD_REQUEST", "each message must be an object.");
    }
    walkAnthropicContent((message as Record<string, unknown>).content, acc, table);
  }
  const ceiling = outputCeiling(body, defaultMaxTokens, false);
  const choices = choiceCount(body);
  const inputTokens = textTokens(acc) + body.messages.length * 4 + acc.images * visionInputTokens(table);
  const outputTokens = scaleOutputTokens(ceiling.maxTokens, toolsExtraOutput(table, Boolean(acc.tools)), choices);
  const flatMicros = acc.images * visionFlatMicros(table) + toolsFlatMicros(table, Boolean(acc.tools));
  // Server tools (web search) are reserved at max_uses x the per-use price; at settle the
  // reported request counts are charged instead (see costFromUsage).
  const micros = atLeastOne(
    tokensToMicros(inputTokens, price.inputMicrosPerMillion) +
      tokensToMicros(outputTokens, price.outputMicrosPerMillion) +
      flatMicros +
      serverToolMicros,
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
    ...(Object.keys(serverTools.maxUses).length ? { serverToolMaxUses: serverTools.maxUses } : {}),
    model,
    forwardBody: ceiling.forwardBody,
  };
}

interface Acc {
  /** UTF-8 bytes of every billed input part (text, tool schemas, tool calls and results). */
  bytes: number;
  /** floorTokens() of the same parts: a floor for the token count on GPT-style tokenizers. */
  pieces: number;
  images: number;
  tools?: boolean;
}

function addText(acc: Acc, value: unknown): void {
  if (typeof value === "string" && value) {
    acc.bytes += Buffer.byteLength(value, "utf8");
    acc.pieces += floorTokens(value);
  }
}

function addJson(acc: Acc, value: unknown): void {
  if (value == null) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  acc.bytes += Buffer.byteLength(text, "utf8");
  acc.pieces += floorTokens(text);
}

function collectSystem(system: unknown, acc: Acc, table: PriceTable): void {
  if (system == null) return;
  if (typeof system === "string") {
    addText(acc, system);
    return;
  }
  walkAnthropicContent(system, acc, table);
}

/**
 * Anthropic content blocks. Text is counted as text; images at the vision rate; a
 * tool_result's content is walked the same way (its images stay images). Every other
 * known block (tool_use, thinking, server tool calls and their results) is counted by
 * its JSON size, which is never less than what the model reads.
 */
function walkAnthropicContent(content: unknown, acc: Acc, table: PriceTable, depth = 0): void {
  if (content == null) return;
  if (typeof content === "string") {
    addText(acc, content);
    return;
  }
  if (!Array.isArray(content) || depth > 4) {
    fail("UNKNOWN_SURCHARGE", "message content shape is not priced.");
  }
  for (const part of content) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      fail("UNKNOWN_SURCHARGE", "message content part is not priced.");
    }
    const row = part as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";
    if (!type || !table.surcharges.knownContentTypes.has(type)) {
      fail("UNKNOWN_SURCHARGE", `content type "${type || "unknown"}" is not in the price table; refusing the request.`);
    }
    if (type === "text") {
      addText(acc, row.text);
    } else if (type === "image") {
      acc.images += 1;
    } else if (type === "tool_result") {
      acc.tools = true;
      addText(acc, row.tool_use_id);
      walkAnthropicContent(row.content, acc, table, depth + 1);
    } else {
      if (type === "tool_use") acc.tools = true;
      addJson(acc, row);
    }
  }
}

/**
 * Anthropic-defined tools that the client executes (bash, text editor, computer use). Their hidden
 * system prompt and tool definition tokens are not published per version, so they can't be priced.
 */
const ANTHROPIC_DEFINED_CLIENT_TOOLS = new Set(["bash", "text_editor", "computer"]);

/** Anthropic client tools have no type or type "custom"; anything else runs on Anthropic's side. */
function anthropicTools(body: Record<string, unknown>, acc: Acc, table: PriceTable): { micros: number; maxUses: Record<string, number> } {
  const reserved: Record<string, number> = {};
  if (body.tools == null) return { micros: 0, maxUses: reserved };
  if (!Array.isArray(body.tools)) fail("BAD_REQUEST", "tools must be an array.");
  let micros = 0;
  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) fail("BAD_REQUEST", "each tool must be an object.");
    const t = tool as Record<string, unknown>;
    addJson(acc, t);
    if (t.type == null || t.type === "custom") continue;
    const name = serverToolName(String(t.type));
    if (ANTHROPIC_DEFINED_CLIENT_TOOLS.has(name)) {
      fail("UNKNOWN_SURCHARGE", `tool type "${String(t.type)}" is an Anthropic-defined client tool; it adds a system prompt and tool tokens that are not in the price table; refusing the request. Define it as a custom tool instead.`);
    }
    const perUse = table.serverTools[name];
    if (perUse == null) {
      fail("UNKNOWN_SURCHARGE", `tool type "${String(t.type)}" is billed by the provider and is not in the price table (server_tools.${name}); refusing the request.`);
    }
    const maxUses = t.max_uses;
    if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1) {
      fail("UNKNOWN_SURCHARGE", `tool "${String(t.type)}" needs max_uses so its cost can be reserved; refusing the request.`);
    }
    micros += maxUses * perUse;
    reserved[name] = (reserved[name] ?? 0) + maxUses;
  }
  addJson(acc, body.tool_choice);
  return { micros, maxUses: reserved };
}

/** "web_search_20250305" -> "web_search". */
export function serverToolName(type: string): string {
  return type.replace(/_\d{8}$/, "");
}

/** OpenAI chat tools must be client tools; anything else is billed per use and unpriced. */
function checkOpenAiTools(body: Record<string, unknown>): void {
  if (body.tools == null) return;
  if (!Array.isArray(body.tools)) fail("BAD_REQUEST", "tools must be an array.");
  for (const tool of body.tools) {
    const type = tool && typeof tool === "object" ? (tool as Record<string, unknown>).type : undefined;
    if (type !== "function" && type !== "custom") {
      fail("UNKNOWN_SURCHARGE", `tool type "${String(type)}" is not a client tool and is not priced; refusing the request.`);
    }
  }
}

function collectPrompt(prompt: unknown, acc: Acc): void {
  if (typeof prompt === "string") {
    addText(acc, prompt);
    return;
  }
  if (Array.isArray(prompt) && prompt.every((p) => typeof p === "string")) {
    addText(acc, prompt.join("\n"));
    return;
  }
  fail("UNKNOWN_SURCHARGE", "unsupported prompt shape on /v1/completions.");
}

function walkContent(content: unknown, acc: Acc, table: PriceTable): void {
  if (content == null) return;
  if (typeof content === "string") {
    addText(acc, content);
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
      addText(acc, row.text);
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

/**
 * `openaiStreamUsage`: ask an OpenAI-shaped upstream to report usage at the end of a
 * stream (`stream_options.include_usage`). Anthropic streams always report usage and
 * reject unknown fields, so the Messages route passes false.
 */
function outputCeiling(
  body: Record<string, unknown>,
  defaultMaxTokens: number,
  openaiStreamUsage = true,
): { maxTokens: number; source: MaxTokensSource; forwardBody: Record<string, unknown> } {
  const fromMax = readOptionalPositiveInt(body.max_tokens, "max_tokens");
  const fromCompletion = readOptionalPositiveInt(body.max_completion_tokens, "max_completion_tokens");
  const forwardBody: Record<string, unknown> = { ...body };
  if (fromMax == null && fromCompletion == null) {
    forwardBody.max_tokens = defaultMaxTokens;
    if (forwardBody.stream === true && openaiStreamUsage) {
      const existing =
        forwardBody.stream_options && typeof forwardBody.stream_options === "object" && !Array.isArray(forwardBody.stream_options)
          ? { ...(forwardBody.stream_options as Record<string, unknown>) }
          : {};
      existing.include_usage = true;
      forwardBody.stream_options = existing;
    }
    return { maxTokens: defaultMaxTokens, source: "injected", forwardBody };
  }
  const maxTokens = Math.max(fromMax ?? 0, fromCompletion ?? 0);
  if (forwardBody.stream === true && openaiStreamUsage) {
    const existing =
      forwardBody.stream_options && typeof forwardBody.stream_options === "object" && !Array.isArray(forwardBody.stream_options)
        ? { ...(forwardBody.stream_options as Record<string, unknown>) }
        : {};
    existing.include_usage = true;
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

/**
 * Tokens from UTF-8 bytes, rounded up. Tokenizers average about 4 bytes per token on
 * English and fewer on JSON, code and non-Latin text; 3 bytes per token over-reserves
 * rather than under-reserves.
 */
function byteTokens(bytes: number): number {
  if (!bytes) return 0;
  return Math.ceil(bytes / 3);
}

/**
 * The pre-tokenizer split used by GPT-style byte-pair tokenizers (cl100k/o200k): an optional space
 * plus a run of letters, up to three digits (never with a leading space: GPT tokenizers split
 * " 7" into a space token and a digit token), an optional space plus a run of punctuation, or whitespace. BPE never merges
 * across these pieces, so each one costs at least one token. Text made of very short pieces
 * ("a b c …", digits, punctuation) is where bytes/3 under-counts.
 */
const PIECE = /'(?:[sdmt]|ll|ve|re)| ?[\p{L}\p{M}]+|\p{N}{1,3}| ?[^\s\p{L}\p{M}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu;
/**
 * Runs whose token count the pieces and bytes/3 can't bound. A BPE token is at
 * least one byte, so UTF-8 bytes is a guaranteed upper bound on tokens; these runs are counted
 * at their byte length:
 * - any non-ASCII run (CJK, Hangul, Arabic, Devanagari, emoji, symbols, accented Latin, …);
 * - a base64-like run: 8+ chars of [A-Za-z0-9+/=_-] containing a lowercase letter, an uppercase
 *   letter and a digit (base64, base64url, JWTs, API keys, data URLs);
 * - an alphanumeric run of 2+ chars with a letter and a digit, in any case (hashes, UUID groups,
 *   0x…, AWS key IDs, ULIDs, base32/base36 ids, k8s pod hashes, "v2", "utf8").
 */
const BYTE_COUNTED = /[^\x00-\x7f]+|(?<![A-Za-z0-9+\/=_-])(?=[A-Za-z0-9+\/=_-]*[a-z])(?=[A-Za-z0-9+\/=_-]*[A-Z])(?=[A-Za-z0-9+\/=_-]*[0-9])[A-Za-z0-9+\/=_-]{8,}|(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{2,}(?![A-Za-z0-9])/g;

/** The 200 letter pairs most often inside cl100k/o200k vocabulary words, commonest first. */
const BIGRAMS_RANKED = "erinenreonteestianatntstarlealorngraeddericoseliitiometaisroneeliclachvendastrmatoetgensdiienacesipecauracprecllunilheadloamrsolemomounipaeactsshaosrtmiiancuspoiddautthimtsbeciaiviigsairmohoulagabsofiapkempdoscnoothipltubablshsuivspeeopexvaodttlygaueeiocooumegboquckcrgrrdpifoaubilutywafeeprrcugiwecluirmryruevipownnbrfaakrnltavifaybuptppkaovuaucogduefwivoibkilsmbizuprczergguobmmhtffgonuldphdsmupuub";
const RANK = new Map(BIGRAMS_RANKED.match(/../g)!.map((b, i) => [b, i] as const));

/**
 * Marks the letters of `s` that sit in a run repeating a unit of 1-16 letters, ignoring case
 * ("llll", "abab", "ssnSSN", "emrmirpemrmirp"): at least two whole units long, and at least 6
 * letters (4 for a single repeated letter). Greedy; linear in the length.
 */
function repeatedRuns(s: string): Uint8Array {
  const t = s.toLowerCase();
  const mark = new Uint8Array(t.length);
  for (let i = 0; i < t.length; ) {
    let end = i;
    for (let n = 1; n <= 16 && i + 2 * n <= t.length; n++) {
      let j = i + n;
      while (j < t.length && t[j] === t[j - n]) j++;
      if (j - i >= (n === 1 ? 4 : Math.max(6, 2 * n)) && j > end) end = j;
    }
    if (end > i) {
      mark.fill(1, i, end);
      i = end;
    } else i++;
  }
  return mark;
}

/**
 * Tokens for one ASCII letter piece (optional leading space). BPE merges letters only along pairs
 * it has learned, so each letter pair that is not a common one is counted as a token boundary:
 * pairs ranked 100-199 (by how many cl100k/o200k vocabulary words contain them) as half a
 * boundary, rarer ones and every lower-to-upper step (camelCase) as a whole one; in a pair with
 * a capital, and in a piece with three or more capitals, only the 100 commonest pairs are free
 * (the 50 commonest for two capitals), and a capital followed by a single lowercase letter is a
 * boundary. A piece of 6+ letters gets one more token, and
 * a piece is never below a third of its bytes (two fifths from 8 letters: run-together words
 * split badly). Words keep about bytes/3; random ids and abbreviations count close to one token
 * per letter. Letters in a run that repeats a unit of 1-16 letters count one each (see
 * repeatedRuns). This is a heuristic, measured against the floor by the seeded fuzz test.
 */
function letterPieceTokens(p: string): number {
  const core = p.charCodeAt(0) === 32 ? p.slice(1) : p;
  // Three or more capitals in a piece that isn't all capitals (random mixed case, long
  // camelCase): every pair uses the strict list.
  const mixed = /[a-z]/.test(core) && (core.match(/[A-Z]/g)?.length ?? 0) >= 3;
  // Repeated runs count at bytes: their pairs look common, but BPE has no long tokens for
  // them (cl100k splits "llll", "abab", "ssnssn" every 1.5-2 letters).
  const rep = repeatedRuns(core);
  let repeated = 0;
  for (const m of rep) repeated += m;
  let boundaries = 0;
  for (let i = 1; i < core.length; i++) {
    if (rep[i - 1] && rep[i]) continue; // inside a repeated run: already counted at bytes
    const aLower = core[i - 1] >= "a";
    const bLower = core[i] >= "a";
    const rank = RANK.get((core[i - 1] + core[i]).toLowerCase()) ?? Infinity;
    if (aLower && !bLower) boundaries += 1;
    else if (!aLower && bLower && !(core[i + 1] >= "a")) boundaries += 1; // "Rt" in "RtP": no word follows
    else if (!aLower && !bLower) boundaries += rank < 50 ? 0 : 1; // two capitals: few merges in the vocabularies
    else if (mixed || !aLower || !bLower) boundaries += rank < 100 ? 0 : 1;
    else boundaries += rank < 100 ? 0 : rank < 200 ? 0.5 : 1;
  }
  return Math.max(core.length >= 8 ? p.length / 2.5 : p.length / 3, 1 + boundaries + repeated + (core.length >= 6 ? 1 : 0));
}

/**
 * A floor for the token count of `text` on GPT-style tokenizers: byte-counted runs (above) at
 * their UTF-8 length; for the ASCII rest, each letter piece by letterPieceTokens, a digit run (1-3)
 * at 1, a punctuation run at its length (many ASCII punctuation pairs are two tokens), whitespace
 * at 1 + a third of each run of one repeated space, tab or newline (other whitespace per
 * character), plus one token of margin. Checked against cl100k and o200k by the fixture and fuzz
 * tests (test/estimate-floor.test.ts, test/estimate-fuzz.test.ts).
 */
export function floorTokens(text: string): number {
  let total = 0;
  let last = 0;
  const rest = (part: string) => {
    if (!part) return;
    let letters = 0;
    for (const m of part.matchAll(PIECE)) {
      const p = m[0];
      const core = p.replace(/^ /, "");
      if (/^[A-Za-z]+$/.test(core)) letters += letterPieceTokens(p);
      else if (/^\s+$/.test(p)) {
        // Each run of one repeated character at most 1 + a third of its length (a mix of tabs,
        // spaces and newlines tokenizes far worse than a run of one of them).
        for (const r of p.match(/(\s)\1*/g)!) total += /[ \t\n]/.test(r[0]) ? 1 + Math.floor(r.length / 3) : r.length;
      }
      else if (/^[^\sA-Za-z0-9]+[\r\n]*$/.test(core)) total += p.length;
      else total += 1;
    }
    total += Math.ceil(letters);
  };
  for (const m of text.matchAll(BYTE_COUNTED)) {
    rest(text.slice(last, m.index));
    total += Buffer.byteLength(m[0], "utf8");
    last = m.index! + m[0].length;
  }
  rest(text.slice(last));
  // One token of margin per text part: the heuristic letter and whitespace counts can be one
  // token short on a short string (fuzz sweeps found single-token misses only).
  return total ? total + 1 : 0;
}

export function pieceCount(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(PIECE)) n += 1;
  return n;
}

/**
 * Tokens in a piece of generated text, counted the way input is: the larger of bytes/3 and the
 * pre-tokenizer piece count, and at least 1 for non-empty text. Used to meter a stream as it arrives.
 */
export function generatedTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, byteTokens(Buffer.byteLength(text, "utf8")), pieceCount(text));
}

/** Input text tokens: the larger of bytes/3 and floorTokens(), so neither shape under-counts. */
function textTokens(acc: Acc): number {
  return Math.max(byteTokens(acc.bytes), acc.pieces);
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
