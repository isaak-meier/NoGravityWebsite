import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp } from "./helpers.js";
import { SESSION_COOKIE } from "../src/auth/session.js";

let currentApp = null;
afterEach(async () => {
  if (currentApp) {
    await currentApp.close();
    currentApp = null;
  }
});

const SITE_ORIGIN = "http://localhost:3000";

async function adminCookie(app, mail) {
  await app.inject({
    method: "POST",
    url: "/api/auth/request-link",
    headers: { "content-type": "application/json", origin: SITE_ORIGIN },
    payload: JSON.stringify({ email: "boss@nxgrxvity.com" }),
  });
  const token = mail.sent.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
  const verify = await app.inject({
    method: "GET",
    url: `/api/auth/verify?token=${token}`,
  });
  const sc = verify.headers["set-cookie"];
  const arr = Array.isArray(sc) ? sc : [sc];
  return arr.find((c) => c && c.startsWith(`${SESSION_COOKIE}=`)).split(";")[0];
}

describe("admin UI", () => {
  it("serves /admin/index.html as HTML", async () => {
    const { app } = await buildTestApp({ INITIAL_ADMIN_EMAIL: "boss@nxgrxvity.com" });
    currentApp = app;
    const res = await app.inject({ method: "GET", url: "/admin/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.body).toContain("nxgrxvity admin");
    expect(res.body).toContain("admin.js");
  });

  it("serves admin.js and admin.css", async () => {
    const { app } = await buildTestApp({ INITIAL_ADMIN_EMAIL: "boss@nxgrxvity.com" });
    currentApp = app;
    const js = await app.inject({ method: "GET", url: "/admin/admin.js" });
    const css = await app.inject({ method: "GET", url: "/admin/admin.css" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toMatch(/css/);
  });

  it("POST /api/admin/campaigns/:id/test sends to the admin's own email only", async () => {
    const { app, mail } = await buildTestApp({ INITIAL_ADMIN_EMAIL: "boss@nxgrxvity.com" });
    currentApp = app;
    const cookie = await adminCookie(app, mail);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Hello", text_body: "Body" }),
    });
    const id = created.json().id;
    const before = mail.sent.length;
    const res = await app.inject({
      method: "POST",
      url: `/api/admin/campaigns/${id}/test`,
      headers: { cookie, origin: SITE_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent_to).toBe("boss@nxgrxvity.com");
    const after = mail.sent.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0].to).toBe("boss@nxgrxvity.com");
    expect(after[0].subject).toBe("[TEST] Hello");
  });
});
