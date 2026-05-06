import { describe, it, expect, afterEach } from "vitest";
import { buildTestApp } from "./helpers.js";
import { SESSION_COOKIE } from "../src/auth/session.js";
import { runCampaignSend } from "../src/admin/campaign-sender.js";

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
  const sc = verify.headers["set-cookie"];
  const arr = Array.isArray(sc) ? sc : [sc];
  return arr.find((c) => c && c.startsWith(`${SESSION_COOKIE}=`)).split(";")[0];
}

async function adminSignIn(app, mail, email = "boss@nxgrxvity.com") {
  return signIn(app, mail, email);
}

async function buildAppWithAdmin() {
  return buildTestApp({ INITIAL_ADMIN_EMAIL: "boss@nxgrxvity.com" });
}

async function seedSubscribers(app, mail, emails) {
  for (const email of emails) {
    await app.inject({
      method: "POST",
      url: "/api/subscribe",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN },
      payload: JSON.stringify({ email }),
    });
  }
  // Confirm them all so they're eligible for campaigns.
  const confirmMails = mail.sent.filter((m) => /confirm/i.test(m.subject));
  for (const m of confirmMails) {
    const t = m.text.match(/token=([A-Za-z0-9_-]+)/)[1];
    await app.inject({ method: "GET", url: `/api/confirm?token=${t}` });
  }
}

describe("admin auth gating", () => {
  it("admin endpoints 401 anonymous, 403 non-admin, 200 admin", async () => {
    const { app, mail } = await buildAppWithAdmin();
    currentApp = app;

    const anon = await app.inject({ method: "GET", url: "/api/admin/subscribers" });
    expect(anon.statusCode).toBe(401);

    const userCookie = await signIn(app, mail, "regular@example.com");
    const nonAdmin = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers",
      headers: { cookie: userCookie },
    });
    expect(nonAdmin.statusCode).toBe(403);

    const adminCookie = await adminSignIn(app, mail);
    const ok = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers",
      headers: { cookie: adminCookie },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("admin subscribers", () => {
  it("lists, paginates, and filters by status and q", async () => {
    const { app, mail } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["a@example.com", "b@example.com", "c@example.com"]);

    const cookie = await adminSignIn(app, mail);

    const all = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers",
      headers: { cookie },
    });
    expect(all.json().total).toBe(3);
    expect(all.json().items).toHaveLength(3);

    const confirmedOnly = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers?status=confirmed",
      headers: { cookie },
    });
    expect(confirmedOnly.json().total).toBe(3);

    const search = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers?q=b%40",
      headers: { cookie },
    });
    expect(search.json().total).toBe(1);
    expect(search.json().items[0].email).toBe("b@example.com");
  });

  it("CSV export contains all rows + a header row", async () => {
    const { app, mail } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["a@example.com", "b@example.com"]);
    const cookie = await adminSignIn(app, mail);
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/subscribers.csv",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/csv/);
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines.length).toBe(3);
    expect(lines[0].split(",")).toContain("email");
  });

  it("DELETE removes the subscriber row", async () => {
    const { app, mail, db } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["doomed@example.com"]);
    const cookie = await adminSignIn(app, mail);
    const id = db.prepare("SELECT id FROM subscribers WHERE email = ?").get("doomed@example.com").id;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/subscribers/${id}`,
      headers: { cookie, origin: SITE_ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE id = ?").get(id).n).toBe(0);
  });
});

describe("admin campaigns", () => {
  it("create -> get -> update -> list", async () => {
    const { app, mail } = await buildAppWithAdmin();
    currentApp = app;
    const cookie = await adminSignIn(app, mail);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Hello", html_body: "<p>Hi</p>", text_body: "Hi" }),
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    expect(created.json().status).toBe("draft");

    const got = await app.inject({
      method: "GET",
      url: `/api/admin/campaigns/${id}`,
      headers: { cookie },
    });
    expect(got.json().subject).toBe("Hello");
    expect(got.json().send_counts).toEqual({ ok: 0, error: 0 });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/campaigns/${id}`,
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Updated" }),
    });
    expect(updated.json().subject).toBe("Updated");

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/campaigns",
      headers: { cookie },
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].subject).toBe("Updated");
  });

  it("send returns 202 and (after the background loop) marks campaign sent + emails confirmed subs only", async () => {
    const { app, mail, db } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["x@example.com", "y@example.com"]);
    // Add a pending one (should NOT receive the campaign).
    await app.inject({
      method: "POST",
      url: "/api/subscribe",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN },
      payload: JSON.stringify({ email: "pending@example.com" }),
    });
    const cookie = await adminSignIn(app, mail);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Newsletter #1", html_body: "<p>Body</p>", text_body: "Body" }),
    });
    const id = created.json().id;
    const before = mail.sent.length;

    // Awaiting the underlying loop directly so the test isn't racy. The route
    // itself is also exercised right above.
    const route = await app.inject({
      method: "POST",
      url: `/api/admin/campaigns/${id}/send`,
      headers: { cookie, origin: SITE_ORIGIN },
    });
    expect(route.statusCode).toBe(202);

    const counts = await runCampaignSend(app, id);
    // The route already kicked off a send too, but runCampaignSend returns
    // {ok:0,error:0} once the campaign is marked 'sent'. So we just verify the
    // resulting DB state, regardless of which path completed first.
    void counts;

    const sentMails = mail.sent.slice(before).filter((m) => m.subject === "Newsletter #1");
    expect(sentMails.map((m) => m.to).sort()).toEqual(["x@example.com", "y@example.com"]);

    const finalCampaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
    expect(finalCampaign.status).toBe("sent");

    // Each confirmed sub got exactly one campaign_sends row.
    const sendRows = db
      .prepare("SELECT subscriber_id, status FROM campaign_sends WHERE campaign_id = ?")
      .all(id);
    expect(sendRows).toHaveLength(2);
    expect(sendRows.every((r) => r.status === "ok")).toBe(true);
  });

  it("send refuses a non-draft campaign", async () => {
    const { app, mail, db } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["z@example.com"]);
    const cookie = await adminSignIn(app, mail);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Once", text_body: "x" }),
    });
    const id = created.json().id;
    await runCampaignSend(app, id);
    expect(db.prepare("SELECT status FROM campaigns WHERE id = ?").get(id).status).toBe("sent");

    const second = await app.inject({
      method: "POST",
      url: `/api/admin/campaigns/${id}/send`,
      headers: { cookie, origin: SITE_ORIGIN },
    });
    expect(second.statusCode).toBe(409);
  });

  it("recipient unsubscribe footer link works (clicking unsubscribes them)", async () => {
    const { app, mail, db } = await buildAppWithAdmin();
    currentApp = app;
    await seedSubscribers(app, mail, ["u@example.com"]);
    const cookie = await adminSignIn(app, mail);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, cookie },
      payload: JSON.stringify({ subject: "Bye?", text_body: "Hello" }),
    });
    const id = created.json().id;
    await runCampaignSend(app, id);
    const campaignMail = mail.sent.find((m) => m.subject === "Bye?");
    expect(campaignMail.text).toMatch(/Unsubscribe:/);
    const unsubLink = campaignMail.text.match(/Unsubscribe: (\S+)/)[1];
    const url = new URL(unsubLink);
    const res = await app.inject({
      method: "GET",
      url: url.pathname + url.search,
    });
    expect(res.statusCode).toBe(200);
    expect(db.prepare("SELECT status FROM subscribers WHERE email = ?").get("u@example.com").status).toBe("unsubscribed");
  });
});
