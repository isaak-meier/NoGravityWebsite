import { getCurrentState, upsertCurrentState } from "./state-repo.js";

const STATE_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * GET /api/me/state — returns { data, updated_at } (data = {} if none).
 * PUT /api/me/state — body is the new state object; replaces the doc.
 *
 * Both routes require an authenticated user. PUT is body-size capped to 64KB
 * and per-user write rate limited to 30/min so a runaway client can't hammer
 * the DB.
 */
export async function registerStateRoutes(app) {
  app.get(
    "/api/me/state",
    { preHandler: app.requireAuth },
    async (req) => getCurrentState(app.db, req.user.id),
  );

  app.put(
    "/api/me/state",
    {
      preHandler: app.requireAuth,
      bodyLimit: STATE_BODY_LIMIT_BYTES,
      schema: {
        body: { type: "object", additionalProperties: true },
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req) => `user:${req.user?.id ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const result = upsertCurrentState(app.db, req.user.id, req.body);
      reply.send({ ok: true, updated_at: result.updated_at });
    },
  );
}
