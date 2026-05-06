/**
 * Normalize an email for storage and lookup. We lowercase + trim so a casual
 * "Foo@bar.com  " always lands on the same row. Email column is COLLATE NOCASE
 * for safety either way.
 *
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} email
 * @returns {{ id: number, email: string, display_name: string|null, is_admin: number, created_at: string, last_login_at: string|null } | undefined}
 */
export function findUserByEmail(db, email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email));
}

/**
 * Find or create a user keyed by email. Newly created users matching
 * `initialAdminEmail` are auto-promoted to admin on first sight.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} email
 * @param {{ initialAdminEmail?: string | null }} [opts]
 * @returns {ReturnType<typeof findUserByEmail> & object}
 */
export function findOrCreateUserByEmail(db, email, opts = {}) {
  const normalized = normalizeEmail(email);
  const existing = findUserByEmail(db, normalized);
  if (existing) return existing;
  const isAdmin = opts.initialAdminEmail
    && normalizeEmail(opts.initialAdminEmail) === normalized
    ? 1
    : 0;
  db.prepare("INSERT INTO users(email, is_admin) VALUES (?, ?)").run(
    normalized,
    isAdmin,
  );
  return findUserByEmail(db, normalized);
}

/**
 * Stamp last_login_at on successful magic-link verify.
 * @param {import("better-sqlite3").Database} db
 * @param {number} userId
 */
export function markUserLoggedIn(db, userId) {
  db.prepare(
    "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
  ).run(userId);
}
