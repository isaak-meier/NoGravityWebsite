/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAuthUI } from "./auth-ui.js";

function makeFakeAuthClient(initial = null) {
  const listeners = new Set();
  let user = initial;
  return {
    getUser: () => user,
    isReady: () => true,
    refresh: vi.fn(async () => user),
    requestLink: vi.fn(async () => {}),
    logout: vi.fn(async () => { user = null; listeners.forEach((l) => l(null)); }),
    subscribe: (l) => { listeners.add(l); l(user); return () => listeners.delete(l); },
    _setUser(u) { user = u; listeners.forEach((l) => l(u)); },
  };
}

describe("auth-ui", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("renders 'Sign in' when logged out", () => {
    const ui = createAuthUI(makeFakeAuthClient(null));
    document.body.appendChild(ui.root);
    const open = ui.root.querySelector('[data-action="open"]');
    expect(open.hidden).toBe(false);
    expect(ui.root.querySelector(".auth-ui__user").hidden).toBe(true);
  });

  it("renders email + logout when logged in", () => {
    const auth = makeFakeAuthClient({ id: 1, email: "alice@example.com", display_name: null, is_admin: false });
    const ui = createAuthUI(auth);
    document.body.appendChild(ui.root);
    expect(ui.root.querySelector(".auth-ui__email").textContent).toBe("alice@example.com");
    expect(ui.root.querySelector('[data-action="logout"]').hidden).toBe(false);
  });

  it("opens the email form on click and submits to authClient.requestLink", async () => {
    const auth = makeFakeAuthClient(null);
    const ui = createAuthUI(auth, { siteOrigin: "https://site.example.com" });
    document.body.appendChild(ui.root);
    ui.root.querySelector('[data-action="open"]').click();
    const form = ui.root.querySelector(".auth-ui__form");
    expect(form.hidden).toBe(false);
    form.querySelector('input[name="email"]').value = "test@example.com";
    form.dispatchEvent(new Event("submit"));
    await new Promise((r) => setTimeout(r, 0));
    expect(auth.requestLink).toHaveBeenCalledWith("test@example.com", "https://site.example.com");
    expect(ui.root.querySelector(".auth-ui__status").hidden).toBe(false);
  });

  it("re-renders to logged-out state when authClient logs out", async () => {
    const auth = makeFakeAuthClient({ id: 1, email: "alice@example.com", display_name: null, is_admin: false });
    const ui = createAuthUI(auth);
    document.body.appendChild(ui.root);
    expect(ui.root.querySelector(".auth-ui__user").hidden).toBe(false);
    auth._setUser(null);
    expect(ui.root.querySelector(".auth-ui__user").hidden).toBe(true);
    expect(ui.root.querySelector('[data-action="open"]').hidden).toBe(false);
  });

  it("destroy() unsubscribes and detaches the root", () => {
    const auth = makeFakeAuthClient(null);
    const ui = createAuthUI(auth);
    document.body.appendChild(ui.root);
    ui.destroy();
    expect(document.body.contains(ui.root)).toBe(false);
  });
});
