import { generateToken, hashToken } from "../util/tokens.js";

export const SESSION_COOKIE = "ng_session";

/**
 * Create a server-side session row and return the raw cookie value.
 * The DB only ever sees the hash; the raw token is only set on the cookie.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ userId: number, ttlSeconds: number, ip?: string|null, userAgent?: string|null }} args
 * @returns {string} raw session token (place this in a cookie)
 */
export function createSession(db, { userId, ttlSeconds, ip, userAgent }) {
  const { raw, hash } = generateToken();
  db.prepare(
    `INSERT INTO user_sessions(user_id, token_hash, expires_at, user_agent, ip)
     VALUES (?, ?, datetime('now', ?), ?, ?)`,
  ).run(userId, hash, `+${ttlSeconds} seconds`, userAgent || null, ip || null);
  return raw;
}

/**
 * Look up a session + its user from a raw cookie value. Returns null if the
 * token is unknown, expired, or the user disappeared.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string|null|undefined} rawToken
 * @returns {object|null}
 */
export function findUserBySessionToken(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(
      `SELECT s.id AS session_id, u.*
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(tokenHash);
  if (!row) return null;
  db.prepare(
    "UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?",
  ).run(row.session_id);
  const { session_id: _ignore, ...user } = row;
  return user;
}

/**
 * Delete a session by its raw cookie value. Idempotent.
 * @param {import("better-sqlite3").Database} db
 * @param {string|null|undefined} rawToken
 */
export function revokeSession(db, rawToken) {
  if (!rawToken) return;
  db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(
    hashToken(rawToken),
  );
}

/**
 * Cookie attributes for the session cookie. In prod we use SameSite=None +
 * Secure + Domain=.<apex> so api.<apex> and <apex> share the cookie. In dev
 * we use SameSite=Lax with no Secure (so http://localhost works).
 *
 * @param {object} appConfig
 * @returns {object}
 */
export function sessionCookieOptions(appConfig) {
  const base = {
    path: "/",
    httpOnly: true,
    maxAge: appConfig.auth.sessionTtlSeconds,
  };
  if (appConfig.isProd) {
    return {
      ...base,
      secure: true,
      sameSite: "none",
      domain: cookieDomainFromUrl(appConfig.publicBaseUrl),
    };
  }
  return { ...base, secure: false, sameSite: "lax" };
}

/**
 * Derive a cross-subdomain cookie domain from a URL like
 * `https://api.nxgrxvity.com` -> `.nxgrxvity.com`. Falls back to undefined
 * (host-only cookie) if we can't safely strip a subdomain.
 *
 * @param {string} url
 * @returns {string|undefined}
 */
function cookieDomainFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    const parts = hostname.split(".");
    if (parts.length < 2) return undefined;
    return "." + parts.slice(-2).join(".");
  } catch {
    return undefined;
  }
}
