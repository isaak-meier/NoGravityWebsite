/**
 * Browser-side client for the magic-link auth API on the No Gravity backend.
 * Holds the current user (or null), exposes requestLink/me/logout, and emits
 * "authchange" events when the auth state flips.
 *
 * @typedef {{ id: number, email: string, display_name: string|null,
 *   is_admin: boolean, created_at: string, last_login_at: string|null }} AuthUser
 */

const AUTH_ME_ENDPOINT = "/api/auth/me";
const AUTH_REQUEST_LINK_ENDPOINT = "/api/auth/request-link";
const AUTH_LOGOUT_ENDPOINT = "/api/auth/logout";

/**
 * @param {{ baseUrl: string|null }} apiConfig
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {{
 *   getUser: () => AuthUser|null,
 *   isReady: () => boolean,
 *   refresh: () => Promise<AuthUser|null>,
 *   requestLink: (email: string, next?: string) => Promise<void>,
 *   logout: () => Promise<void>,
 *   subscribe: (listener: (user: AuthUser|null) => void) => () => void,
 * }}
 */
export function createAuthClient(apiConfig, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch?.bind(globalThis);
  const baseUrl = apiConfig?.baseUrl || null;
  const listeners = new Set();
  let user = null;
  let ready = false;

  function emit() {
    for (const l of listeners) {
      try { l(user); } catch (e) { console.warn("auth listener threw", e); }
    }
  }

  async function refresh() {
    if (!baseUrl || !fetchImpl) {
      ready = true;
      user = null;
      emit();
      return null;
    }
    try {
      const res = await fetchImpl(`${baseUrl}${AUTH_ME_ENDPOINT}`, {
        credentials: "include",
      });
      user = res.ok ? (await res.json()).user : null;
    } catch {
      user = null;
    }
    ready = true;
    emit();
    return user;
  }

  async function requestLink(email, next) {
    if (!baseUrl || !fetchImpl) throw new Error("api.baseUrl is not configured");
    const body = next ? { email, next } : { email };
    const res = await fetchImpl(`${baseUrl}${AUTH_REQUEST_LINK_ENDPOINT}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`request-link failed: ${res.status}`);
  }

  async function logout() {
    if (!baseUrl || !fetchImpl) return;
    await fetchImpl(`${baseUrl}${AUTH_LOGOUT_ENDPOINT}`, {
      method: "POST",
      credentials: "include",
    });
    user = null;
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    if (ready) listener(user);
    return () => listeners.delete(listener);
  }

  return {
    getUser: () => user,
    isReady: () => ready,
    refresh,
    requestLink,
    logout,
    subscribe,
  };
}
