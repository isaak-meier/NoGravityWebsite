import { createRealtimeBpmAnalyzer, getBiquadFilter } from "realtime-bpm-analyzer";

export default class BeatDetector {
  constructor({ sensitivity = 1.0 } = {}) {
    this.sensitivity = sensitivity;
    this.bpm = 0;
    this.barDuration = 2.0;
    this._lowEnergyAvg = 0;
    this._lowEnergyAlpha = 0.05;
    this._analyser = null;
    this._bpmAnalyzer = null;
    this._bpmLowpass = null;
    /** @private Prevents stale async BPM init from wiring after a newer setAnalyser */
    this._analyserGeneration = 0;
    this._bpmHandler = (data) => {
      if (data?.bpm?.[0]?.tempo != null) {
        this.bpm = data.bpm[0].tempo;
        this._updateBarDuration();
      }
    };
  }

  _updateBarDuration() {
    if (this.bpm > 0) {
      this.barDuration = (60 / this.bpm) * 4;
    } else {
      this.barDuration = 2.0;
    }
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
    }

    return { isBeat, intensity, barDuration: this.barDuration };
  }

  _teardownBpmAnalyzer() {
    if (this._bpmAnalyzer) {
      try {
        this._bpmAnalyzer.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._bpmAnalyzer = null;
    }
    if (this._bpmLowpass) {
      if (this._analyser) {
        try {
          this._analyser.disconnect(this._bpmLowpass);
        } catch (_) {
          /* ignore */
        }
      }
      try {
        this._bpmLowpass.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._bpmLowpass = null;
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

    const lowpass = getBiquadFilter(ctx, {});
    analyserNode.connect(lowpass);
    lowpass.connect(bpmAnalyzer.node);

    this._bpmLowpass = lowpass;
    this._bpmAnalyzer = bpmAnalyzer;
    bpmAnalyzer.reset();
    bpmAnalyzer.on("bpm", this._bpmHandler);
  }

  /**
   * @param {AnalyserNode | null} analyserNode
   */
  async setAnalyser(analyserNode) {
    const gen = ++this._analyserGeneration;
    this._teardownBpmAnalyzer();

    this._analyser = analyserNode ?? null;
    this.bpm = 0;
    this.barDuration = 2.0;
    this._lowEnergyAvg = 0;

    if (!analyserNode) return;

    const ctx = analyserNode.context;
    const canUseWorklet =
      ctx &&
      typeof ctx.audioWorklet !== "undefined" &&
      typeof ctx.audioWorklet.addModule === "function";

    if (!canUseWorklet) return;

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
