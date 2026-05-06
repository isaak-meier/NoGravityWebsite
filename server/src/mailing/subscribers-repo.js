import { generateToken, hashToken } from "../util/tokens.js";
import { normalizeEmail } from "../users/users.js";

/**
 * @typedef {{ id: number, email: string, status: 'pending'|'confirmed'|'unsubscribed',
 *   confirm_token_hash: string|null, unsubscribe_token_hash: string,
 *   created_at: string, confirmed_at: string|null, unsubscribed_at: string|null,
 *   ip: string|null, user_agent: string|null }} SubscriberRow
 */

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} email
 * @returns {SubscriberRow | undefined}
 */
export function findSubscriberByEmail(db, email) {
  return db
    .prepare("SELECT * FROM subscribers WHERE email = ?")
    .get(normalizeEmail(email));
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} rawToken
 * @returns {SubscriberRow | undefined}
 */
export function findSubscriberByConfirmToken(db, rawToken) {
  if (!rawToken) return undefined;
  return db
    .prepare("SELECT * FROM subscribers WHERE confirm_token_hash = ?")
    .get(hashToken(rawToken));
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} rawToken
 * @returns {SubscriberRow | undefined}
 */
export function findSubscriberByUnsubscribeToken(db, rawToken) {
  if (!rawToken) return undefined;
  return db
    .prepare("SELECT * FROM subscribers WHERE unsubscribe_token_hash = ?")
    .get(hashToken(rawToken));
}

/**
 * Insert a new pending subscriber. Returns the raw confirm + unsubscribe
 * tokens (only emitted in URLs; only their hashes hit the DB).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ email: string, ip?: string|null, userAgent?: string|null }} args
 * @returns {{ subscriberId: number, confirmRaw: string, unsubscribeRaw: string }}
 */
export function createPendingSubscriber(db, { email, ip, userAgent }) {
  const confirm = generateToken();
  const unsub = generateToken();
  const info = db
    .prepare(
      `INSERT INTO subscribers(email, status, confirm_token_hash, unsubscribe_token_hash, ip, user_agent)
       VALUES (?, 'pending', ?, ?, ?, ?)`,
    )
    .run(normalizeEmail(email), confirm.hash, unsub.hash, ip || null, userAgent || null);
  return {
    subscriberId: Number(info.lastInsertRowid),
    confirmRaw: confirm.raw,
    unsubscribeRaw: unsub.raw,
  };
}

/**
 * For an existing pending subscriber, mint a fresh confirm token (e.g. when
 * they re-submit before clicking the first email). Returns the new raw token.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} subscriberId
 * @returns {string} new raw confirm token
 */
export function rotateConfirmToken(db, subscriberId) {
  const t = generateToken();
  db.prepare(
    "UPDATE subscribers SET confirm_token_hash = ? WHERE id = ?",
  ).run(t.hash, subscriberId);
  return t.raw;
}

/**
 * Re-activate an unsubscribed row as pending with brand-new tokens.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} subscriberId
 * @returns {{ confirmRaw: string, unsubscribeRaw: string }}
 */
export function reactivateAsPending(db, subscriberId) {
  const confirm = generateToken();
  const unsub = generateToken();
  db.prepare(
    `UPDATE subscribers
     SET status = 'pending', confirm_token_hash = ?, unsubscribe_token_hash = ?,
         confirmed_at = NULL, unsubscribed_at = NULL
     WHERE id = ?`,
  ).run(confirm.hash, unsub.hash, subscriberId);
  return { confirmRaw: confirm.raw, unsubscribeRaw: unsub.raw };
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} subscriberId
 */
export function markConfirmed(db, subscriberId) {
  db.prepare(
    `UPDATE subscribers
     SET status = 'confirmed', confirmed_at = datetime('now'), confirm_token_hash = NULL
     WHERE id = ?`,
  ).run(subscriberId);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} subscriberId
 */
export function markUnsubscribed(db, subscriberId) {
  db.prepare(
    `UPDATE subscribers
     SET status = 'unsubscribed', unsubscribed_at = datetime('now')
     WHERE id = ?`,
  ).run(subscriberId);
}
