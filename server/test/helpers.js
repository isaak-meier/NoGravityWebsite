import { buildApp } from "../src/app.js";
import { buildConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { createMailSender } from "../src/mail.js";

/**
 * Build a fresh, isolated Fastify app for a single test:
 *   - in-memory SQLite (migrations run on open)
 *   - noop mail sender (captures sent messages on `mail.sent`)
 *   - silent logger
 *
 * @param {Partial<Record<string, string>>} [envOverrides]
 * @returns {Promise<{ app: import("fastify").FastifyInstance, db: import("better-sqlite3").Database, mail: ReturnType<typeof createMailSender> }>}
 */
export async function buildTestApp(envOverrides = {}) {
  const env = {
    NODE_ENV: "test",
    DB_PATH: ":memory:",
    MAIL_TRANSPORT: "noop",
    PUBLIC_BASE_URL: "http://localhost:8787",
    SITE_URL: "http://localhost:3000",
    CORS_ORIGINS: "http://localhost:3000",
    SESSION_SECRET: "test-secret",
    ...envOverrides,
  };
  const config = buildConfig(env);
  const db = openDatabase(":memory:");
  const mail = createMailSender(config.mail, { logger: silentLogger() });
  const app = await buildApp(config, { db, mail, logger: false });
  return { app, db, mail };
}

function silentLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}
