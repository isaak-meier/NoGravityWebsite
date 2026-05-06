import {
  createPendingSubscriber,
  findSubscriberByConfirmToken,
  findSubscriberByEmail,
  findSubscriberByUnsubscribeToken,
  markConfirmed,
  markUnsubscribed,
  reactivateAsPending,
  rotateConfirmToken,
} from "./subscribers-repo.js";
import { isValidEmail } from "../util/email.js";
import { renderHtmlPage } from "../util/html-page.js";
import { normalizeEmail } from "../users/users.js";

/**
 * Public mailing-list flow:
 *   POST /api/subscribe         { email, hp? }     -> { ok: true }
 *   GET  /api/confirm?token=... -> 200 HTML page
 *   GET  /api/unsubscribe?token=... -> 200 HTML page
 *
 * Always returns 200 from /subscribe (don't leak whether the address exists).
 * `hp` is a honeypot field; if filled we silently no-op.
 */
export async function registerMailingRoutes(app) {
  app.post(
    "/api/subscribe",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string", maxLength: 320 },
            hp: { type: "string", maxLength: 200 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      await handleSubscribe(app, req);
      reply.send({ ok: true });
    },
  );

  app.get("/api/confirm", async (req, reply) => {
    const token = typeof req.query?.token === "string" ? req.query.token : "";
    handleConfirm(app, token, reply);
  });

  app.get("/api/unsubscribe", async (req, reply) => {
    const token = typeof req.query?.token === "string" ? req.query.token : "";
    handleUnsubscribe(app, token, reply);
  });
}

async function handleSubscribe(app, req) {
  if (req.body.hp) return;
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) return;
  const existing = findSubscriberByEmail(app.db, email);
  const ip = req.ip;
  const userAgent = req.headers["user-agent"] || null;

  if (!existing) {
    const created = createPendingSubscriber(app.db, { email, ip, userAgent });
    await sendConfirmEmail(app, email, created.confirmRaw);
    return;
  }
  if (existing.status === "confirmed") return;
  if (existing.status === "unsubscribed") {
    const fresh = reactivateAsPending(app.db, existing.id);
    await sendConfirmEmail(app, email, fresh.confirmRaw);
    return;
  }
  const newConfirm = rotateConfirmToken(app.db, existing.id);
  await sendConfirmEmail(app, email, newConfirm);
}

async function sendConfirmEmail(app, email, rawToken) {
  const cfg = app.appConfig;
  const url = new URL("/api/confirm", cfg.publicBaseUrl);
  url.searchParams.set("token", rawToken);
  const link = url.toString();
  await app.mail.send({
    to: email,
    subject: "Confirm your subscription to nxgrxvity.com",
    text: `Confirm your subscription by visiting:\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>Confirm your subscription by visiting:</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, ignore this email.</p>`,
  });
}

function handleConfirm(app, rawToken, reply) {
  const sub = findSubscriberByConfirmToken(app.db, rawToken);
  if (!sub) {
    reply.code(400).type("text/html").send(
      renderHtmlPage(
        "Confirmation link expired",
        "This confirmation link is invalid or has already been used.",
        { ctaUrl: app.appConfig.siteUrl, ctaLabel: "Back to nxgrxvity.com" },
      ),
    );
    return;
  }
  if (sub.status === "pending") markConfirmed(app.db, sub.id);
  reply.code(200).type("text/html").send(
    renderHtmlPage(
      "You're in",
      "Thanks for confirming. We'll only email you when there's something worth saying.",
      { ctaUrl: app.appConfig.siteUrl, ctaLabel: "Back to nxgrxvity.com" },
    ),
  );
}

function handleUnsubscribe(app, rawToken, reply) {
  const sub = findSubscriberByUnsubscribeToken(app.db, rawToken);
  if (!sub) {
    reply.code(400).type("text/html").send(
      renderHtmlPage(
        "Unsubscribe link invalid",
        "This unsubscribe link doesn't match any subscriber.",
        { ctaUrl: app.appConfig.siteUrl, ctaLabel: "Back to nxgrxvity.com" },
      ),
    );
    return;
  }
  if (sub.status !== "unsubscribed") markUnsubscribed(app.db, sub.id);
  reply.code(200).type("text/html").send(
    renderHtmlPage(
      "You're unsubscribed",
      "You won't receive any more newsletter emails from us.",
      { ctaUrl: app.appConfig.siteUrl, ctaLabel: "Back to nxgrxvity.com" },
    ),
  );
}
