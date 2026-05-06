import fp from "fastify-plugin";
import { SESSION_COOKIE, findUserBySessionToken } from "./session.js";

/**
 * Adds:
 *  - `request.user` decorated to null on every request, populated if the
 *    cookie resolves to a live session.
 *  - `app.requireAuth` preHandler that 401s if `request.user` is missing.
 *  - `app.requireAdmin` preHandler that 403s if `request.user.is_admin !== 1`.
 */
async function authPlugin(app) {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (req) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) return;
    req.user = findUserBySessionToken(app.db, raw) || null;
  });

  app.decorate("requireAuth", async function requireAuth(req, reply) {
    if (!req.user) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate("requireAdmin", async function requireAdmin(req, reply) {
    if (!req.user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (req.user.is_admin !== 1) {
      reply.code(403).send({ error: "forbidden" });
    }
  });
}

export default fp(authPlugin, { name: "auth-plugin" });
