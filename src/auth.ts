import { createHash, timingSafeEqual } from "node:crypto";

export type HeaderMap = Record<string, string | string[] | undefined>;

export function authenticate(
  headers: HeaderMap,
  expectedKey: string | readonly string[],
): { ok: true } | { ok: false; message: string } {
  const dedicated = single(headers["x-burnbrake-key"]);
  const authorization = single(headers.authorization);
  let presented: string | null = null;
  if (dedicated) {
    presented = dedicated.trim();
  } else if (authorization) {
    const match = authorization.match(/^Bearer\s+(\S+)\s*$/i);
    if (!match) {
      return { ok: false, message: "Authorization must be Bearer with the BurnBrake key (bb_…)." };
    }
    presented = match[1];
    if (!presented.startsWith("bb_")) {
      return {
        ok: false,
        message: "Bearer auth must use the BurnBrake key (bb_…). Never send the provider API key.",
      };
    }
  }
  if (!presented) {
    return {
      ok: false,
      message: "Missing X-BurnBrake-Key (or Authorization: Bearer bb_…). Unauthenticated callers are rejected.",
    };
  }
  if (presented.startsWith("sk-")) {
    return { ok: false, message: "Refusing a provider API key as the BurnBrake secret." };
  }
  if (!safeEqualAny(presented, expectedKey)) {
    return { ok: false, message: "BurnBrake key rejected." };
  }
  return { ok: true };
}

/** SHA-256 both sides so a length mismatch does not return before the compare. */
export function safeEqual(a: string, b: string): boolean {
  return safeEqualAny(a, [b]);
}

export function safeEqualAny(presented: string, expected: string | readonly string[]): boolean {
  const keys = (typeof expected === "string" ? [expected] : expected).filter((key) => key.length > 0);
  if (keys.length === 0) return false;
  const left = createHash("sha256").update(presented, "utf8").digest();
  let matched = 0;
  for (const key of keys) {
    const right = createHash("sha256").update(key, "utf8").digest();
    if (timingSafeEqual(left, right)) matched = 1;
  }
  return matched === 1;
}

function single(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
