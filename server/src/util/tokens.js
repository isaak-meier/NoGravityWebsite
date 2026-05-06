import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Generate a fresh URL-safe secret and the sha-256 hash we'll persist.
 * The raw value never touches the DB; only the hash does.
 *
 * @returns {{ raw: string, hash: string }}
 */
export function generateToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

/**
 * @param {string} raw
 * @returns {string} sha-256 hex of raw
 */
export function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time equality on two hex hashes (defensive — DB lookups already
 * compare hashes, but used at boundaries where strings come from untrusted input).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
