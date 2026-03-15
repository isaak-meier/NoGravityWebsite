import AudioFFT from "../audio/audio-fft.js";

class AudioManager {
  constructor() {
    this.stream = null;
    this.fft = null;
    this.audioEl = null;
  }

  stop() {
    if (this.stream) {
      this.stream.stop();
      this.stream = null;
    }
    if (this.audioEl) {
      try { this.audioEl.pause(); } catch (_) {}
      this.audioEl = null;
    }
  }

  async toggle() {
    if (!this.audioEl) return false;
    if (this.audioEl.paused) {
      if (this.fft && this.fft.context && this.fft.context.state === "suspended") {
        await this.fft.context.resume();
      }
      await this.audioEl.play();
      if (this.stream) this.stream.start();
      return true;
    }
    this.audioEl.pause();
    if (this.stream) this.stream.stop();
    return false;
  }

  async loadSource(source, onSpectrum, onNewSource) {
    this.stop();
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    this.audioEl = AudioManager.createAudioElement(url);
    const fft = new AudioFFT({ audioElement: this.audioEl, context: null });
    try { await fft.load(); } catch (err) { console.warn("AudioFFT.load() failed:", err); }
    this.fft = fft;
    if (onNewSource) onNewSource();
    const stream = fft.createStream();
    stream.onData(onSpectrum);
    this.stream = stream;
  }

  static createAudioElement(src) {
    const el = document.createElement("audio");
    el.src = src;
    el.crossOrigin = "anonymous";
    el.controls = false;
    el.preload = "auto";
    return el;
  }
}

export default AudioManager;
