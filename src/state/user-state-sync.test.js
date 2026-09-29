/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createUserStateSync } from "./user-state-sync.js";

function installLocalStorageMock() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
  };
}

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
  installLocalStorageMock();
  vi.useRealTimers();
});

describe("createUserStateSync", () => {
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
    fetchImpl.mockClear();
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

  it("uses custom storageKey when logged out", () => {
    const auth = makeFakeAuthClient(null);
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({ theme: "dark" }),
      setLocal: () => {},
      fetchImpl: vi.fn(),
      storageKey: "custom_key",
    });
    sync.notifyChange();
    expect(localStorage.getItem("custom_key")).toContain("dark");
    expect(localStorage.getItem("ng_user_state")).toBeNull();
  });

  it("loads localStorage fallback when user logs out", () => {
    localStorage.setItem("ng_user_state", JSON.stringify({ saved: true }));
    let applied = null;
    const auth = makeFakeAuthClient({ id: 1, email: "a@b.c", display_name: null, is_admin: false });
    createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: (s) => { applied = s; },
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })),
    });
    auth._setUser(null);
    expect(applied).toEqual({ saved: true });
  });

  it("ignores corrupt localStorage JSON on logout", () => {
    localStorage.setItem("ng_user_state", "{not-json");
    const setLocal = vi.fn();
    const auth = makeFakeAuthClient({ id: 1, email: "a@b.c", display_name: null, is_admin: false });
    createUserStateSync({ baseUrl: null }, auth, {
      getLocal: () => ({}),
      setLocal,
      fetchImpl: vi.fn(),
    });
    auth._setUser(null);
    expect(setLocal).not.toHaveBeenCalled();
  });

  it("does not pull from server when baseUrl is null", async () => {
    const fetchImpl = vi.fn();
    const auth = makeFakeAuthClient(null);
    createUserStateSync({ baseUrl: null }, auth, {
      getLocal: () => ({}),
      setLocal: () => {},
      fetchImpl,
    });
    auth._setUser({ id: 2, email: "x@y.z", display_name: null, is_admin: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not push to server when logged out even with pending timer cleared", () => {
    const fetchImpl = vi.fn();
    const auth = makeFakeAuthClient(null);
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({ a: 1 }),
      setLocal: () => {},
      fetchImpl,
    });
    sync.notifyChange();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips applying server state when GET response is not ok", async () => {
    let applied = null;
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    const auth = makeFakeAuthClient(null);
    createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: (s) => { applied = s; },
      fetchImpl,
    });
    auth._setUser({ id: 3, email: "a@b.c", display_name: null, is_admin: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toBeNull();
  });

  it("skips applying server state when data is missing or not an object", async () => {
    let applied = null;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: null }),
    }));
    const auth = makeFakeAuthClient(null);
    createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: (s) => { applied = s; },
      fetchImpl,
    });
    auth._setUser({ id: 4, email: "a@b.c", display_name: null, is_admin: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toBeNull();
  });

  it("does not re-pull when the same user id is re-emitted", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { v: 1 } }),
    }));
    const user = { id: 5, email: "a@b.c", display_name: null, is_admin: false };
    const auth = makeFakeAuthClient(user);
    createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: () => {},
      fetchImpl,
    });
    await new Promise((r) => setTimeout(r, 0));
    fetchImpl.mockClear();
    auth._setUser({ ...user });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows fetch errors on push without throwing", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network")));
    const auth = makeFakeAuthClient({ id: 6, email: "a@b.c", display_name: null, is_admin: false });
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({ ok: true }),
      setLocal: () => {},
      fetchImpl,
      debounceMs: 10,
    });
    fetchImpl.mockClear();
    sync.notifyChange();
    vi.advanceTimersByTime(20);
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("destroy() stops auth subscription from reacting to later user changes", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { n: 1 } }),
    }));
    const auth = makeFakeAuthClient(null);
    const sync = createUserStateSync({ baseUrl: "https://api.x" }, auth, {
      getLocal: () => ({}),
      setLocal: () => {},
      fetchImpl,
    });
    sync.destroy();
    fetchImpl.mockClear();
    auth._setUser({ id: 99, email: "a@b.c", display_name: null, is_admin: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
