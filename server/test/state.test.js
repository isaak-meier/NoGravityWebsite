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

async function signIn(app, mail, email) {
  await app.inject({
    method: "POST",
    url: "/api/auth/request-link",
    headers: { "content-type": "application/json", origin: SITE_ORIGIN },
    payload: JSON.stringify({ email }),
  });
  const token = mail.sent.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
  const verify = await app.inject({
    method: "GET",
    url: `/api/auth/verify?token=${token}`,
  });
  const setCookie = verify.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.find((c) => c && c.startsWith(`${SESSION_COOKIE}=`)).split(";")[0];
}

describe("user state", () => {
  it("requires auth", async () => {
    const { app } = await buildTestApp();
    currentApp = app;
    const get = await app.inject({ method: "GET", url: "/api/me/state" });
    expect(get.statusCode).toBe(401);
    const put = await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN },
      payload: JSON.stringify({ x: 1 }),
    });
    expect(put.statusCode).toBe(401);
  });

  it("GET returns empty state on first read", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const cookie = await signIn(app, mail, "alice@example.com");
    const res = await app.inject({
      method: "GET",
      url: "/api/me/state",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: {}, updated_at: null });
  });

  it("PUT then GET round-trips arbitrary JSON", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const cookie = await signIn(app, mail, "bob@example.com");
    const payload = { dials: { bloom: 0.7, fog: 0.2 }, lastTrack: "abc" };
    const put = await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify(payload),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().ok).toBe(true);

    const get = await app.inject({
      method: "GET",
      url: "/api/me/state",
      headers: { cookie },
    });
    expect(get.json().data).toEqual(payload);
    expect(get.json().updated_at).toBeTruthy();
  });

  it("PUT replaces (not merges) prior state", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const cookie = await signIn(app, mail, "carol@example.com");
    await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ a: 1, b: 2 }),
    });
    await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ c: 3 }),
    });
    const get = await app.inject({
      method: "GET",
      url: "/api/me/state",
      headers: { cookie },
    });
    expect(get.json().data).toEqual({ c: 3 });
  });

  it("rejects non-object bodies (arrays, strings, null)", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const cookie = await signIn(app, mail, "dave@example.com");
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify([1, 2, 3]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces 64KB body limit", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const cookie = await signIn(app, mail, "erin@example.com");
    const huge = { blob: "x".repeat(70 * 1024) };
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify(huge),
    });
    expect(res.statusCode).toBe(413);
  });

  it("two users have isolated state", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const aCookie = await signIn(app, mail, "a@example.com");
    const bCookie = await signIn(app, mail, "b@example.com");
    await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie: aCookie },
      payload: JSON.stringify({ owner: "a" }),
    });
    await app.inject({
      method: "PUT",
      url: "/api/me/state",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie: bCookie },
      payload: JSON.stringify({ owner: "b" }),
    });
    const aGet = await app.inject({ method: "GET", url: "/api/me/state", headers: { cookie: aCookie } });
    const bGet = await app.inject({ method: "GET", url: "/api/me/state", headers: { cookie: bCookie } });
    expect(aGet.json().data).toEqual({ owner: "a" });
    expect(bGet.json().data).toEqual({ owner: "b" });
  });
});
