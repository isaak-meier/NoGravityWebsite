import { describe, it, expect, vi } from "vitest";
import { createAuthClient } from "./auth-client.js";

function makeFetchMock(handlers) {
  return vi.fn(async (url, init = {}) => {
    const handler = handlers[`${init.method || "GET"} ${url}`];
    if (!handler) throw new Error(`unexpected fetch: ${init.method || "GET"} ${url}`);
    return handler(url, init);
  });
}

describe("createAuthClient", () => {
  it("becomes ready with user=null when api.baseUrl is missing", async () => {
    const auth = createAuthClient({ baseUrl: null }, { fetchImpl: vi.fn() });
    expect(auth.isReady()).toBe(false);
    const u = await auth.refresh();
    expect(u).toBeNull();
    expect(auth.isReady()).toBe(true);
  });

  it("refresh() loads the current user when /api/auth/me is 200", async () => {
    const userPayload = { user: { id: 1, email: "a@b.c", display_name: null, is_admin: false, created_at: "x", last_login_at: null } };
    const fetchImpl = makeFetchMock({
      "GET https://api.example.com/api/auth/me": async () => ({ ok: true, json: async () => userPayload }),
    });
    const auth = createAuthClient({ baseUrl: "https://api.example.com" }, { fetchImpl });
    const u = await auth.refresh();
    expect(u).toEqual(userPayload.user);
    expect(auth.getUser()).toEqual(userPayload.user);
  });

  it("refresh() leaves user=null on 401", async () => {
    const fetchImpl = makeFetchMock({
      "GET https://api.example.com/api/auth/me": async () => ({ ok: false, status: 401 }),
    });
    const auth = createAuthClient({ baseUrl: "https://api.example.com" }, { fetchImpl });
    const u = await auth.refresh();
    expect(u).toBeNull();
  });

  it("requestLink POSTs JSON with credentials and { email, next }", async () => {
    const fetchImpl = vi.fn(async (url, init) => ({ ok: true }));
    const auth = createAuthClient({ baseUrl: "https://api.example.com" }, { fetchImpl });
    await auth.requestLink("a@b.c", "https://site.example.com/next");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/auth/request-link");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.c", next: "https://site.example.com/next" });
  });

  it("logout() clears user and notifies subscribers", async () => {
    const fetchImpl = makeFetchMock({
      "GET https://api.example.com/api/auth/me": async () => ({
        ok: true,
        json: async () => ({ user: { id: 1, email: "a@b.c", display_name: null, is_admin: false, created_at: "x", last_login_at: null } }),
      }),
      "POST https://api.example.com/api/auth/logout": async () => ({ ok: true }),
    });
    const auth = createAuthClient({ baseUrl: "https://api.example.com" }, { fetchImpl });
    const events = [];
    auth.subscribe((u) => events.push(u?.email ?? null));
    await auth.refresh();
    await auth.logout();
    expect(auth.getUser()).toBeNull();
    expect(events.at(-1)).toBeNull();
  });

  it("subscribe() replays the current state when ready", async () => {
    const fetchImpl = makeFetchMock({
      "GET https://api.example.com/api/auth/me": async () => ({ ok: false, status: 401 }),
    });
    const auth = createAuthClient({ baseUrl: "https://api.example.com" }, { fetchImpl });
    const seen = [];
    auth.subscribe((u) => seen.push(u));
    expect(seen).toEqual([]);
    await auth.refresh();
    expect(seen.at(-1)).toBeNull();
  });
});
