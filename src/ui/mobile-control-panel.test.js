/** @vitest-environment jsdom */

import { describe, it, expect } from "vitest";
import { attachMobileControlPanel } from "./mobile-control-panel.js";

describe("attachMobileControlPanel", () => {
  it("returns the hud root unchanged on desktop", () => {
    const hud = document.createElement("div");
    hud.className = "bottom-left-hud";
    expect(attachMobileControlPanel(hud, false)).toBe(hud);
    expect(hud.querySelector(".cockpit-control-panel-btn")).toBeFalsy();
  });

  it("adds a toggle and hidden drawer on mobile", () => {
    const hud = document.createElement("div");
    hud.className = "bottom-left-hud";
    const host = attachMobileControlPanel(hud, true);
    const btn = hud.querySelector(".cockpit-control-panel-btn");
    const drawer = hud.querySelector(".bottom-left-hud__drawer");
    expect(hud.classList.contains("bottom-left-hud--collapsible")).toBe(true);
    expect(host).toBe(drawer);
    expect(drawer?.hidden).toBe(true);
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    btn?.click();
    expect(drawer?.hidden).toBe(false);
    expect(btn?.classList.contains("cockpit-control-panel-btn--open")).toBe(true);
    expect(hud.classList.contains("bottom-left-hud--drawer-open")).toBe(true);
    btn?.click();
    expect(drawer?.hidden).toBe(true);
    expect(hud.classList.contains("bottom-left-hud--drawer-open")).toBe(false);
  });
});
