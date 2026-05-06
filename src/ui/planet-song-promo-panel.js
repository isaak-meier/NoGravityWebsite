/**
 * Temporary planet-interior promo (Hypeddit / new release). Matches mailing panel styling.
 *
 * @param {{
 *   hypedditUrl?: string | null,
 *   title?: string | null,
 *   buttonLabel?: string | null,
 * }} songPromotion
 * @param {{ visibilityRoot?: HTMLElement }} [opts]
 * @returns {{ root: HTMLElement, setInsidePlanet: (visible: boolean) => void }}
 */
export function createPlanetSongPromoPanel(songPromotion = {}, opts = {}) {
  const rawUrl = songPromotion.hypedditUrl != null ? String(songPromotion.hypedditUrl).trim() : "";
  let href = rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") href = "";
  } catch {
    href = "";
  }
  if (!href) {
    throw new Error(
      "createPlanetSongPromoPanel: songPromotion.hypedditUrl must be a valid http(s) URL (set in src/config/app-config.js)",
    );
  }

  const titleText =
    songPromotion.title != null && String(songPromotion.title).trim()
      ? String(songPromotion.title).trim()
      : "stream planet cool";
  const buttonLabel =
    songPromotion.buttonLabel != null && String(songPromotion.buttonLabel).trim()
      ? String(songPromotion.buttonLabel).trim()
      : "teleport";

  const root = document.createElement("div");
  root.className = "planet-mailing-panel planet-mailing-panel--promo";
  if (opts.visibilityRoot) root.classList.add("planet-mailing-panel--in-hud");
  root.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "planet-mailing-panel__title";
  title.textContent = titleText;

  const box = document.createElement("div");
  box.className = "planet-mailing-panel__form planet-mailing-panel__promo-box";

  const actions = document.createElement("div");
  actions.className = "planet-mailing-panel__actions planet-mailing-panel__promo-actions";

  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "planet-mailing-panel__submit planet-mailing-panel__hypeddit-link";
  link.textContent = buttonLabel;
  link.setAttribute("role", "button");

  actions.appendChild(link);
  box.appendChild(actions);
  root.append(title, box);

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
