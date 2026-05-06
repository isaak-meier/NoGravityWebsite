import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp } from "./helpers.js";

let currentApp = null;

afterEach(async () => {
  if (currentApp) {
    await currentApp.close();
    currentApp = null;
  }
});

describe("server smoke", () => {
  it("returns ok from /healthz", async () => {
    const { app } = await buildTestApp();
    currentApp = app;
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("runs migrations on boot (all v1 tables exist)", async () => {
    const { app, db } = await buildTestApp();
    currentApp = app;
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    for (const expected of [
      "campaign_sends",
      "campaigns",
      "magic_login_tokens",
      "schema_migrations",
      "subscribers",
      "user_sessions",
      "user_state_documents",
      "users",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("mailer in test mode is noop and exposes captured sends", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    await mail.send({ to: "x@example.com", subject: "hi", text: "hello" });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("x@example.com");
  });
});
