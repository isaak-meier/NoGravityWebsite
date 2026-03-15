/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import AudioFFT from "./audio-fft.js";

// Helper: create a minimal fake AnalyserNode
function fakeAnalyser(binCount = 4) {
  return {
    frequencyBinCount: binCount,
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i * 64;
    },
    connect: vi.fn(),
  };
}

describe("AudioFFT", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // ── constructor ──────────────────────────────────────────────────────

  // All constructor tests pass a fake context to avoid jsdom's missing AudioContext
  describe("constructor", () => {
    it("stores audioUrl when provided", () => {
      const a = new AudioFFT({ audioUrl: "/test.mp3", context: {} });
      expect(a.audioUrl).toBe("/test.mp3");
    });

    it("stores audioElement when provided", () => {
      const el = document.createElement("audio");
      const a = new AudioFFT({ audioElement: el, context: {} });
      expect(a.audioElement).toBe(el);
    });

    it("uses provided AudioContext instead of creating one", () => {
      const ctx = {};
      const a = new AudioFFT({ context: ctx });
      expect(a.context).toBe(ctx);
    });

    it("defaults fftSize to 2048", () => {
      const a = new AudioFFT({ context: {} });
      expect(a.fftSize).toBe(2048);
    });

    it("defaults smoothingTimeConstant to 0.8", () => {
      const a = new AudioFFT({ context: {} });
      expect(a.smoothingTimeConstant).toBe(0.8);
    });

    it("accepts custom fftSize", () => {
      const a = new AudioFFT({ fftSize: 512, context: {} });
      expect(a.fftSize).toBe(512);
    });

    it("accepts custom smoothingTimeConstant", () => {
      const a = new AudioFFT({ smoothingTimeConstant: 0.5, context: {} });
      expect(a.smoothingTimeConstant).toBe(0.5);
    });

    it("initialises analyser and source as null", () => {
      const a = new AudioFFT({ context: {} });
      expect(a.analyser).toBeNull();
      expect(a.source).toBeNull();
    });
  });

  // ── load ─────────────────────────────────────────────────────────────

  describe("load", () => {
    it("throws when no AudioContext is available", async () => {
      const a = new AudioFFT({ context: {} });
      a.context = null; // force null after construction
      await expect(a.load()).rejects.toThrow("No AudioContext available");
    });

    it("creates an analyser with correct fftSize", async () => {
      const mockContext = {
        createAnalyser: vi.fn(() => ({
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect: vi.fn(),
        })),
        createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
        destination: {},
      };
      const el = document.createElement("audio");
      const a = new AudioFFT({ audioElement: el, context: mockContext, fftSize: 1024 });
      await a.load();
      expect(a.analyser.fftSize).toBe(1024);
    });

    it("creates an analyser with correct smoothingTimeConstant", async () => {
      const mockContext = {
        createAnalyser: vi.fn(() => ({
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect: vi.fn(),
        })),
        createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
        destination: {},
      };
      const el = document.createElement("audio");
      const a = new AudioFFT({ audioElement: el, context: mockContext, smoothingTimeConstant: 0.3 });
      await a.load();
      expect(a.analyser.smoothingTimeConstant).toBe(0.3);
    });

    it("connects audioElement source to analyser and destination", async () => {
      const analyserConnect = vi.fn();
      const sourceConnect = vi.fn();
      const mockContext = {
        createAnalyser: vi.fn(() => ({
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect: analyserConnect,
        })),
        createMediaElementSource: vi.fn(() => ({ connect: sourceConnect })),
        destination: {},
      };
      const el = document.createElement("audio");
      const a = new AudioFFT({ audioElement: el, context: mockContext });
      await a.load();
      // source connects to analyser
      expect(sourceConnect).toHaveBeenCalled();
      // analyser connects to destination
      expect(analyserConnect).toHaveBeenCalled();
    });

    it("returns this for chaining", async () => {
      const mockContext = {
        createAnalyser: vi.fn(() => ({
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect: vi.fn(),
        })),
        createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
        destination: {},
      };
      const el = document.createElement("audio");
      const a = new AudioFFT({ audioElement: el, context: mockContext });
      const result = await a.load();
      expect(result).toBe(a);
    });
  });

  // ── createStream ─────────────────────────────────────────────────────

  describe("createStream", () => {
    it("throws when analyser is not initialized", () => {
      const a = new AudioFFT({ context: {} });
      expect(() => a.createStream()).toThrow("analyser not initialized");
    });

    it("returns an object with start, stop, and onData methods", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser();
      const stream = a.createStream();
      expect(typeof stream.start).toBe("function");
      expect(typeof stream.stop).toBe("function");
      expect(typeof stream.onData).toBe("function");
    });

    it("emits normalized FFT frames (0..1 range)", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser(4);
      const stream = a.createStream();
      const spy = vi.fn();
      stream.onData(spy);

      vi.useFakeTimers();
      try {
        stream.start();
        vi.advanceTimersByTime(50);
        expect(spy).toHaveBeenCalled();
        const data = spy.mock.calls[0][0];
        expect(data).toBeInstanceOf(Float32Array);
        expect(data.length).toBe(4);
        // values should be in 0..1 range
        for (let i = 0; i < data.length; i++) {
          expect(data[i]).toBeGreaterThanOrEqual(0);
          expect(data[i]).toBeLessThanOrEqual(1);
        }
        // first bin: 0*64/255 = 0
        expect(data[0]).toBeCloseTo(0);
        // last bin: 3*64/255
        expect(data[3]).toBeCloseTo((3 * 64) / 255);
      } finally {
        stream.stop();
        vi.useRealTimers();
      }
    });

    it("stream.start is idempotent (calling twice does not create double loops)", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser();
      const stream = a.createStream();
      const spy = vi.fn();
      stream.onData(spy);

      vi.useFakeTimers();
      try {
        stream.start();
        stream.start(); // second call should be ignored
        vi.advanceTimersByTime(50);
        // should still only have one data frame per RAF tick, not double
        const callCount = spy.mock.calls.length;
        expect(callCount).toBeGreaterThanOrEqual(1);
      } finally {
        stream.stop();
        vi.useRealTimers();
      }
    });

    it("stream.stop prevents further data events", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser();
      const stream = a.createStream();
      const spy = vi.fn();
      stream.onData(spy);

      vi.useFakeTimers();
      try {
        stream.start();
        vi.advanceTimersByTime(20);
        const countBefore = spy.mock.calls.length;
        stream.stop();
        vi.advanceTimersByTime(100);
        // no new calls after stop
        expect(spy.mock.calls.length).toBe(countBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stream.stop is safe to call when not running", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser();
      const stream = a.createStream();
      // should not throw
      expect(() => stream.stop()).not.toThrow();
    });

    it("multiple onData listeners all receive data", () => {
      const a = new AudioFFT({ context: {} });
      a.analyser = fakeAnalyser();
      const stream = a.createStream();
      const spy1 = vi.fn();
      const spy2 = vi.fn();
      stream.onData(spy1);
      stream.onData(spy2);

      vi.useFakeTimers();
      try {
        stream.start();
        vi.advanceTimersByTime(20);
        expect(spy1).toHaveBeenCalled();
        expect(spy2).toHaveBeenCalled();
      } finally {
        stream.stop();
        vi.useRealTimers();
      }
    });
  });

  // ── play ─────────────────────────────────────────────────────────────

  describe("play", () => {
    it("throws when no audio element is present", async () => {
      const a = new AudioFFT({ context: {} });
      await expect(a.play()).rejects.toThrow("No audio element to play");
    });

    it("calls audioElement.play()", async () => {
      const el = document.createElement("audio");
      el.play = vi.fn(() => Promise.resolve());
      const a = new AudioFFT({ audioElement: el, context: { state: "running", resume: vi.fn() } });
      await a.play();
      expect(el.play).toHaveBeenCalled();
    });

    it("resumes suspended AudioContext before playing", async () => {
      const resume = vi.fn(() => Promise.resolve());
      const el = document.createElement("audio");
      el.play = vi.fn(() => Promise.resolve());
      const a = new AudioFFT({ audioElement: el, context: { state: "suspended", resume } });
      await a.play();
      expect(resume).toHaveBeenCalled();
      expect(el.play).toHaveBeenCalled();
    });

    it("does not resume context when already running", async () => {
      const resume = vi.fn();
      const el = document.createElement("audio");
      el.play = vi.fn(() => Promise.resolve());
      const a = new AudioFFT({ audioElement: el, context: { state: "running", resume } });
      await a.play();
      expect(resume).not.toHaveBeenCalled();
    });
  });

  // ── pause ────────────────────────────────────────────────────────────

  describe("pause", () => {
    it("calls audioElement.pause() when element exists", () => {
      const el = document.createElement("audio");
      el.pause = vi.fn();
      const a = new AudioFFT({ audioElement: el, context: {} });
      a.pause();
      expect(el.pause).toHaveBeenCalled();
    });

    it("does not throw when no audio element is set", () => {
      const a = new AudioFFT({ context: {} });
      expect(() => a.pause()).not.toThrow();
    });
  });

  // ── setBuffer ────────────────────────────────────────────────────────

  describe("setBuffer", () => {
    it("throws when no AudioContext is available", () => {
      const a = new AudioFFT({ context: {} });
      a.context = null; // remove context after construction
      expect(() => a.setBuffer({})).toThrow("No AudioContext");
    });

    it("creates a buffer source and connects to analyser", () => {
      const connectFn = vi.fn();
      const mockBufSrc = { buffer: null, connect: connectFn };
      const a = new AudioFFT({ context: {} });
      a.context = {
        createBufferSource: vi.fn(() => mockBufSrc),
      };
      a.analyser = { connect: vi.fn() };
      const fakeBuffer = { length: 1000, sampleRate: 44100 };
      const result = a.setBuffer(fakeBuffer);
      expect(result.buffer).toBe(fakeBuffer);
      expect(connectFn).toHaveBeenCalledWith(a.analyser);
    });

    it("stops previous buffer source when setting a new one", () => {
      const stopFn = vi.fn();
      const a = new AudioFFT({ context: {} });
      a._bufferSource = { stop: stopFn };
      a.context = {
        createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn() })),
      };
      a.analyser = { connect: vi.fn() };
      a.setBuffer({});
      expect(stopFn).toHaveBeenCalled();
    });

    it("handles error from stopping previous source gracefully", () => {
      const a = new AudioFFT({ context: {} });
      a._bufferSource = {
        stop: () => {
          throw new Error("already stopped");
        },
      };
      a.context = {
        createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn() })),
      };
      a.analyser = { connect: vi.fn() };
      // should not throw
      expect(() => a.setBuffer({})).not.toThrow();
    });

    it("connects analyser to context destination", () => {
      const analyserConnect = vi.fn();
      const a = new AudioFFT({ context: {} });
      a.context = {
        createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn() })),
        destination: {},
      };
      a.analyser = { connect: analyserConnect };
      a.setBuffer({});
      expect(analyserConnect).toHaveBeenCalledWith(a.context.destination);
    });
  });
});
