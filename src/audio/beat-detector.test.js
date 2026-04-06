/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreateRealtimeBpmAnalyzer = vi.fn();

vi.mock("realtime-bpm-analyzer", () => ({
  createRealtimeBpmAnalyzer: (...args) => mockCreateRealtimeBpmAnalyzer(...args),
}));

import BeatDetector, { tempoFromBpmPayload } from "./beat-detector.js";

function makeFakeAudioContext() {
  const dest = { kind: "dest" };
  return {
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createGain: vi.fn(() => ({
      gain: { value: 1 },
      connect: vi.fn(function (n) {
        return n;
      }),
      disconnect: vi.fn(),
    })),
    destination: dest,
  };
}

describe("tempoFromBpmPayload", () => {
  it("reads first candidate tempo", () => {
    expect(tempoFromBpmPayload({ bpm: [{ tempo: 128, count: 3 }] })).toBe(128);
  });

  it("returns null for empty bpm array", () => {
    expect(tempoFromBpmPayload({ bpm: [] })).toBeNull();
  });

  it("returns null for missing data", () => {
    expect(tempoFromBpmPayload(null)).toBeNull();
    expect(tempoFromBpmPayload({})).toBeNull();
  });
});

describe("BeatDetector", () => {
  beforeEach(() => {
    mockCreateRealtimeBpmAnalyzer.mockReset();
  });

  describe("constructor", () => {
    it("initializes defaults", () => {
      const d = new BeatDetector();
      expect(d.sensitivity).toBe(1.0);
      expect(d.bpm).toBe(0);
      expect(d.fallbackBpm).toBe(0);
      expect(d.barDuration).toBe(2.0);
      expect(d._lowEnergyAvg).toBe(0);
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

    it("detects a beat when energy spikes above running average", () => {
      const d = new BeatDetector();
      const silent = new Float32Array(256).fill(0);
      for (let i = 0; i < 20; i++) d.update(silent);

      const loud = new Float32Array(256).fill(0);
      for (let i = 0; i < 26; i++) loud[i] = 0.8;
      const out = d.update(loud);
      expect(out.isBeat).toBe(true);
      expect(out.intensity).toBeGreaterThan(0);
    });
  });

  describe("getEffectiveBpm", () => {
    it("prefers worklet BPM over fallback", () => {
      const d = new BeatDetector();
      d.bpm = 120;
      d.fallbackBpm = 90;
      expect(d.getEffectiveBpm()).toBe(120);
    });

    it("uses fallback when worklet BPM is zero", () => {
      const d = new BeatDetector();
      d.bpm = 0;
      d.fallbackBpm = 100;
      expect(d.getEffectiveBpm()).toBe(100);
    });
  });

  describe("setAnalyser + realtime events", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("wires bpm and bpmStable listeners and updates tempo", async () => {
      const listeners = {};
      const fakeCtx = makeFakeAudioContext();
      const fakeAnalyser = {
        context: fakeCtx,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };

      const fakeBpmAnalyzer = {
        node: {},
        reset: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn(function (dest) {
          return dest;
        }),
        on: vi.fn((event, fn) => {
          listeners[event] = fn;
        }),
      };

      mockCreateRealtimeBpmAnalyzer.mockResolvedValue(fakeBpmAnalyzer);

      const d = new BeatDetector();
      await d.setAnalyser(fakeAnalyser);

      expect(mockCreateRealtimeBpmAnalyzer).toHaveBeenCalledWith(fakeCtx);
      expect(listeners.bpm).toBeDefined();
      expect(listeners.bpmStable).toBeDefined();
      expect(fakeAnalyser.connect).toHaveBeenCalledWith(fakeBpmAnalyzer.node);
      expect(fakeBpmAnalyzer.connect).toHaveBeenCalled();

      listeners.bpm({ bpm: [{ tempo: 118, count: 1 }] });
      expect(d.bpm).toBe(118);
      expect(d.barDuration).toBeCloseTo((60 / 118) * 4, 5);

      listeners.bpmStable({ bpm: [{ tempo: 120, count: 2 }] });
      expect(d.bpm).toBe(120);
    });

    it("setAnalyser(null) clears worklet BPM and fallback state", async () => {
      const fakeCtx = makeFakeAudioContext();
      const fakeAnalyser = {
        context: fakeCtx,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      mockCreateRealtimeBpmAnalyzer.mockResolvedValue({
        node: {},
        reset: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn((d) => d),
        on: vi.fn(),
      });

      const d = new BeatDetector();
      await d.setAnalyser(fakeAnalyser);
      d.bpm = 90;
      d.fallbackBpm = 100;
      d._beatTimestamps.push(1, 2, 3);

      await d.setAnalyser(null);
      expect(d.bpm).toBe(0);
      expect(d.fallbackBpm).toBe(0);
      expect(d._beatTimestamps.length).toBe(0);
      expect(d._analyser).toBeNull();
    });
  });

  describe("fallback BPM from onset intervals", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("estimates BPM from spaced energy beats when worklet BPM is 0", () => {
      const d = new BeatDetector();
      const silent = new Float32Array(256).fill(0);
      const loud = new Float32Array(256).fill(0);
      for (let i = 0; i < 26; i++) loud[i] = 0.85;

      for (let i = 0; i < 30; i++) d.update(silent);

      for (let n = 0; n < 12; n++) {
        vi.advanceTimersByTime(500);
        d.update(loud);
        d.update(silent);
      }

      expect(d.bpm).toBe(0);
      expect(d.fallbackBpm).toBeGreaterThanOrEqual(60);
      expect(d.fallbackBpm).toBeLessThanOrEqual(180);
      expect(d.getEffectiveBpm()).toBe(d.fallbackBpm);
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
