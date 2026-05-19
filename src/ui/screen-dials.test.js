/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";
import { getMusicStatusMessage, mountScreenDials } from "./screen-dials.js";

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
  it("shows music status when no track is loaded", () => {
    const container = document.createElement("div");
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: true },
        triggerManualShatter: () => {},
      },
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: makeSolarSystemLaserStub(),
    });
    const status = container.querySelector(".screen-dial__music-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toMatch(/unavailable|offline|loading|track/i);
  });

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

  it("disables shatter trigger when subsystem would be off and no planet shatter", () => {
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

  it("keeps shatter enabled when red planet shatter is available", () => {
    const container = document.createElement("div");
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: false },
        triggerManualShatter: () => {},
      },
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: {
        ...makeSolarSystemLaserStub(),
        triggerRedPlanetShatter: () => {},
      },
    });
    expect(container.querySelector(".cockpit-shatter-btn")?.disabled).toBe(false);
  });

  it("calls triggerRedPlanetShatter when solar system provides it", () => {
    const container = document.createElement("div");
    const triggerRedPlanetShatter = vi.fn();
    const triggerManualShatter = vi.fn();
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: true },
        triggerManualShatter,
      },
      audioState: { audioEl: null, _liveStream: null },
      toggleAudioPlayback: async () => false,
      solarSystem: {
        ...makeSolarSystemLaserStub(),
        triggerRedPlanetShatter,
      },
    });
    container.querySelector(".cockpit-shatter-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(triggerRedPlanetShatter).toHaveBeenCalledTimes(1);
    expect(triggerManualShatter).not.toHaveBeenCalled();
  });

  it("calls triggerManualShatter when shatter button is clicked without planet shatter", () => {
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

  it("shows music status when track load fails offline", () => {
    const container = document.createElement("div");
    const audioState = {
      audioEl: null,
      _liveStream: null,
      _musicLoadPhase: "error",
      _musicLoadOffline: true,
    };
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: true },
        triggerManualShatter: () => {},
      },
      audioState,
      toggleAudioPlayback: async () => false,
      solarSystem: makeSolarSystemLaserStub(),
    });
    const status = container.querySelector(".screen-dial__music-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toMatch(/offline/i);
  });

  it("hides music status when track is ready", () => {
    const container = document.createElement("div");
    const audio = document.createElement("audio");
    const audioState = {
      audioEl: audio,
      _liveStream: null,
      _musicLoadPhase: "ready",
      _musicLoadOffline: false,
    };
    mountScreenDials(container, {
      pyramidField: {
        config: { shatterSubsystemEnabled: true },
        triggerManualShatter: () => {},
      },
      audioState,
      toggleAudioPlayback: async () => false,
      solarSystem: makeSolarSystemLaserStub(),
    });
    expect(container.querySelector(".screen-dial__music-status")?.hidden).toBe(true);
  });
});

describe("getMusicStatusMessage", () => {
  it("returns loading, error, and live messages", () => {
    expect(getMusicStatusMessage({ _musicLoadPhase: "loading" })).toMatch(/loading/i);
    expect(getMusicStatusMessage({ _musicLoadPhase: "error", _musicLoadOffline: false })).toMatch(
      /couldn't load/i,
    );
    expect(getMusicStatusMessage({ _liveStream: {} })).toMatch(/live mic/i);
    expect(getMusicStatusMessage({ audioEl: {}, _musicLoadPhase: "ready" })).toBeNull();
  });

  it("returns fallback when no track is loaded", () => {
    expect(getMusicStatusMessage({})).toMatch(/unavailable/i);
    expect(getMusicStatusMessage({ _musicDriveConfigured: true })).toMatch(/select a track/i);
  });
});
