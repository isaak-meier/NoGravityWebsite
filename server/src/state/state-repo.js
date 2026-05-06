/**
 * Read the user's auto-synced "current" state document. Returns an empty
 * object when no row exists yet (first GET for a user).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} userId
 * @returns {{ data: object, updated_at: string|null }}
 */
export function getCurrentState(db, userId) {
  const row = db
    .prepare(
      `SELECT data, updated_at FROM user_state_documents
       WHERE user_id = ? AND kind = 'current' AND name IS NULL`,
    )
    .get(userId);
  if (!row) return { data: {}, updated_at: null };
  let parsed;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    parsed = {};
  }
  return { data: parsed, updated_at: row.updated_at };
}

/**
 * Replace (or create) the user's auto-synced "current" state document.
 * `data` must be JSON-serializable; this function stringifies it.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {number} userId
 * @param {object} data
 * @returns {{ updated_at: string }}
 */
export function upsertCurrentState(db, userId, data) {
  const json = JSON.stringify(data);
  db.prepare(
    `INSERT INTO user_state_documents(user_id, kind, name, data)
     VALUES (?, 'current', NULL, ?)
     ON CONFLICT(user_id, kind, IFNULL(name, ''))
     DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
  ).run(userId, json);
  const row = db
    .prepare(
      `SELECT updated_at FROM user_state_documents
       WHERE user_id = ? AND kind = 'current' AND name IS NULL`,
    )
    .get(userId);
  return { updated_at: row.updated_at };
}
