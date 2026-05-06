import {
  getCampaign,
  markCampaignSending,
  markCampaignSent,
  recordCampaignSend,
} from "./campaigns-repo.js";
import { generateToken } from "../util/tokens.js";

/**
 * Synchronously deliver a campaign to every confirmed subscriber, recording
 * one campaign_sends row per recipient. Per-recipient errors are logged but
 * do not abort the loop; the caller decides whether to retry the failed rows.
 *
 * Routes call this inside a fire-and-forget so the HTTP request returns 202
 * immediately. Tests await it directly.
 *
 * @param {import("fastify").FastifyInstance} app
 * @param {number} campaignId
 * @returns {Promise<{ ok: number, error: number }>}
 */
export async function runCampaignSend(app, campaignId) {
  const campaign = getCampaign(app.db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (campaign.status === "sent") return { ok: 0, error: 0 };
  markCampaignSending(app.db, campaignId);
  const recipients = listConfirmedRecipients(app.db);
  const counts = { ok: 0, error: 0 };
  for (const recipient of recipients) {
    await sendOneRecipient(app, campaign, recipient, counts);
  }
  markCampaignSent(app.db, campaignId);
  return counts;
}

async function sendOneRecipient(app, campaign, recipient, counts) {
  try {
    const unsubUrl = mintUnsubscribeUrl(app, recipient.id);
    await app.mail.send({
      to: recipient.email,
      subject: campaign.subject,
      html: appendHtmlFooter(campaign.html_body, unsubUrl),
      text: appendTextFooter(campaign.text_body, unsubUrl),
    });
    recordCampaignSend(app.db, {
      campaignId: campaign.id,
      subscriberId: recipient.id,
      status: "ok",
    });
    counts.ok += 1;
  } catch (err) {
    app.log.warn(
      { err, campaignId: campaign.id, subscriberId: recipient.id },
      "campaign send error",
    );
    recordCampaignSend(app.db, {
      campaignId: campaign.id,
      subscriberId: recipient.id,
      status: "error",
      errorMessage: err?.message || String(err),
    });
    counts.error += 1;
  }
}

function listConfirmedRecipients(db) {
  return db
    .prepare(
      `SELECT id, email FROM subscribers WHERE status = 'confirmed' ORDER BY id ASC`,
    )
    .all();
}

/**
 * We only persist the *hash* of the unsubscribe token, so we can't reproduce
 * the raw value at send time. We mint a fresh raw+hash pair per send and
 * persist the new hash, replacing the previous one. That means only the most
 * recent campaign's unsubscribe link is valid — acceptable for v1; documented
 * in the plan.
 */
function mintUnsubscribeUrl(app, subscriberId) {
  const { raw, hash } = generateToken();
  app.db.prepare(
    "UPDATE subscribers SET unsubscribe_token_hash = ? WHERE id = ?",
  ).run(hash, subscriberId);
  const url = new URL("/api/unsubscribe", app.appConfig.publicBaseUrl);
  url.searchParams.set("token", raw);
  return url.toString();
}

function appendHtmlFooter(html, unsubUrl) {
  const footer = `<hr><p style="color:#888;font-size:.85em">You're receiving this because you signed up at nxgrxvity.com. <a href="${unsubUrl}">Unsubscribe</a>.</p>`;
  return (html || "") + footer;
}

function appendTextFooter(text, unsubUrl) {
  return (text || "") + `\n\n--\nYou're receiving this because you signed up at nxgrxvity.com.\nUnsubscribe: ${unsubUrl}\n`;
}
