/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUserStateSync } from "./user-state-sync.js";

function makeFakeAuthClient(initial = null) {
  const listeners = new Set();
  let user = initial;
  return {
    getUser: () => user,
    isReady: () => true,
    refresh: vi.fn(async () => user),
    requestLink: vi.fn(),
    logout: vi.fn(),
    subscribe: (l) => { listeners.add(l); l(user); return () => listeners.delete(l); },
    _setUser(u) { user = u; listeners.forEach((l) => l(u)); },
  };
}

beforeEach(() => {
  globalThis.localStorage?.clear?.();
  vi.useRealTimers();
});

describe("user-state-sync", () => {
  it("when logged out, notifyChange writes to localStorage and never to server", () => {
    const local = { volume: 0.7 };
    const fetchImpl = vi.fn();
    const auth = makeFakeAuthClient(null);
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => local,
      setLocal: () => {},
      fetchImpl,
    });
    sync.notifyChange();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(localStorage.getItem("ng_user_state")).toContain("0.7");
  });

  it("on auth-change to a logged-in user, GETs /api/me/state and applies it", async () => {
    let setLocalArg = null;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith("/api/me/state")) {
        return { ok: true, json: async () => ({ data: { fromServer: true }, updated_at: "now" }) };
      }
      return { ok: false };
    });
    const auth = makeFakeAuthClient(null);
    createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: (s) => { setLocalArg = s; },
      fetchImpl,
    });
    auth._setUser({ id: 7, email: "a@b.c", display_name: null, is_admin: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledWith("https://api.x/api/me/state", { credentials: "include" });
    expect(setLocalArg).toEqual({ fromServer: true });
  });

  it("when logged in, notifyChange debounces a PUT to /api/me/state", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const auth = makeFakeAuthClient({ id: 1, email: "a@b.c", display_name: null, is_admin: false });
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({ x: 1 }),
      setLocal: () => {},
      fetchImpl,
      debounceMs: 50,
    });
    fetchImpl.mockClear(); // ignore the initial pull triggered by auth subscribe()
    sync.notifyChange();
    sync.notifyChange();
    sync.notifyChange();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.x/api/me/state");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ x: 1 });
  });

  it("destroy() cancels a pending debounced PUT", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const auth = makeFakeAuthClient({ id: 1, email: "a@b.c", display_name: null, is_admin: false });
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: () => {},
      fetchImpl,
      debounceMs: 1000,
    });
    fetchImpl.mockClear();
    sync.notifyChange();
    sync.destroy();
    vi.advanceTimersByTime(2000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
