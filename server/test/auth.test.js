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

async function requestLink(app, email, next = null) {
  const body = next ? { email, next } : { email };
  return app.inject({
    method: "POST",
    url: "/api/auth/request-link",
    headers: { "content-type": "application/json", origin: SITE_ORIGIN },
    payload: JSON.stringify(body),
  });
}

function extractTokenFromMail(mail) {
  const last = mail.sent.at(-1);
  expect(last).toBeTruthy();
  const m = last.text.match(/token=([A-Za-z0-9_-]+)/);
  expect(m).toBeTruthy();
  return m[1];
}

function getSessionCookie(res) {
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const sess = cookies.find((c) => c && c.startsWith(`${SESSION_COOKIE}=`));
  if (!sess) return null;
  return sess.split(";")[0];
}

describe("magic-link auth", () => {
  it("request-link issues a token and queues an email", async () => {
    const { app, mail, db } = await buildTestApp();
    currentApp = app;
    const res = await requestLink(app, "alice@example.com");
    expect(res.statusCode).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("alice@example.com");
    const tokens = db.prepare("SELECT * FROM magic_login_tokens").all();
    expect(tokens).toHaveLength(1);
  });

  it("request-link is silent on invalid email shape (no DB row, no email)", async () => {
    const { app, mail, db } = await buildTestApp();
    currentApp = app;
    const res = await requestLink(app, "not-an-email");
    expect(res.statusCode).toBe(200);
    expect(mail.sent).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM magic_login_tokens").get().n).toBe(0);
  });

  it("request-link de-dupes within cooldown (no second email)", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    await requestLink(app, "bob@example.com");
    await requestLink(app, "bob@example.com");
    expect(mail.sent).toHaveLength(1);
  });

  it("verify with a valid token sets a session cookie and redirects", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    await requestLink(app, "carol@example.com");
    const token = extractTokenFromMail(mail);
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    expect(res.statusCode).toBe(302);
    expect(getSessionCookie(res)).toBeTruthy();
    expect(res.headers.location).toBe(SITE_ORIGIN);
  });

  it("verify with an unknown / forged token returns 400", async () => {
    const { app } = await buildTestApp();
    currentApp = app;
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/verify?token=totally-bogus",
    });
    expect(res.statusCode).toBe(400);
  });

  it("verify is single-use (replay returns 400)", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    await requestLink(app, "dave@example.com");
    const token = extractTokenFromMail(mail);
    const first = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    expect(first.statusCode).toBe(302);
    const replay = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    expect(replay.statusCode).toBe(400);
  });

  it("/api/auth/me returns 401 without cookie, then user with cookie", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    const unauth = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(unauth.statusCode).toBe(401);

    await requestLink(app, "erin@example.com");
    const token = extractTokenFromMail(mail);
    const verifyRes = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    const cookie = getSessionCookie(verifyRes);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.email).toBe("erin@example.com");
    expect(meRes.json().user.is_admin).toBe(false);
  });

  it("logout invalidates the session cookie", async () => {
    const { app, mail } = await buildTestApp();
    currentApp = app;
    await requestLink(app, "frank@example.com");
    const token = extractTokenFromMail(mail);
    const verify = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    const cookie = getSessionCookie(verify);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, origin: SITE_ORIGIN },
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it("first sign-in for INITIAL_ADMIN_EMAIL auto-promotes to admin", async () => {
    const { app, mail } = await buildTestApp({ INITIAL_ADMIN_EMAIL: "boss@nxgrxvity.com" });
    currentApp = app;
    await requestLink(app, "boss@nxgrxvity.com");
    const token = extractTokenFromMail(mail);
    const verify = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    const cookie = getSessionCookie(verify);
    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(me.json().user.is_admin).toBe(true);
  });

  it("expired token returns 400", async () => {
    const { app, mail, db } = await buildTestApp();
    currentApp = app;
    await requestLink(app, "gina@example.com");
    const token = extractTokenFromMail(mail);
    db.prepare(
      "UPDATE magic_login_tokens SET expires_at = datetime('now', '-1 minute')",
    ).run();
    const res = await app.inject({
      method: "GET",
      url: `/api/auth/verify?token=${token}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects POSTs from disallowed origins", async () => {
    const { app } = await buildTestApp();
    currentApp = app;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/request-link",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
      },
      payload: JSON.stringify({ email: "x@example.com" }),
    });
    expect(res.statusCode).toBe(403);
  });
});
