/**
 * @typedef {{ id: number, subject: string, html_body: string, text_body: string,
 *   status: 'draft'|'sending'|'sent', created_at: string, sent_at: string|null }} CampaignRow
 */

/**
 * @param {import("better-sqlite3").Database} db
 * @returns {CampaignRow[]}
 */
export function listCampaigns(db) {
  return db
    .prepare(
      `SELECT id, subject, status, created_at, sent_at FROM campaigns
       ORDER BY id DESC`,
    )
    .all();
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @returns {CampaignRow | undefined}
 */
export function getCampaign(db, id) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ subject: string, html_body: string, text_body: string }} args
 * @returns {CampaignRow}
 */
export function createCampaign(db, { subject, html_body, text_body }) {
  const info = db
    .prepare(
      `INSERT INTO campaigns(subject, html_body, text_body)
       VALUES (?, ?, ?)`,
    )
    .run(subject, html_body || "", text_body || "");
  return getCampaign(db, Number(info.lastInsertRowid));
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 * @param {{ subject?: string, html_body?: string, text_body?: string }} patch
 * @returns {CampaignRow | undefined}
 */
export function updateCampaign(db, id, patch) {
  const cur = getCampaign(db, id);
  if (!cur) return undefined;
  if (cur.status !== "draft") return cur;
  db.prepare(
    `UPDATE campaigns SET subject = ?, html_body = ?, text_body = ?
     WHERE id = ?`,
  ).run(
    patch.subject ?? cur.subject,
    patch.html_body ?? cur.html_body,
    patch.text_body ?? cur.text_body,
    id,
  );
  return getCampaign(db, id);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 */
export function markCampaignSending(db, id) {
  db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(id);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} id
 */
export function markCampaignSent(db, id) {
  db.prepare(
    "UPDATE campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?",
  ).run(id);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} campaignId
 * @returns {{ ok: number, error: number }}
 */
export function getSendCounts(db, campaignId) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM campaign_sends
       WHERE campaign_id = ? GROUP BY status`,
    )
    .all(campaignId);
  const out = { ok: 0, error: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/**
 * Record one send attempt. Idempotent on (campaign_id, subscriber_id).
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ campaignId: number, subscriberId: number, status: 'ok'|'error', errorMessage?: string|null }} args
 */
export function recordCampaignSend(db, { campaignId, subscriberId, status, errorMessage }) {
  db.prepare(
    `INSERT INTO campaign_sends(campaign_id, subscriber_id, status, error_message)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(campaign_id, subscriber_id) DO UPDATE SET
       status = excluded.status,
       error_message = excluded.error_message,
       sent_at = datetime('now')`,
  ).run(campaignId, subscriberId, status, errorMessage || null);
}
