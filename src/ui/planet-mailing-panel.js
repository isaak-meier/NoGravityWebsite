/**
 * Mailing list card for planet interior — matches lil-gui / cockpit styling (three-scene.js).
 * @param {{ mailingList: { formAction: string | null, emailFieldName: string, mailtoFallback: string | null } }} appConfig
 * @returns {{ root: HTMLElement, setInsidePlanet: (visible: boolean) => void }}
 */
export function createPlanetMailingPanel(appConfig) {
  const ml = appConfig.mailingList;
  const formAction = ml.formAction && String(ml.formAction).trim() ? String(ml.formAction).trim() : null;
  const emailFieldName = ml.emailFieldName || "EMAIL";
  const mailtoFallback = ml.mailtoFallback && String(ml.mailtoFallback).trim()
    ? String(ml.mailtoFallback).trim()
    : null;

  const root = document.createElement("div");
  root.className = "planet-mailing-panel";
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

  if (formAction) {
    form.method = "post";
    form.action = formAction;
    form.target = "_blank";
    form.setAttribute("rel", "noopener noreferrer");
  } else {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email) return;
      const to = mailtoFallback || "";
      const params = new URLSearchParams({
        subject: "Mailing list signup",
        body: `Please subscribe this address:\n${email}`,
      });
      window.location.href = `mailto:${to}?${params.toString()}`;
    });
  }

  actions.appendChild(submit);
  form.append(input, actions);
  root.append(title, form);

  return {
    root,
    setInsidePlanet(visible) {
      root.classList.toggle("planet-mailing-panel--visible", visible);
      root.setAttribute("aria-hidden", visible ? "false" : "true");
    },
  };
}
