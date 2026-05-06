/**
 * Tiny sign-in UI: shows either the current user (with logout) or an inline
 * "send me a sign-in link" form. When mounted inside `.planet-interior-hud`, it
 * stacks with the mailing list panel; outer CSS may position it fixed (legacy).
 *
 * @param {ReturnType<import("./auth-client.js").createAuthClient>} authClient
 * @param {{ siteOrigin?: string }} [opts]
 * @returns {{ root: HTMLElement, destroy: () => void }}
 */
export function createAuthUI(authClient, opts = {}) {
  const root = document.createElement("div");
  root.className = "auth-ui";
  root.innerHTML = `
    <div class="auth-ui__pill" role="region" aria-label="Sign in">
      <button type="button" class="auth-ui__open" data-action="open">Sign in</button>
      <span class="auth-ui__user" hidden>
        <span class="auth-ui__email"></span>
        <button type="button" class="auth-ui__logout" data-action="logout">Log out</button>
      </span>
      <form class="auth-ui__form" hidden>
        <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
        <button type="submit">Send link</button>
        <button type="button" data-action="close">Cancel</button>
      </form>
      <span class="auth-ui__status" role="status" hidden></span>
    </div>`;

  const refs = {
    open: root.querySelector('[data-action="open"]'),
    user: root.querySelector(".auth-ui__user"),
    email: root.querySelector(".auth-ui__email"),
    logout: root.querySelector('[data-action="logout"]'),
    form: root.querySelector(".auth-ui__form"),
    status: root.querySelector(".auth-ui__status"),
  };

  const unsubscribe = authClient.subscribe((user) => render(refs, user));

  refs.open.addEventListener("click", () => showForm(refs));
  root.querySelector('[data-action="close"]').addEventListener("click", () => hideForm(refs));
  refs.logout.addEventListener("click", async () => {
    await authClient.logout();
  });
  refs.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const emailInput = refs.form.querySelector('input[name="email"]');
    const email = (emailInput?.value || "").trim();
    if (!email) return;
    setStatus(refs, "Sending\u2026");
    try {
      await authClient.requestLink(email, opts.siteOrigin || location.origin);
      setStatus(refs, "Check your inbox.");
    } catch (err) {
      setStatus(refs, err.message || "Couldn't send link");
    }
  });

  return {
    root,
    destroy() {
      unsubscribe();
      root.remove();
    },
  };
}

function render(refs, user) {
  if (user) {
    refs.open.hidden = true;
    refs.form.hidden = true;
    refs.status.hidden = true;
    refs.user.hidden = false;
    refs.email.textContent = user.display_name || user.email;
    return;
  }
  refs.user.hidden = true;
  refs.form.hidden = true;
  refs.status.hidden = true;
  refs.open.hidden = false;
}

function showForm(refs) {
  refs.open.hidden = true;
  refs.form.hidden = false;
  refs.status.hidden = true;
  refs.form.querySelector('input[name="email"]').focus();
}

function hideForm(refs) {
  refs.form.hidden = true;
  refs.status.hidden = true;
  refs.open.hidden = false;
}

function setStatus(refs, msg) {
  refs.status.hidden = false;
  refs.status.textContent = msg;
}
