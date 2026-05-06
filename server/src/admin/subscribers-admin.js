/**
 * Admin queries over the subscribers table. Pagination is offset-based (fine
 * at this scale; cursor pagination is overkill for one admin viewing thousands
 * of rows).
 */

const ALLOWED_STATUSES = new Set(["pending", "confirmed", "unsubscribed"]);
const PUBLIC_COLUMNS = [
  "id",
  "email",
  "status",
  "created_at",
  "confirmed_at",
  "unsubscribed_at",
];

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ status?: string|null, q?: string|null, page?: number, pageSize?: number }} args
 * @returns {{ items: object[], page: number, page_size: number, total: number }}
 */
export function listSubscribers(db, args) {
  const { sql, params } = buildWhere(args);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM subscribers ${sql}`)
    .get(...params);
  const page = clampInt(args.page, 1, 100000, 1);
  const pageSize = clampInt(args.pageSize, 1, 200, 50);
  const offset = (page - 1) * pageSize;
  const items = db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS.join(", ")} FROM subscribers ${sql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);
  return { items, page, page_size: pageSize, total: totalRow.n };
}

/**
 * Stream-ish CSV builder (returns the whole string; fine at this scale).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ status?: string|null, q?: string|null }} filters
 * @returns {{ rows: object[], columns: string[] }}
 */
export function exportSubscribers(db, filters) {
  const { sql, params } = buildWhere(filters);
  const rows = db
    .prepare(
      `SELECT ${PUBLIC_COLUMNS.join(", ")} FROM subscribers ${sql} ORDER BY id ASC`,
    )
    .all(...params);
  return { rows, columns: PUBLIC_COLUMNS };
}

/**
 * Hard-delete (GDPR). Idempotent.
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @returns {boolean} true if a row was deleted
 */
export function deleteSubscriber(db, id) {
  const info = db.prepare("DELETE FROM subscribers WHERE id = ?").run(id);
  return info.changes > 0;
}

function buildWhere({ status, q }) {
  const clauses = [];
  const params = [];
  if (status && ALLOWED_STATUSES.has(status)) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (q) {
    clauses.push("email LIKE ?");
    params.push(`%${q}%`);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
