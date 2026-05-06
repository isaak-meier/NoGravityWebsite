import { describe, it, expect } from "vitest";
import { findTopLoudestBarChunkIndices, mixAudioBufferToMono } from "./laser-chunk-analysis.js";

describe("mixAudioBufferToMono", () => {
  it("averages multiple channels", () => {
    const len = 4;
    const buf = {
      length: len,
      numberOfChannels: 2,
      getChannelData: (c) => {
        const d = new Float32Array(len);
        if (c === 0) d.set([1, 1, 1, 1]);
        else d.set([3, 3, 3, 3]);
        return d;
      },
    };
    const m = mixAudioBufferToMono(buf);
    expect(m[0]).toBeCloseTo(2);
    expect(m[3]).toBeCloseTo(2);
  });
});

describe("findTopLoudestBarChunkIndices", () => {
  it("picks the two loudest distinct 16-bar chunks by RMS", () => {
    const sr = 8000;
    const barDur = 1;
    const barsPerChunk = 16;
    const chunkSamples = Math.floor(sr * barDur * barsPerChunk);
    const nChunks = 4;
    const totalLen = chunkSamples * nChunks;
    const mono = new Float32Array(totalLen);
    for (let c = 0; c < nChunks; c++) {
      const amp = c === 1 || c === 3 ? 1.0 : 0.01;
      const start = c * chunkSamples;
      for (let i = 0; i < chunkSamples; i++) {
        mono[start + i] = i % 2 === 0 ? amp : -amp;
      }
    }
    const idx = findTopLoudestBarChunkIndices(
      mono,
      sr,
      totalLen / sr,
      barDur,
      barsPerChunk,
      2,
    );
    expect(idx).toEqual([1, 3]);
  });

  it("returns [] when duration cannot form one full chunk", () => {
    const sr = 8000;
    const mono = new Float32Array(100);
    mono.fill(0.5);
    const idx = findTopLoudestBarChunkIndices(mono, sr, 0.001, 2, 16, 2);
    expect(idx).toEqual([]);
  });
});
