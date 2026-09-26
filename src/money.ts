/** USD micros: 1 USD = 1_000_000 micros. */

export function usdToMicros(usd: string | number): number {
  const s = String(usd).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) {
    throw new Error(`Invalid USD amount "${s}". Use a non-negative number with at most 6 decimal places.`);
  }
  const [whole, frac = ""] = s.split(".");
  const micros = Number(whole) * 1_000_000 + Number(frac.padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) {
    throw new Error("USD amount is too large.");
  }
  return micros;
}

export function microsToUsd(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(micros));
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${frac}`;
}

/** Ceiling division that stays inside safe integers for governor-sized token counts. */
export function tokensToMicros(tokens: number, microsPerMillion: number): number {
  const t = Math.floor(tokens);
  const rate = Math.floor(microsPerMillion);
  if (t <= 0 || rate <= 0) return 0;
  if (!Number.isSafeInteger(t) || !Number.isSafeInteger(rate)) {
    throw new Error("Token price calculation exceeded safe integer range.");
  }
  const millions = Math.floor(t / 1_000_000);
  const rem = t % 1_000_000;
  const hi = millions * rate;
  const lo = Math.ceil((rem * rate) / 1_000_000);
  const total = hi + lo;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Token price calculation exceeded safe integer range.");
  }
  return total;
}
