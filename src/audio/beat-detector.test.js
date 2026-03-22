/** @vitest-environment jsdom */

import { describe, it, expect, vi } from "vitest";

// BeatDetector will import realtime-bpm-analyzer; jsdom has no AudioWorklet — mock factory.
vi.mock("realtime-bpm-analyzer", () => ({
  createRealtimeBpmAnalyzer: vi.fn(async () => ({
    node: {},
    on: vi.fn(),
    reset: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
  })),
  getBiquadFilter: vi.fn((ctx) => {
    const f = ctx.createBiquadFilter();
    return f;
  }),
}));

import BeatDetector from "./beat-detector.js";

describe("BeatDetector", () => {
  describe("constructor", () => {
    it("initializes defaults", () => {
      const d = new BeatDetector();
      expect(d.sensitivity).toBe(1.0);
      expect(d.bpm).toBe(0);
      expect(d.barDuration).toBe(2.0);
      expect(d._lowEnergyAvg).toBe(0);
      expect(d._lowEnergyAlpha).toBe(0.05);
      expect(d._lastBeat).toBe(false);
      expect(d._lastIntensity).toBe(0);
      expect(d._analyser).toBeNull();
      expect(d._bpmAnalyzer).toBeNull();
    });

    it("accepts custom sensitivity", () => {
      const d = new BeatDetector({ sensitivity: 2.5 });
      expect(d.sensitivity).toBe(2.5);
    });
  });

  describe("update", () => {
    it("returns fallbacks when fftData is null", () => {
      const d = new BeatDetector();
      expect(d.update(null)).toEqual({
        isBeat: false,
        intensity: 0,
        barDuration: 2.0,
      });
    });

    it("returns fallbacks when fftData is empty", () => {
      const d = new BeatDetector();
      expect(d.update(new Float32Array(0))).toEqual({
        isBeat: false,
        intensity: 0,
        barDuration: 2.0,
      });
    });

    it("returns no beat for silent spectrum", () => {
      const d = new BeatDetector();
      const silent = new Float32Array(256);
      const out = d.update(silent);
      expect(out.isBeat).toBe(false);
      expect(out.intensity).toBe(0);
      expect(out.barDuration).toBe(2.0);
    });
  });

  describe("setAnalyser", () => {
    it("setAnalyser(null) resets bpm and barDuration after manual bpm", async () => {
      const d = new BeatDetector();
      d.bpm = 90;
      d._updateBarDuration();
      expect(d.barDuration).toBeCloseTo((60 / 90) * 4, 5);

      await d.setAnalyser(null);
      expect(d.bpm).toBe(0);
      expect(d.barDuration).toBe(2.0);
      expect(d._lowEnergyAvg).toBe(0);
      expect(d._analyser).toBeNull();
    });
  });

  describe("_updateBarDuration", () => {
    it("sets bar duration from BPM when bpm > 0", () => {
      const d = new BeatDetector();
      d.bpm = 120;
      d._updateBarDuration();
      expect(d.barDuration).toBe(2.0);
    });

    it("uses fallback when bpm is 0", () => {
      const d = new BeatDetector();
      d.bpm = 0;
      d._updateBarDuration();
      expect(d.barDuration).toBe(2.0);
    });
  });

  describe("setupGUI", () => {
    it('creates "Beat Detection" folder with sensitivity control', () => {
      const d = new BeatDetector();
      const addCalls = [];
      const mockFolder = {
        add: vi.fn((obj, key, min, max, step) => {
          addCalls.push({ key, min, max, step });
          return { name: vi.fn().mockReturnValue({ onChange: vi.fn() }) };
        }),
        open: vi.fn(),
      };
      const mockGui = { addFolder: vi.fn(() => mockFolder) };
      d.setupGUI(mockGui);
      expect(mockGui.addFolder).toHaveBeenCalledWith("Beat Detection");
      const sens = addCalls.find((c) => c.key === "sensitivity");
      expect(sens).toEqual({ key: "sensitivity", min: 0.1, max: 3.0, step: 0.1 });
    });
  });
});
