/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";
import { mountScreenDials } from "./screen-dials.js";

describe("mountScreenDials", () => {
  it("appends music, shatter trigger, and audio wiring", () => {
    const container = document.createElement("div");
    const pyramidField = {
      config: { shatterSubsystemEnabled: true },
      triggerManualShatter: () => {},
    };
    const audioState = { audioEl: null, _liveStream: null };
    const toggleAudioPlayback = async () => false;

    const { syncMusicToggle } = mountScreenDials(container, {
      pyramidField,
      audioState,
      toggleAudioPlayback,
    });

    expect(container.querySelector(".screen-dials")).toBeTruthy();
    expect(container.querySelector(".cockpit-shatter-btn")).toBeTruthy();
    expect(container.querySelectorAll(".cockpit-toggle").length).toBe(1);
    expect(container.textContent).toMatch(/Music/);
    expect(container.textContent).toMatch(/Shatter/);
    expect(container.querySelector("select.cockpit-pattern-select")).toBeFalsy();
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
    });
    container.querySelector(".cockpit-shatter-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(triggerManualShatter).toHaveBeenCalledTimes(1);
  });
});
