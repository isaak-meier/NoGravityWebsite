/**
 * AudioFFT
 *
 * Small helper to load an audio source (URL or HTMLAudioElement) and expose
 * a lightweight stream object that emits FFT frames as `data` CustomEvents.
 *
 * Usage:
 * const a = new AudioFFT({ audioUrl: '/assets/music.mp3' });
 * await a.load();
 * const stream = a.createStream();
 * // stream.onData receives a Float32Array with values normalized 0..1
 * // stream.onData((spectrum) => { console.log(spectrum); });
 * // stream.start();
 */

class FFTStream extends EventTarget {
  constructor(analyser) {
    super();
    this.analyser = analyser;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this._running = false;
    this._raf = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.analyser.getByteFrequencyData(this.data);
      // normalize 0..255 -> 0..1 into Float32Array for convenience
      const out = new Float32Array(this.data.length);
      for (let i = 0; i < this.data.length; i++) out[i] = this.data[i] / 255;
      this.dispatchEvent(new CustomEvent('data', { detail: out }));
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  onData(cb) {
    this.addEventListener('data', (e) => cb(e.detail));
  }
}

export class AudioFFT {
  /**
   * @param {Object} opts
   * @param {string} [opts.audioUrl] - URL to audio file
   * @param {HTMLAudioElement} [opts.audioElement] - existing audio element
   * @param {AudioContext} [opts.context] - optional AudioContext
   * @param {number} [opts.fftSize=2048]
   * @param {number} [opts.smoothingTimeConstant=0.8]
   */
  constructor({ audioUrl = null, audioElement = null, context = null, fftSize = 2048, smoothingTimeConstant = 0.8 } = {}) {
    this.audioUrl = audioUrl;
    this.audioElement = audioElement;
    this.context = context || (typeof window !== 'undefined' ? new (window.AudioContext || window.webkitAudioContext)() : null);
    this.fftSize = fftSize;
    this.smoothingTimeConstant = smoothingTimeConstant;
    this.analyser = null;
    this.source = null;
    this._bufferSource = null;
  }

  /**
   * Load the audio (if URL provided) and create the analyser + source.
   * If an `audioElement` was passed it will be used; otherwise, a hidden
   * audio element will be created for the provided `audioUrl`.
   */
  async load() {
    if (!this.context) throw new Error('No AudioContext available');

    if (!this.audioElement && this.audioUrl) {
      const el = document.createElement('audio');
      el.src = this.audioUrl;
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      // don't autoplay by default
      await new Promise((resolve) => {
        const onReady = () => {
          el.removeEventListener('canplaythrough', onReady);
          resolve();
        };
        el.addEventListener('canplaythrough', onReady);
        // as a fallback resolve after metadata loads
        el.addEventListener('loadedmetadata', onReady);
      });
      this.audioElement = el;
    }

    // create analyser
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

    // connect source
    if (this.audioElement) {
      // ensure element is connected to context
      // Create a MediaElementSource only once
      if (!this.source) this.source = this.context.createMediaElementSource(this.audioElement);
      this.source.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    } else {
      // no element; user may provide BufferSource via setBufferSource
    }

    return this;
  }

  /**
   * Create and return a stream object that emits normalized FFT frames.
   * The returned object supports `start()`, `stop()`, and `onData(cb)`.
   */
  createStream() {
    if (!this.analyser) throw new Error('AudioFFT: analyser not initialized. Call load() first.');
    return new FFTStream(this.analyser);
  }

  /**
   * If you want to play the loaded audio element via this helper.
   */
  async play() {
    if (!this.audioElement) throw new Error('No audio element to play');
    // resume context on user gesture if needed
    if (this.context.state === 'suspended') await this.context.resume();
    return this.audioElement.play();
  }

  pause() {
    if (this.audioElement) this.audioElement.pause();
  }

  /**
   * Accept a decoded AudioBuffer and create a buffer source connected to analyser.
   */
  setBuffer(audioBuffer) {
    if (!this.context) throw new Error('No AudioContext');
    if (this._bufferSource) {
      try { this._bufferSource.stop(); } catch (e) {}
    }
    const bufSrc = this.context.createBufferSource();
    bufSrc.buffer = audioBuffer;
    bufSrc.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this._bufferSource = bufSrc;
    return bufSrc;
  }
}

export default AudioFFT;
