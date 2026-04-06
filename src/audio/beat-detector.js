import { createRealtimeBpmAnalyzer } from "realtime-bpm-analyzer";

/** Min seconds between logged onset beats (fallback BPM), ~375 BPM max. */
const MIN_BEAT_GAP_SEC = 0.16;

/**
 * @param {unknown} data - payload from realtime-bpm-analyzer `bpm` / `bpmStable`
 * @returns {number | null}
 */
export function tempoFromBpmPayload(data) {
  const list = data?.bpm;
  if (!Array.isArray(list) || list.length === 0) return null;
  const t = list[0]?.tempo;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
}

export default class BeatDetector {
  constructor({ sensitivity = 1.0 } = {}) {
    this.sensitivity = sensitivity;
    /** BPM from realtime-bpm-analyzer (AudioWorklet). */
    this.bpm = 0;
    this.barDuration = 2.0;
    this._lowEnergyAvg = 0;
    this._lowEnergyAlpha = 0.05;
    this._analyser = null;
    this._bpmAnalyzer = null;
    /** Keeps the worklet in the render graph (gain 0 → speakers). */
    this._bpmSilentGain = null;
    /** @private Prevents stale async BPM init from wiring after a newer setAnalyser */
    this._analyserGeneration = 0;

    /** Seconds, for onset-interval fallback when worklet BPM is still 0. */
    this._beatTimestamps = [];
    this._lastBeatTimeSec = null;
    /** Estimated from energy onsets; used when {@link #bpm} is 0. */
    this.fallbackBpm = 0;

    this._onRealtimeBpmPayload = (data) => {
      const t = tempoFromBpmPayload(data);
      if (t != null) {
        this.bpm = t;
        this._updateBarDuration();
      }
    };
  }

  _updateBarDuration() {
    const effective = this.getEffectiveBpm();
    if (effective > 0) {
      this.barDuration = (60 / effective) * 4;
    } else {
      this.barDuration = 2.0;
    }
  }

  /**
   * Worklet BPM if available, otherwise {@link #fallbackBpm} from onset spacing.
   * @returns {number}
   */
  getEffectiveBpm() {
    if (this.bpm > 0) return this.bpm;
    if (this.fallbackBpm > 0) return this.fallbackBpm;
    return 0;
  }

  /**
   * @param {Float32Array | null | undefined} fftData
   * @returns {{ isBeat: boolean, intensity: number, barDuration: number }}
   */
  update(fftData) {
    if (fftData == null || fftData.length === 0) {
      return { isBeat: false, intensity: 0, barDuration: this.barDuration };
    }

    const lowBins = Math.max(1, Math.ceil(fftData.length * 0.1));
    let energy = 0;
    for (let i = 0; i < lowBins; i++) {
      energy += fftData[i];
    }
    energy /= lowBins;

    const avgBefore = this._lowEnergyAvg;
    const threshold = avgBefore * (1 + 0.5 * this.sensitivity);
    this._lowEnergyAvg =
      this._lowEnergyAlpha * energy + (1 - this._lowEnergyAlpha) * avgBefore;

    const isBeat = energy > threshold && energy > 0.05;

    let intensity = 0;
    if (isBeat) {
      if (threshold > 0) {
        intensity = Math.min(1, Math.max(0, (energy - threshold) / threshold));
      } else {
        intensity = Math.min(1, Math.max(0, energy));
      }
      this._recordOnsetForFallbackBpm();
    }

    if (this.bpm <= 0) {
      this._updateBarDuration();
    }

    return { isBeat, intensity, barDuration: this.barDuration };
  }

  _recordOnsetForFallbackBpm() {
    const t = performance.now() * 0.001;
    if (this._lastBeatTimeSec != null && t - this._lastBeatTimeSec < MIN_BEAT_GAP_SEC) {
      return;
    }
    this._lastBeatTimeSec = t;
    this._beatTimestamps.push(t);
    if (this._beatTimestamps.length > 32) {
      this._beatTimestamps.shift();
    }
    if (this._beatTimestamps.length < 4) {
      this.fallbackBpm = 0;
      return;
    }
    const ivals = [];
    for (let i = 1; i < this._beatTimestamps.length; i++) {
      const dt = this._beatTimestamps[i] - this._beatTimestamps[i - 1];
      if (dt > 0.2 && dt < 2.0) {
        ivals.push(dt);
      }
    }
    if (ivals.length < 3) {
      this.fallbackBpm = 0;
      return;
    }
    ivals.sort((a, b) => a - b);
    const mid = ivals[Math.floor(ivals.length / 2)];
    let est = 60 / mid;
    while (est < 72) est *= 2;
    while (est > 190) est /= 2;
    this.fallbackBpm = Math.round(Math.min(180, Math.max(60, est)));
  }

  _teardownBpmAnalyzer() {
    if (this._bpmSilentGain) {
      try {
        this._bpmSilentGain.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._bpmSilentGain = null;
    }
    if (this._bpmAnalyzer) {
      try {
        this._bpmAnalyzer.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._bpmAnalyzer = null;
    }
  }

  async _installBpmSidechain(analyserNode, gen) {
    const ctx = analyserNode.context;
    const bpmAnalyzer = await createRealtimeBpmAnalyzer(ctx);
    if (gen !== this._analyserGeneration) {
      try {
        bpmAnalyzer.disconnect();
      } catch (_) {
        /* ignore */
      }
      return;
    }

    // Library quick-start: source → analyzer.node (see readme). Lowpass optional; direct tap matches docs.
    analyserNode.connect(bpmAnalyzer.node);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    bpmAnalyzer.connect(gain);
    gain.connect(ctx.destination);
    this._bpmSilentGain = gain;

    this._bpmAnalyzer = bpmAnalyzer;
    bpmAnalyzer.reset();
    bpmAnalyzer.on("bpm", this._onRealtimeBpmPayload);
    bpmAnalyzer.on("bpmStable", this._onRealtimeBpmPayload);
  }

  /**
   * @param {AnalyserNode | null} analyserNode
   */
  async setAnalyser(analyserNode) {
    const gen = ++this._analyserGeneration;
    this._teardownBpmAnalyzer();

    this._analyser = analyserNode ?? null;
    this.bpm = 0;
    this.fallbackBpm = 0;
    this._beatTimestamps = [];
    this._lastBeatTimeSec = null;
    this.barDuration = 2.0;
    this._lowEnergyAvg = 0;

    if (!analyserNode) return;

    const ctx = analyserNode.context;
    const canUseWorklet =
      ctx &&
      typeof ctx.audioWorklet !== "undefined" &&
      typeof ctx.audioWorklet.addModule === "function";

    if (!canUseWorklet) {
      console.warn("BeatDetector: AudioWorklet unavailable; BPM uses onset fallback only.");
      return;
    }

    try {
      await this._installBpmSidechain(analyserNode, gen);
    } catch (err) {
      console.warn("BeatDetector: realtime BPM analyzer unavailable", err);
    }
  }

  /**
   * @param {import('lil-gui').GUI} gui
   */
  setupGUI(gui) {
    const folder = gui.addFolder("Beat Detection");
    folder.add(this, "sensitivity", 0.1, 3.0, 0.1);
    folder.open();
    return folder;
  }
}
