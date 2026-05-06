import {
  SESSION_COOKIE,
  createSession,
  revokeSession,
  sessionCookieOptions,
} from "./session.js";
import {
  consumeMagicLink,
  hasRecentlyIssuedTokenFor,
  issueMagicLink,
} from "./magic-link.js";
import {
  findOrCreateUserByEmail,
  markUserLoggedIn,
  normalizeEmail,
} from "../users/users.js";
import { isValidEmail } from "../util/email.js";
import { renderHtmlPage } from "../util/html-page.js";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Register the four auth routes:
 *   POST /api/auth/request-link
 *   GET  /api/auth/verify
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 */
export async function registerAuthRoutes(app) {
  app.post("/api/auth/request-link", {
    config: {
      rateLimit: { max: 5, timeWindow: "1 minute" },
    },
    schema: requestLinkSchema(),
  }, async (req, reply) => {
    await handleRequestLink(app, req);
    reply.code(200).send({ ok: true });
  });

  app.get("/api/auth/verify", async (req, reply) => {
    await handleVerify(app, req, reply);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    revokeSession(app.db, req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    reply.send({ user: publicUser(req.user) });
  });
}

function requestLinkSchema() {
  return {
    body: {
      type: "object",
      required: ["email"],
      additionalProperties: false,
      properties: {
        email: { type: "string", maxLength: 320 },
        next: { type: "string", maxLength: 1024 },
      },
    },
  };
}

async function handleRequestLink(app, req) {
  const cfg = app.appConfig;
  const email = normalizeEmail(req.body.email);
  const nextUrl = sanitizeNextUrl(req.body.next, cfg);
  if (!isValidEmail(email)) return;
  if (hasRecentlyIssuedTokenFor(app.db, email, RESEND_COOLDOWN_SECONDS)) {
    return;
  }
  const { raw } = issueMagicLink(app.db, {
    email,
    ttlSeconds: cfg.auth.magicLinkTtlSeconds,
    nextUrl,
  });
  await sendMagicEmail(app, { email, rawToken: raw, nextUrl });
}

async function sendMagicEmail(app, { email, rawToken, nextUrl }) {
  const cfg = app.appConfig;
  const url = new URL("/api/auth/verify", cfg.publicBaseUrl);
  url.searchParams.set("token", rawToken);
  if (nextUrl) url.searchParams.set("next", nextUrl);
  const link = url.toString();
  await app.mail.send({
    to: email,
    subject: "Your sign-in link for nxgrxvity.com",
    text:
      `Click this link within ${Math.round(cfg.auth.magicLinkTtlSeconds / 60)} `
      + `minutes to sign in:\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html:
      `<p>Click this link within ${Math.round(cfg.auth.magicLinkTtlSeconds / 60)} `
      + `minutes to sign in:</p>`
      + `<p><a href="${link}">${link}</a></p>`
      + `<p>If you didn't request this, ignore this email.</p>`,
  });
}

async function handleVerify(app, req, reply) {
  const cfg = app.appConfig;
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  const consumed = consumeMagicLink(app.db, token);
  if (!consumed) {
    reply.code(400).type("text/html").send(
      renderHtmlPage(
        "Sign-in link expired",
        "This sign-in link is invalid or has already been used. Request a new one and try again.",
      ),
    );
    return;
  }
  const user = findOrCreateUserByEmail(app.db, consumed.email, {
    initialAdminEmail: cfg.admin.initialEmail,
  });
  markUserLoggedIn(app.db, user.id);
  const rawSession = createSession(app.db, {
    userId: user.id,
    ttlSeconds: cfg.auth.sessionTtlSeconds,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || null,
  });
  reply.setCookie(SESSION_COOKIE, rawSession, sessionCookieOptions(cfg));
  const redirectTo = sanitizeNextUrl(consumed.next_url, cfg) || cfg.siteUrl;
  reply.redirect(redirectTo);
}

function sanitizeNextUrl(value, cfg) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value, cfg.publicBaseUrl);
    const allowed = new Set(
      [cfg.siteUrl, cfg.publicBaseUrl, ...cfg.cors.origins].map((o) =>
        o.replace(/\/$/, ""),
      ),
    );
    if (allowed.has(url.origin.replace(/\/$/, ""))) return url.toString();
    return null;
  } catch {
    return null;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    is_admin: user.is_admin === 1,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

