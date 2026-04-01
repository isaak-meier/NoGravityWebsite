/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";
import { mountScreenDials } from "./screen-dials.js";

describe("mountScreenDials", () => {
  it("appends music, freeze, shatter trigger, pattern selector, and audio wiring", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: true, patternMode: 0 },
      triggerManualShatter: () => {},
    };
    const audioState = { audioEl: null, _liveStream: null };
    const toggleAudioPlayback = async () => false;

    const { syncMusicToggle } = mountScreenDials(container, {
      pyramidField,
      audioState,
      toggleAudioPlayback,
    });

    const patternSelect = container.querySelector("select.cockpit-pattern-select");
    expect(patternSelect).toBeTruthy();
    expect(container.querySelector(".cockpit-shatter-btn")).toBeTruthy();
    expect(container.querySelectorAll(".cockpit-toggle").length).toBe(2);
    expect(container.querySelector(".screen-dials")).toBeTruthy();
    expect(container.textContent).toMatch(/Music/);
    expect(container.textContent).toMatch(/Freeze/);
    expect(container.textContent).toMatch(/Shatter/);
    expect(container.textContent).toMatch(/Pattern/);
    expect(container.textContent).toMatch(/Unshattered pyramids/);
    expect(typeof syncMusicToggle).toBe("function");
  });

  it("toggles shatterSubsystemEnabled when freeze switch is clicked", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: true, patternMode: 0 },
      triggerManualShatter: () => {},
    };
    mountScreenDials(container, {
      pyramidField,
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
    });
    const switches = container.querySelectorAll(".screen-dial--freeze .cockpit-toggle");
    expect(switches.length).toBe(1);
    switches[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(pyramidField.config.shatterSubsystemEnabled).toBe(false);
    switches[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(pyramidField.config.shatterSubsystemEnabled).toBe(true);
  });

  it("calls triggerManualShatter when shatter button is clicked", () => {
    const container = document.createElement("div");
    const triggerManualShatter = vi.fn();
    const pyramidField = {
      config: { shatterSubsystemEnabled: true, patternMode: 0 },
      triggerManualShatter,
    };
    mountScreenDials(container, {
      pyramidField,
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
    });
    container.querySelector(".cockpit-shatter-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(triggerManualShatter).toHaveBeenCalledTimes(1);
  });

  it("updates patternMode when pattern select changes", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: true, patternMode: 0, lockShatterPatternSeed: false },
      triggerManualShatter: () => {},
    };
    mountScreenDials(container, {
      pyramidField,
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
    });
    const select = container.querySelector("select.cockpit-pattern-select");
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pyramidField.config.patternMode).toBe(2);
    expect(pyramidField.config.lockShatterPatternSeed).toBe(true);
  });
});
