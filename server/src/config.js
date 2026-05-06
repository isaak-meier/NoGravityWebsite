/**
 * Read environment variables once and freeze them. Falls back to safe dev defaults
 * so `npm run dev` works with no .env at all (mail goes to stdout, DB stays in-memory).
 */

function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(urlStr) {
  return String(urlStr).trim().replace(/\/$/, "");
}

/**
 * Adds apex ↔ `www` variants so POST /api/subscribe works when the static site is opened
 * at either hostname (browser Origin must match CORS + CSRF origin hook).
 * Skips IPs and plain `localhost`.
 *
 * @param {string} origin
 * @returns {string[]}
 */
function expandOriginVariants(origin) {
  const base = normalizeOrigin(origin);
  if (!base) return [];
  const out = new Set([base]);
  try {
    const u = new URL(base);
    const h = u.hostname;
    if (
      h === "localhost" ||
      /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
      h.startsWith("[") ||
      h.endsWith(".localhost")
    ) {
      return [...out];
    }
    const ps = u.port ? `:${u.port}` : "";
    if (h.startsWith("www.")) {
      out.add(normalizeOrigin(`${u.protocol}//${h.slice(4)}${ps}`));
    } else {
      out.add(normalizeOrigin(`${u.protocol}//www.${h}${ps}`));
    }
  } catch {
    /* keep base only */
  }
  return [...out];
}

/**
 * @param {string} siteUrl
 * @param {string} publicBaseUrl
 * @param {string[]} corsFromEnv
 */
function mergeBrowserOriginAllowlist(siteUrl, publicBaseUrl, corsFromEnv) {
  const set = new Set();
  for (const o of expandOriginVariants(siteUrl)) set.add(o);
  for (const o of expandOriginVariants(publicBaseUrl)) set.add(o);
  for (const raw of corsFromEnv) {
    for (const o of expandOriginVariants(raw)) set.add(o);
  }
  return Object.freeze([...set]);
}

function buildConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";
  const port = Number(env.PORT) || 8787;
  const host = env.HOST || "127.0.0.1";
  const publicBaseUrl = env.PUBLIC_BASE_URL || `http://${host}:${port}`;
  const siteUrl = env.SITE_URL || "http://localhost:3000";
  const dbPath = env.DB_PATH || (isProd ? "/data/mail.db" : ":memory:");
  const mailTransport = (env.MAIL_TRANSPORT || "noop").toLowerCase();
  let corsFromEnv = parseList(env.CORS_ORIGINS);
  if (corsFromEnv.length === 0) {
    corsFromEnv = ["http://localhost:3000", "http://127.0.0.1:3000"];
  }
  const corsOrigins = mergeBrowserOriginAllowlist(siteUrl, publicBaseUrl, corsFromEnv);
  return Object.freeze({
    nodeEnv,
    isProd,
    port,
    host,
    publicBaseUrl,
    siteUrl,
    db: { path: dbPath },
    mail: {
      transport: mailTransport,
      resendApiKey: env.RESEND_API_KEY || null,
      from: env.MAIL_FROM || "No Gravity <hello@example.com>",
    },
    auth: {
      sessionSecret: env.SESSION_SECRET || "dev-only-insecure-secret",
      magicLinkTtlSeconds: 60 * 15,
      sessionTtlSeconds: 60 * 60 * 24 * 30,
    },
    cors: { origins: corsOrigins },
    admin: { initialEmail: env.INITIAL_ADMIN_EMAIL || null },
  });
}

export const config = buildConfig();
export { buildConfig };
