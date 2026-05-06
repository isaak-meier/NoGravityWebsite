/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { createPlanetSongPromoPanel } from "./planet-song-promo-panel.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("planet-song-promo-panel", () => {
  it("throws if hypedditUrl is missing or invalid", () => {
    expect(() => createPlanetSongPromoPanel({})).toThrow(/hypedditUrl/i);
    expect(() => createPlanetSongPromoPanel({ hypedditUrl: "   " })).toThrow(/hypedditUrl/i);
    expect(() => createPlanetSongPromoPanel({ hypedditUrl: "ftp://x.com" })).toThrow(/hypedditUrl/i);
  });

  it("renders title and Hypeddit link", () => {
    const panel = createPlanetSongPromoPanel({
      hypedditUrl: "https://hypeddit.com/link/foo",
      title: "Test drop",
      buttonLabel: "Presave",
    });
    document.body.appendChild(panel.root);
    expect(panel.root.querySelector(".planet-mailing-panel__title").textContent).toBe("Test drop");
    const a = panel.root.querySelector("a.planet-mailing-panel__hypeddit-link");
    expect(a).toBeTruthy();
    expect(a.getAttribute("href")).toBe("https://hypeddit.com/link/foo");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.textContent).toBe("Presave");
  });

  it("setInsidePlanet toggles visibilityRoot like mailing panel", () => {
    const hud = document.createElement("div");
    hud.className = "planet-interior-hud";
    const panel = createPlanetSongPromoPanel(
      { hypedditUrl: "https://hypeddit.com/x" },
      { visibilityRoot: hud },
    );
    expect(panel.root.querySelector(".planet-mailing-panel__title").textContent).toBe(
      "stream planet cool",
    );
    expect(panel.root.querySelector("a.planet-mailing-panel__hypeddit-link").textContent).toBe(
      "teleport",
    );
    hud.appendChild(panel.root);
    panel.setInsidePlanet(true);
    expect(hud.classList.contains("planet-interior-hud--visible")).toBe(true);
    panel.setInsidePlanet(false);
    expect(hud.classList.contains("planet-interior-hud--visible")).toBe(false);
  });
});
