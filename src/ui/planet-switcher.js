/** @param {number} hex */
function hexToCss(hex) {
  return `#${(hex >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
}

/**
 * Corner HUD to jump the camera between planets, the comet, and galaxy view.
 *
 * @param {{
 *   planets: Array<{ def?: { label?: string, color?: number } }>,
 *   comet: unknown,
 *   camCtrl: {
 *     lockToPlanetWithoutIntro: (p: unknown) => void,
 *     beginFollowComet: (c: unknown) => void,
 *     switchToGalaxyView: () => void,
 *     getViewMode: () => string,
 *     followPlanet: unknown,
 *     followComet: unknown,
 *   },
 * }} ctx
 * @returns {{ root: HTMLElement, syncActive: () => void }}
 */
export function createPlanetSwitcher(ctx) {
  const { planets, comet, camCtrl } = ctx;

  const root = document.createElement("nav");
  root.className = "planet-switcher-hud";
  root.setAttribute("aria-label", "Camera view switcher");

  const label = document.createElement("span");
  label.className = "planet-switcher-hud__label";
  label.textContent = "View";

  const list = document.createElement("div");
  list.className = "planet-switcher-hud__list";
  list.setAttribute("role", "tablist");

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();

  planets.forEach((planet, index) => {
    const name = planet.def?.label ?? `Planet ${index + 1}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "planet-switcher-btn";
    btn.dataset.target = `planet-${index}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-label", `View ${name} planet`);
    btn.textContent = name;

    const swatch = document.createElement("span");
    swatch.className = "planet-switcher-btn__swatch";
    swatch.setAttribute("aria-hidden", "true");
    if (planet.def?.color != null) {
      swatch.style.backgroundColor = hexToCss(planet.def.color);
    }
    btn.prepend(swatch);

    btn.addEventListener("click", () => {
      camCtrl.lockToPlanetWithoutIntro(planet);
      syncActive();
    });

    buttons.set(`planet-${index}`, btn);
    list.appendChild(btn);
  });

  const cometBtn = document.createElement("button");
  cometBtn.type = "button";
  cometBtn.className = "planet-switcher-btn planet-switcher-btn--comet";
  cometBtn.dataset.target = "comet";
  cometBtn.setAttribute("role", "tab");
  cometBtn.setAttribute("aria-label", "View comet");
  cometBtn.textContent = "Comet";
  cometBtn.addEventListener("click", () => {
    if (comet) camCtrl.beginFollowComet(comet);
    syncActive();
  });
  buttons.set("comet", cometBtn);
  list.appendChild(cometBtn);

  const galaxyBtn = document.createElement("button");
  galaxyBtn.type = "button";
  galaxyBtn.className = "planet-switcher-btn planet-switcher-btn--galaxy";
  galaxyBtn.dataset.target = "galaxy";
  galaxyBtn.setAttribute("role", "tab");
  galaxyBtn.setAttribute("aria-label", "View whole galaxy");
  galaxyBtn.textContent = "Galaxy";
  galaxyBtn.addEventListener("click", () => {
    camCtrl.switchToGalaxyView();
    syncActive();
  });
  buttons.set("galaxy", galaxyBtn);
  list.appendChild(galaxyBtn);

  root.append(label, list);

  function activeTargetKey() {
    const mode = camCtrl.getViewMode();
    if (mode === "galaxy") return "galaxy";
    if (mode === "comet") return "comet";
    if (mode === "planet") {
      const idx = planets.indexOf(/** @type {object} */ (camCtrl.followPlanet));
      return idx >= 0 ? `planet-${idx}` : null;
    }
    return null;
  }

  function syncActive() {
    const active = activeTargetKey();
    for (const [key, btn] of buttons) {
      const isActive = key === active;
      btn.classList.toggle("planet-switcher-btn--active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  }

  syncActive();

  return { root, syncActive };
}
