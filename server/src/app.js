import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { openDatabase } from "./db.js";
import { createMailSender } from "./mail.js";
import { buildOriginCheckHook } from "./util/origin-check.js";
import authPlugin from "./auth/middleware.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerStateRoutes } from "./state/routes.js";
import { registerMailingRoutes } from "./mailing/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = resolve(__dirname, "..", "public", "admin");

/**
 * Build a configured Fastify instance. Used by both the production entry point
 * and by tests (tests pass an in-memory DB and a noop mailer).
 *
 * @param {object} config Frozen config from ./config.js (or a test-built one).
 * @param {object} [overrides] Optional overrides for tests: { db, mail }.
 * @returns {Promise<import("fastify").FastifyInstance>}
 */
export async function buildApp(config, overrides = {}) {
  const app = Fastify({
    logger: overrides.logger ?? { level: config.isProd ? "info" : "debug" },
    disableRequestLogging: false,
    trustProxy: true,
  });

  const db = overrides.db || openDatabase(config.db.path);
  const mail = overrides.mail || createMailSender(config.mail, { logger: app.log });

  app.decorate("db", db);
  app.decorate("mail", mail);
  app.decorate("appConfig", config);

  app.addHook("onClose", async () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: config.cors.origins,
    credentials: true,
  });
  await app.register(fastifyRateLimit, {
    global: false,
    max: 100,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", buildOriginCheckHook(config.cors.origins));

  await app.register(authPlugin);
  await registerAuthRoutes(app);
  await registerStateRoutes(app);
  await registerMailingRoutes(app);
  await registerAdminRoutes(app);

  if (existsSync(ADMIN_DIR)) {
    await app.register(fastifyStatic, {
      root: ADMIN_DIR,
      prefix: "/admin/",
      decorateReply: false,
    });
  }

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
