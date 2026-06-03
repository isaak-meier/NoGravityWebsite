/**
 * Decode helpers + RMS scan to pick the loudest fixed-length (musical bar) windows.
 * Used to gate graph lasers to the top-K loudest 16-bar segments of a track.
 */

/**
 * Channel-average to mono from raw channel arrays (no AudioBuffer). Lets the Web Worker mix
 * transferred channel data without access to the Web Audio API.
 * @param {ArrayLike<number>[]} channels - one Float32Array-like per channel
 * @param {number} length - samples per channel
 * @returns {Float32Array} length === `length`, channel average
 */
export function mixChannelDataToMono(channels, length) {
  const ch = channels.length;
  const out = new Float32Array(length);
  if (ch === 0) return out;
  if (ch === 1) {
    out.set(channels[0]);
    return out;
  }
  for (let c = 0; c < ch; c++) {
    const data = channels[c];
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  const inv = 1 / ch;
  for (let i = 0; i < length; i++) out[i] *= inv;
  return out;
}

/**
 * @param {AudioBuffer} buffer
 * @returns {Float32Array} length === buffer.length, channel average
 */
export function mixAudioBufferToMono(buffer) {
  const ch = buffer.numberOfChannels;
  const channels = [];
  for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));
  return mixChannelDataToMono(channels, buffer.length);
}

/**
 * @param {Float32Array} monoSamples
 * @param {number} sampleRate
 * @param {number} durationSec - clip analysis to this duration (e.g. HTMLMediaElement.duration)
 * @param {number} barDurationSec - one 4/4 bar in seconds
 * @param {number} barsPerChunk - e.g. 16 for sixteen-bar windows
 * @param {number} topK - how many distinct chunk indices to return (e.g. 2)
 * @returns {number[]} ascending chunk indices (0-based along the timeline)
 */
export function findTopLoudestBarChunkIndices(
  monoSamples,
  sampleRate,
  durationSec,
  barDurationSec,
  barsPerChunk,
  topK,
) {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    !Number.isFinite(barDurationSec) ||
    barDurationSec <= 0 ||
    !Number.isFinite(barsPerChunk) ||
    barsPerChunk < 1 ||
    !Number.isFinite(topK) ||
    topK < 1
  ) {
    return [];
  }
  const chunkDuration = barsPerChunk * barDurationSec;
  const chunkSamples = Math.max(1, Math.floor(chunkDuration * sampleRate));
  const totalSamples = Math.min(Math.floor(durationSec * sampleRate), monoSamples.length);
  const nChunks = Math.floor(totalSamples / chunkSamples);
  if (nChunks <= 0) return [];

  /** @type {{ c: number, rms: number }[]} */
  const rows = [];
  for (let c = 0; c < nChunks; c++) {
    const start = c * chunkSamples;
    const end = Math.min(start + chunkSamples, totalSamples);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = monoSamples[i];
      sumSq += v * v;
    }
    const len = end - start;
    const rms = len > 0 ? Math.sqrt(sumSq / len) : 0;
    rows.push({ c, rms });
  }
  rows.sort((a, b) => b.rms - a.rms);
  const out = [];
  for (const row of rows) {
    if (!out.includes(row.c)) out.push(row.c);
    if (out.length >= Math.min(topK, nChunks)) break;
  }
  return out.sort((a, b) => a - b);
}

/**
 * @param {AudioContext} audioContext
 * @param {string} url - same URL as the playing media element (blob: or http(s):)
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudioBufferFromUrl(audioContext, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`decodeAudioBufferFromUrl: fetch failed ${res.status}`);
  const ab = await res.arrayBuffer();
  return audioContext.decodeAudioData(ab.slice(0));
}
