import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "bbenc1:";

export function deriveReplayKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealReplayBody(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Plaintext rows (no prefix) pass through so an existing ledger still replays. */
export function openReplayBody(stored: string, key: Buffer | null): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  if (!key) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
