/**
 * Module Web Worker: keeps the graph-laser "loudest bar windows" analysis off the main thread.
 *
 * The previous main-thread path mixed every sample of a decoded song to mono and ran a full RMS
 * scan, re-firing whenever the detected bar duration drifted >3% mid-playback — tens of ms of
 * blocking work plus a ~15 MB allocation, i.e. visible stutter. Here the heavy work runs in the
 * worker: 'load' mixes channels → mono once and caches it; 'analyze' re-scans the cached mono for
 * a given bar duration (cheap, no re-mix or re-transfer).
 *
 * Messages
 *   main → worker  { type: 'load',    gen, channels: ArrayBuffer[], length, sampleRate }
 *   main → worker  { type: 'analyze', gen, durationSec, barDurationSec, barsPerChunk, topK }
 *   worker → main  { type: 'result',  gen, indices: number[] }
 *
 * `gen` is the decode generation; stale messages (gen ≠ the currently loaded gen) are ignored so a
 * late analyze for a replaced track can't apply.
 */
import {
  mixChannelDataToMono,
  findTopLoudestBarChunkIndices,
} from "./laser-chunk-analysis.js";

/** @type {{ gen: number, mono: Float32Array | null, sampleRate: number }} */
const cur = { gen: -1, mono: null, sampleRate: 0 };

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === "load") {
    const channels = msg.channels.map((buf) => new Float32Array(buf));
    cur.gen = msg.gen;
    cur.sampleRate = msg.sampleRate;
    cur.mono = mixChannelDataToMono(channels, msg.length);
    return;
  }

  if (msg.type === "analyze") {
    if (msg.gen !== cur.gen || !cur.mono) return; // stale or not loaded
    const indices = findTopLoudestBarChunkIndices(
      cur.mono,
      cur.sampleRate,
      msg.durationSec,
      msg.barDurationSec,
      msg.barsPerChunk,
      msg.topK,
    );
    self.postMessage({ type: "result", gen: msg.gen, indices });
  }
};
