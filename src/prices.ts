import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { STALE_PRICE_DAYS } from "./constants.js";

export interface ModelPrice {
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  allowZeroPrice: boolean;
}

export interface SurchargePolicy {
  visionPerImageInputTokens: number;
  visionPerImageMicros: number;
  toolsExtraOutputTokens: number;
  toolsFlatMicros: number;
  knownContentTypes: Set<string>;
}

export interface PriceTable {
  version: string;
  pricedAt: string;
  pricedAtMs: number;
  models: Record<string, ModelPrice>;
  surcharges: SurchargePolicy;
  sourcePath: string;
}

export function loadPriceTable(path: string): PriceTable {
  const raw = readFileSync(path, "utf8");
  const doc = parse(raw) as unknown;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`Price table ${path} must be a YAML mapping.`);
  }
  const root = doc as Record<string, unknown>;
  const version = requireString(root.version, "version");
  const pricedAt = requireString(root.priced_at, "priced_at");
  const pricedAtMs = Date.parse(pricedAt);
  if (Number.isNaN(pricedAtMs)) {
    throw new Error(`Price table priced_at is not a parseable UTC timestamp: ${pricedAt}`);
  }
  const modelsRaw = root.models;
  if (!modelsRaw || typeof modelsRaw !== "object" || Array.isArray(modelsRaw)) {
    throw new Error("Price table models must be a mapping of model id → rates.");
  }
  const models: Record<string, ModelPrice> = {};
  for (const [name, value] of Object.entries(modelsRaw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Model ${name} must be a mapping.`);
    }
    const row = value as Record<string, unknown>;
    const input = requireNonNegInt(row.input_micros_per_million, `${name}.input_micros_per_million`);
    const output = requireNonNegInt(row.output_micros_per_million, `${name}.output_micros_per_million`);
    const allowZeroPrice = row.allow_zero_price === true;
    if (input === 0 && output === 0 && !allowZeroPrice) {
      throw new Error(
        `Model ${name} has zero rates without allow_zero_price: true. Refusing silent $0.`,
      );
    }
    models[name] = {
      inputMicrosPerMillion: input,
      outputMicrosPerMillion: output,
      allowZeroPrice,
    };
  }
  if (Object.keys(models).length === 0) {
    throw new Error("Price table has no models.");
  }
  const sur = root.surcharges;
  if (!sur || typeof sur !== "object" || Array.isArray(sur)) {
    throw new Error("Price table surcharges mapping is required (vision + tools).");
  }
  const s = sur as Record<string, unknown>;
  const vision = requireMapping(s.vision, "surcharges.vision");
  const tools = requireMapping(s.tools, "surcharges.tools");
  const known = root.known_content_types;
  if (!Array.isArray(known) || known.length === 0 || known.some((k) => typeof k !== "string")) {
    throw new Error("known_content_types must be a non-empty string list.");
  }
  return {
    version,
    pricedAt,
    pricedAtMs,
    models,
    surcharges: {
      visionPerImageInputTokens: requireNonNegInt(vision.per_image_input_tokens, "vision.per_image_input_tokens"),
      visionPerImageMicros: requireNonNegInt(vision.per_image_micros, "vision.per_image_micros"),
      toolsExtraOutputTokens: requireNonNegInt(tools.extra_output_tokens, "tools.extra_output_tokens"),
      toolsFlatMicros: requireNonNegInt(tools.flat_micros, "tools.flat_micros"),
      knownContentTypes: new Set(known as string[]),
    },
    sourcePath: path,
  };
}

export function priceTableFreshness(table: PriceTable, nowMs: number, staleDays = STALE_PRICE_DAYS): {
  stale: boolean;
  ageDays: number;
  staleWarnDays: number;
} {
  const ageMs = Math.max(0, nowMs - table.pricedAtMs);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return {
    stale: ageDays > staleDays,
    ageDays,
    staleWarnDays: staleDays,
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Price table field ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireMapping(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Price table field ${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function requireNonNegInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Price table field ${label} must be a non-negative integer.`);
  }
  return value;
}
