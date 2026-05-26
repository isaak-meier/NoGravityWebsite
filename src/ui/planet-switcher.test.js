/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";
import { createPlanetSwitcher } from "./planet-switcher.js";

function makeCamCtrl() {
  const camCtrl = {
    followPlanet: null,
    followComet: null,
    _graphMode: false,
    lockToPlanetWithoutIntro: vi.fn(),
    beginFollowComet: vi.fn(),
    switchToGalaxyView: vi.fn(),
    getViewMode() {
      if (this._graphMode) return "galaxy";
      if (this.followComet) return "comet";
      if (this.followPlanet) return "planet";
      return "none";
    },
  };
  return camCtrl;
}

describe("createPlanetSwitcher", () => {
  it("renders planet, comet, and galaxy tabs", () => {
    const planets = [
      { def: { label: "Blue", color: 0x60a5fa } },
      { def: { label: "Red", color: 0xf87171 } },
    ];
    const comet = { group: {} };
    const camCtrl = makeCamCtrl();

    const { root } = createPlanetSwitcher({ planets, comet, camCtrl });

    expect(root.querySelectorAll(".planet-switcher-btn")).toHaveLength(4);
    expect(root.querySelector('[data-target="planet-0"]')?.textContent).toContain("Blue");
    expect(root.querySelector('[data-target="comet"]')?.textContent).toBe("Comet");
    expect(root.querySelector('[data-target="galaxy"]')?.textContent).toBe("Galaxy");
  });

  it("calls camera helpers when tabs are clicked", () => {
    const planets = [{ def: { label: "Blue", color: 0x60a5fa } }];
    const comet = { group: {} };
    const camCtrl = makeCamCtrl();

    const { root } = createPlanetSwitcher({ planets, comet, camCtrl });

    root.querySelector('[data-target="planet-0"]')?.click();
    expect(camCtrl.lockToPlanetWithoutIntro).toHaveBeenCalledWith(planets[0]);

    root.querySelector('[data-target="comet"]')?.click();
    expect(camCtrl.beginFollowComet).toHaveBeenCalledWith(comet);

    root.querySelector('[data-target="galaxy"]')?.click();
    expect(camCtrl.switchToGalaxyView).toHaveBeenCalled();
  });
});
