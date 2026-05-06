/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";
import { mountScreenDials } from "./screen-dials.js";

function makeSolarSystemLaserStub() {
  let mode = /** @type {'on'|'off'|null} */ (null);
  return {
    setGraphLaserManualOverride: (m) => {
      mode = m;
    },
    getGraphLaserManualOverride: () => mode,
  };
}

describe("mountScreenDials", () => {
  it("appends music, lasers mode, shatter trigger, and audio wiring", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: true },
      triggerManualShatter: () => {},
    };
    const audioState = { audioEl: null, _liveStream: null };
    const toggleAudioPlayback = async () => false;
    const solarSystem = makeSolarSystemLaserStub();

    const { syncMusicToggle } = mountScreenDials(container, {
      pyramidField,
      audioState,
      toggleAudioPlayback,
      solarSystem,
    });

    expect(container.querySelector(".screen-dials")).toBeTruthy();
    expect(container.querySelector(".cockpit-shatter-btn")).toBeTruthy();
    expect(container.querySelectorAll(".cockpit-toggle").length).toBe(1);
    expect(container.textContent).toMatch(/Music/);
    expect(container.textContent).toMatch(/Lasers/);
    expect(container.textContent).toMatch(/Shatter/);
    expect(container.querySelector("select.cockpit-graph-laser-select")).toBeTruthy();
    expect(typeof syncMusicToggle).toBe("function");
  });

  it("disables shatter trigger when subsystem would be off", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: false },
      triggerManualShatter: () => {},
    };
    mountScreenDials(container, {
      pyramidField,
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: makeSolarSystemLaserStub(),
    });
    const btn = container.querySelector(".cockpit-shatter-btn");
    expect(btn?.disabled).toBe(true);
  });

  it("calls triggerManualShatter when shatter button is clicked", () => {
    const container = document.createElement("div");
    const triggerManualShatter = vi.fn();
    const pyramidField = {
      config: { shatterSubsystemEnabled: true },
      triggerManualShatter,
    };
    mountScreenDials(container, {
      pyramidField,
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: makeSolarSystemLaserStub(),
    });
    container.querySelector(".cockpit-shatter-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(triggerManualShatter).toHaveBeenCalledTimes(1);
  });

  it("lasers select calls setGraphLaserManualOverride", () => {
    const container = document.createElement("div");
    const setGraphLaserManualOverride = vi.fn();
    const getGraphLaserManualOverride = vi.fn(() => null);
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: true },
        triggerManualShatter: () => {},
      },
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: { setGraphLaserManualOverride, getGraphLaserManualOverride },
    });
    const sel = container.querySelector("select.cockpit-graph-laser-select");
    expect(sel).toBeTruthy();
    sel.value = "off";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(setGraphLaserManualOverride).toHaveBeenCalledWith("off");
  });
});
