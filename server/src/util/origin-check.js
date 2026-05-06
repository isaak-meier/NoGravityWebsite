/**
 * Defence-in-depth CSRF guard for state-changing requests. With SameSite=None
 * cookies in production, we must verify the request actually originates from
 * our own site before accepting POST/PUT/PATCH/DELETE.
 *
 * @param {string[]} allowedOrigins
 * @returns {(req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void> | void}
 */
export function buildOriginCheckHook(allowedOrigins) {
  const allow = new Set(allowedOrigins.map((o) => o.replace(/\/$/, "")));
  return async function originCheck(req, reply) {
    if (METHOD_SAFE.has(req.method)) return;
    const origin = (req.headers.origin || "").replace(/\/$/, "");
    if (origin && allow.has(origin)) return;
    const referer = req.headers.referer;
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (allow.has(refOrigin)) return;
      } catch {
        /* fall through to reject */
      }
    }
    reply.code(403).send({ error: "forbidden_origin" });
  };
}

const METHOD_SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
