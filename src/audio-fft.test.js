/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import AudioFFT from "./audio-fft.js";

describe("AudioFFT", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("createStream emits normalized FFT frames", () => {
    const fakeAnalyser = {
      frequencyBinCount: 4,
      getByteFrequencyData: (arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i * 64; // 0,64,128,192
      },
    };

    const a = new AudioFFT({ context: {} });
    // inject fake analyser
    a.analyser = fakeAnalyser;
    const stream = a.createStream();
    const spy = vi.fn();
    stream.onData(spy);
    vi.useFakeTimers();
    try {
      stream.start();
      // advance one frame
      vi.advanceTimersByTime(50);
      expect(spy).toHaveBeenCalled();
      const data = spy.mock.calls[0][0];
      expect(data).toBeInstanceOf(Float32Array);
      expect(data.length).toBe(4);
      expect(data[0]).toBeCloseTo(0);
      expect(data[3]).toBeCloseTo((3 * 64) / 255);
    } finally {
      stream.stop();
      vi.useRealTimers();
    }
  });
});
