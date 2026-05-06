/**
 * Server-synced state for logged-in users. When signed in, the local store is
 * pulled from the server on auth-change and pushed (debounced) on local
 * change. When signed out, falls back to localStorage so the user still keeps
 * their per-browser preferences.
 *
 * Wiring is intentionally store-agnostic: callers pass `getLocal/setLocal`
 * accessors so this module doesn't need to know about specific app state
 * shapes.
 *
 * @typedef {{
 *   getLocal: () => object,
 *   setLocal: (state: object) => void,
 *   storageKey?: string,
 *   debounceMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} StateSyncOptions
 *
 * @param {{ baseUrl: string|null }} apiConfig
 * @param {ReturnType<import("../auth/auth-client.js").createAuthClient>} authClient
 * @param {StateSyncOptions} options
 * @returns {{ notifyChange: () => void, destroy: () => void }}
 */
export function createUserStateSync(apiConfig, authClient, options) {
  const baseUrl = apiConfig?.baseUrl || null;
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const storageKey = options.storageKey || "ng_user_state";
  const debounceMs = options.debounceMs ?? 1000;
  let pendingTimer = null;
  let inflight = null;
  let lastUserId = null;

  function loadLocalFallback() {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey);
      if (raw) options.setLocal(JSON.parse(raw));
    } catch { /* ignore */ }
  }

  function saveLocalFallback(state) {
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(state));
    } catch { /* ignore */ }
  }

  async function pullFromServer() {
    if (!baseUrl || !fetchImpl) return;
    try {
      const res = await fetchImpl(`${baseUrl}/api/me/state`, { credentials: "include" });
      if (!res.ok) return;
      const { data } = await res.json();
      if (data && typeof data === "object") options.setLocal(data);
    } catch { /* ignore */ }
  }

  async function pushToServer() {
    if (!baseUrl || !fetchImpl) return;
    if (!authClient.getUser()) return;
    const state = options.getLocal();
    inflight = fetchImpl(`${baseUrl}/api/me/state`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => null);
    await inflight;
    inflight = null;
  }

  const unsubscribe = authClient.subscribe((user) => {
    if (user && user.id !== lastUserId) {
      lastUserId = user.id;
      void pullFromServer();
    } else if (!user) {
      lastUserId = null;
      loadLocalFallback();
    }
  });

  function notifyChange() {
    if (authClient.getUser()) {
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { void pushToServer(); }, debounceMs);
      return;
    }
    saveLocalFallback(options.getLocal());
  }

  return {
    notifyChange,
    destroy() {
      clearTimeout(pendingTimer);
      unsubscribe();
    },
  };
}
