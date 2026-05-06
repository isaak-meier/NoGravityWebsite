/**
 * Mailing list card for planet interior — matches lil-gui / cockpit styling (three-scene.js).
 * POSTs JSON to `${appConfig.api.baseUrl}/api/subscribe` with inline feedback.
 *
 * @throws {Error} If `appConfig.api.baseUrl` is missing or empty after trim.
 *
 * @param {{
 *   mailingList: { emailFieldName?: string },
 *   api: { baseUrl: string | null }
 * }} appConfig
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   visibilityRoot?: HTMLElement,
 * }} [opts]
 * When `visibilityRoot` is set (planet HUD wrapper), visibility toggles that element’s
 * `planet-interior-hud--visible` class instead of the panel root’s opacity.
 * @returns {{ root: HTMLElement, setInsidePlanet: (visible: boolean) => void }}
 */
export function createPlanetMailingPanel(appConfig, opts = {}) {
  const ml = appConfig.mailingList;
  const apiBaseUrl = appConfig.api?.baseUrl
    && String(appConfig.api.baseUrl).trim()
    ? String(appConfig.api.baseUrl).trim()
    : null;
  if (!apiBaseUrl) {
    throw new Error(
      "createPlanetMailingPanel: appConfig.api.baseUrl is required (set in src/config/app-config.js or app-config.local.json)",
    );
  }
  const emailFieldName = ml.emailFieldName || "EMAIL";
  const fetchImpl = opts.fetchImpl || globalThis.fetch?.bind(globalThis);

  const root = document.createElement("div");
  root.className = "planet-mailing-panel";
  if (opts.visibilityRoot) root.classList.add("planet-mailing-panel--in-hud");
  root.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "planet-mailing-panel__title";
  title.textContent = "Please sign up for our mailing list";


  const form = document.createElement("form");
  form.className = "planet-mailing-panel__form";

  const input = document.createElement("input");
  input.type = "email";
  input.className = "planet-mailing-panel__input";
  input.placeholder = "you@example.com";
  input.autocomplete = "email";
  input.required = true;
  input.name = emailFieldName;

  const actions = document.createElement("div");
  actions.className = "planet-mailing-panel__actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "planet-mailing-panel__submit";
  submit.textContent = "Sign up";

  const status = document.createElement("div");
  status.className = "planet-mailing-panel__status";
  status.setAttribute("role", "status");
  status.hidden = true;

  const hp = document.createElement("input");
  hp.type = "text";
  hp.name = "hp";
  hp.className = "planet-mailing-panel__hp";
  hp.setAttribute("tabindex", "-1");
  hp.setAttribute("autocomplete", "off");
  hp.setAttribute("aria-hidden", "true");
  hp.setAttribute("aria-label", "Leave empty");

  wireApiSubmit(form, input, hp, submit, status, apiBaseUrl, fetchImpl);

  actions.appendChild(submit);
  form.append(input, hp, actions);
  root.append(title, form, status);

  return {
    root,
    setInsidePlanet(visible) {
      if (opts.visibilityRoot) {
        opts.visibilityRoot.classList.toggle("planet-interior-hud--visible", visible);
        opts.visibilityRoot.setAttribute("aria-hidden", visible ? "false" : "true");
        return;
      }
      root.classList.toggle("planet-mailing-panel--visible", visible);
      root.setAttribute("aria-hidden", visible ? "false" : "true");
    },
  };
}

function wireApiSubmit(form, input, hpInput, submit, status, apiBaseUrl, fetchImpl) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    setStatus(status, "Sending\u2026");
    submit.disabled = true;
    try {
      const res = await fetchImpl(`${apiBaseUrl}/api/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, hp: hpInput.value }),
      });
      if (res.ok) {
        input.value = "";
        setStatus(status, "Check your inbox to confirm.");
        return;
      }
      let msg = `Request failed (${res.status}).`;
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();
      if (ct.includes("application/json") && raw) {
        try {
          const j = JSON.parse(raw);
          if (j?.error === "forbidden_origin") {
            msg =
              "Could not submit from this URL (origin blocked). Try the site without or with “www”, or contact support.";
          } else if (typeof j?.error === "string") msg = j.error;
        } catch {
          /* keep msg */
        }
      }
      setStatus(status, msg);
    } catch (err) {
      setStatus(status, err?.message || "Sign-up failed. Try again later.");
    } finally {
      submit.disabled = false;
    }
  });
}

function setStatus(el, text) {
  el.hidden = false;
  el.textContent = text;
}
