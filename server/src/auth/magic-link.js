import { generateToken, hashToken } from "../util/tokens.js";

/**
 * Issue a fresh magic-link token for `email`. Caller is responsible for
 * actually sending the email to the address. Tokens are single-use and expire
 * after `ttlSeconds`.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ email: string, ttlSeconds: number, nextUrl: string|null }} args
 * @returns {{ raw: string }}
 */
export function issueMagicLink(db, { email, ttlSeconds, nextUrl }) {
  const { raw, hash } = generateToken();
  db.prepare(
    `INSERT INTO magic_login_tokens(email, token_hash, next_url, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`,
  ).run(email, hash, nextUrl || null, `+${ttlSeconds} seconds`);
  return { raw };
}

/**
 * Atomically consume (mark used) a magic-link token if it is fresh, unused,
 * and not expired. Returns the token row on success, or null otherwise.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} rawToken
 * @returns {{ id: number, email: string, next_url: string|null }|null}
 */
export function consumeMagicLink(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, email, next_url FROM magic_login_tokens
         WHERE token_hash = ? AND used_at IS NULL
           AND expires_at > datetime('now')`,
      )
      .get(tokenHash);
    if (!row) return null;
    db.prepare(
      "UPDATE magic_login_tokens SET used_at = datetime('now') WHERE id = ?",
    ).run(row.id);
    return row;
  });
  return tx();
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} email
 * @param {number} cooldownSeconds
 * @returns {boolean} true if a token for this email was issued within the cooldown
 */
export function hasRecentlyIssuedTokenFor(db, email, cooldownSeconds) {
  const row = db
    .prepare(
      `SELECT 1 FROM magic_login_tokens
       WHERE email = ? AND created_at > datetime('now', ?)`,
    )
    .get(email, `-${cooldownSeconds} seconds`);
  return !!row;
}
