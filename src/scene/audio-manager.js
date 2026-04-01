import AudioFFT from "../audio/audio-fft.js";

class AudioManager {
  constructor() {
    this.stream = null;
    this.fft = null;
    this.audioEl = null;
    this._liveStream = null;
    /** @type {number | null} */
    this._pumpRaf = null;
  }

  _startPumpLoop() {
    this._stopPumpLoop();
    const loop = () => {
      if (!this.stream) {
        this._pumpRaf = null;
        return;
      }
      if (typeof this.stream.pump !== "function") {
        this._pumpRaf = null;
        return;
      }
      this.stream.pump();
      this._pumpRaf = requestAnimationFrame(loop);
    };
    this._pumpRaf = requestAnimationFrame(loop);
  }

  _stopPumpLoop() {
    if (this._pumpRaf != null) {
      cancelAnimationFrame(this._pumpRaf);
      this._pumpRaf = null;
    }
  }

  async toggle() {
    if (!this.audioEl) return false;
    if (this.audioEl.paused) {
      if (this.fft && this.fft.context && this.fft.context.state === "suspended") {
        await this.fft.context.resume();
      }
      await this.audioEl.play();
      if (this.stream) {
        this.stream.start();
        this._startPumpLoop();
      }
      return true;
    }
    this.audioEl.pause();
    if (this.stream) {
      this.stream.stop();
      this._stopPumpLoop();
    }
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

  /**
   * Connect a live MediaStream (microphone or desktop capture) as the
   * audio source. Replaces any previously loaded file source.
   * @param {MediaStream} mediaStream
   * @param {Function} onSpectrum - called each frame with normalised spectrum
   * @param {Function} [onNewSource]
   */
  async loadLiveSource(mediaStream, onSpectrum, onNewSource) {
    this.stop();
    this._liveStream = mediaStream;
    this.audioEl = null; // no file playback for live

    const fft = new AudioFFT({ context: null });
    fft.loadMediaStream(mediaStream);
    this.fft = fft;
    if (onNewSource) onNewSource();

    const stream = fft.createStream();
    stream.onData(onSpectrum);
    stream.start();
    this._startPumpLoop();
    this.stream = stream;
  }

  stopLive() {
    if (this._liveStream) {
      for (const track of this._liveStream.getTracks()) track.stop();
      this._liveStream = null;
    }
  }

  stop() {
    this._stopPumpLoop();
    if (this.stream) {
      this.stream.stop();
      this.stream = null;
    }
    if (this.audioEl) {
      try { this.audioEl.pause(); } catch (_) {}
      this.audioEl = null;
    }
    this.stopLive();
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
