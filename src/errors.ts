import type { ScopeName } from "./ledger.js";

export interface ErrorFields {
  code: string;
  message: string;
  httpStatus: number;
  scope?: ScopeName | null;
  remaining_micros?: number;
  requested_micros?: number;
  run_id?: string | null;
  user_id?: string | null;
  halt?: boolean;
  retryable?: boolean;
}

export function errorBody(fields: ErrorFields): { error: Record<string, unknown> } {
  const halt = fields.halt ?? (fields.code === "BUDGET_EXHAUSTED" || fields.code === "SPEND_PAUSED");
  const retryable = fields.retryable ?? false;
  return {
    error: {
      code: fields.code,
      message: fields.message,
      scope: fields.scope ?? null,
      remaining_micros: fields.remaining_micros ?? null,
      requested_micros: fields.requested_micros ?? null,
      run_id: fields.run_id ?? null,
      user_id: fields.user_id ?? null,
      halt,
      retryable,
    },
  };
}

export function httpStatusForEstimate(code: string): number {
  if (code === "UNPRICED_MODEL" || code === "UNKNOWN_SURCHARGE") return 402;
  return 400;
}
