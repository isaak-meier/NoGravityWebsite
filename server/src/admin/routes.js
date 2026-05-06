import {
  deleteSubscriber,
  exportSubscribers,
  listSubscribers,
} from "./subscribers-admin.js";
import {
  createCampaign,
  getCampaign,
  getSendCounts,
  listCampaigns,
  updateCampaign,
} from "./campaigns-repo.js";
import { runCampaignSend } from "./campaign-sender.js";
import { rowsToCsv } from "../util/csv.js";

/**
 * All routes here are gated by app.requireAdmin (which 401s for anonymous and
 * 403s for non-admin authenticated users).
 */
export async function registerAdminRoutes(app) {
  registerSubscriberRoutes(app);
  registerCampaignRoutes(app);
}

function registerSubscriberRoutes(app) {
  app.get(
    "/api/admin/subscribers",
    { preHandler: app.requireAdmin, schema: { querystring: subscribersListSchema() } },
    async (req) => {
      const { status, q, page, page_size } = req.query;
      return listSubscribers(app.db, {
        status: status || null,
        q: q || null,
        page: Number(page) || 1,
        pageSize: Number(page_size) || 50,
      });
    },
  );

  app.get(
    "/api/admin/subscribers.csv",
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const { status, q } = req.query || {};
      const { rows, columns } = exportSubscribers(app.db, {
        status: status || null,
        q: q || null,
      });
      reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="subscribers.csv"')
        .send(rowsToCsv(columns, rows));
    },
  );

  app.delete(
    "/api/admin/subscribers/:id",
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "bad_id" });
        return;
      }
      const ok = deleteSubscriber(app.db, id);
      reply.code(ok ? 200 : 404).send({ ok });
    },
  );
}

function registerCampaignRoutes(app) {
  app.get(
    "/api/admin/campaigns",
    { preHandler: app.requireAdmin },
    async () => ({ items: listCampaigns(app.db) }),
  );

  app.get(
    "/api/admin/campaigns/:id",
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = getCampaign(app.db, id);
      if (!c) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      return { ...c, send_counts: getSendCounts(app.db, id) };
    },
  );

  app.post(
    "/api/admin/campaigns",
    { preHandler: app.requireAdmin, schema: { body: campaignBodySchema(true) } },
    async (req) => createCampaign(app.db, req.body),
  );

  app.put(
    "/api/admin/campaigns/:id",
    { preHandler: app.requireAdmin, schema: { body: campaignBodySchema(false) } },
    async (req, reply) => {
      const id = Number(req.params.id);
      const updated = updateCampaign(app.db, id, req.body);
      if (!updated) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      return updated;
    },
  );

  app.post(
    "/api/admin/campaigns/:id/send",
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = getCampaign(app.db, id);
      if (!c) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      if (c.status !== "draft") {
        reply.code(409).send({ error: "not_draft", status: c.status });
        return;
      }
      void runCampaignSend(app, id).catch((err) => {
        app.log.error({ err, campaignId: id }, "campaign send failed");
      });
      reply.code(202).send({ ok: true, campaign_id: id });
    },
  );

  app.post(
    "/api/admin/campaigns/:id/test",
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = getCampaign(app.db, id);
      if (!c) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      const fakeUnsubUrl = `${app.appConfig.publicBaseUrl}/api/unsubscribe?token=TEST`;
      await app.mail.send({
        to: req.user.email,
        subject: `[TEST] ${c.subject}`,
        html: (c.html_body || "")
          + `<hr><p style="color:#888;font-size:.85em">[Test send] Unsubscribe: <a href="${fakeUnsubUrl}">${fakeUnsubUrl}</a></p>`,
        text: (c.text_body || "")
          + `\n\n--\n[Test send] Unsubscribe: ${fakeUnsubUrl}\n`,
      });
      reply.send({ ok: true, sent_to: req.user.email });
    },
  );
}

function subscribersListSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["pending", "confirmed", "unsubscribed"] },
      q: { type: "string", maxLength: 200 },
      page: { type: "string" },
      page_size: { type: "string" },
    },
  };
}

function campaignBodySchema(requireSubject) {
  return {
    type: "object",
    additionalProperties: false,
    required: requireSubject ? ["subject"] : [],
    properties: {
      subject: { type: "string", minLength: 1, maxLength: 200 },
      html_body: { type: "string", maxLength: 200_000 },
      text_body: { type: "string", maxLength: 200_000 },
    },
  };
}
