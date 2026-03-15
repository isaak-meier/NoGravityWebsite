/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../audio/audio-fft.js', () => {
  class FakeFFT {
    constructor() { this.context = { state: 'running', resume: vi.fn() }; }
    async load() {}
    createStream() {
      return { onData: vi.fn(), start: vi.fn(), stop: vi.fn() };
    }
  }
  return { default: FakeFFT };
});

import AudioManager from './audio-manager.js';

describe('AudioManager', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  describe('constructor', () => {
    it('initialises stream, fft, audioEl as null', () => {
      const am = new AudioManager();
      expect(am.stream).toBeNull();
      expect(am.fft).toBeNull();
      expect(am.audioEl).toBeNull();
    });
  });

  describe('stop', () => {
    it('stops stream and pauses audioEl', () => {
      const am = new AudioManager();
      const st = { stop: vi.fn() };
      am.stream = st;
      am.audioEl = { pause: vi.fn() };
      am.stop();
      expect(st.stop).toHaveBeenCalled();
      expect(am.stream).toBeNull();
      expect(am.audioEl).toBeNull();
    });

    it('handles missing stream/audioEl gracefully', () => {
      const am = new AudioManager();
      expect(() => am.stop()).not.toThrow();
    });

    it('swallows audioEl.pause() errors', () => {
      const am = new AudioManager();
      am.audioEl = { pause: () => { throw new Error('fail'); } };
      expect(() => am.stop()).not.toThrow();
      expect(am.audioEl).toBeNull();
    });
  });

  describe('toggle', () => {
    it('returns false when audioEl is null', async () => {
      const am = new AudioManager();
      expect(await am.toggle()).toBe(false);
    });

    it('plays paused audio and returns true', async () => {
      const am = new AudioManager();
      am.audioEl = { paused: true, play: vi.fn().mockResolvedValue(undefined) };
      am.stream = { start: vi.fn(), stop: vi.fn() };
      expect(await am.toggle()).toBe(true);
      expect(am.audioEl.play).toHaveBeenCalled();
      expect(am.stream.start).toHaveBeenCalled();
    });

    it('resumes suspended AudioContext before playing', async () => {
      const am = new AudioManager();
      const resume = vi.fn().mockResolvedValue(undefined);
      am.fft = { context: { state: 'suspended', resume } };
      am.audioEl = { paused: true, play: vi.fn().mockResolvedValue(undefined) };
      am.stream = { start: vi.fn(), stop: vi.fn() };
      await am.toggle();
      expect(resume).toHaveBeenCalled();
    });

    it('pauses playing audio and returns false', async () => {
      const am = new AudioManager();
      am.audioEl = { paused: false, pause: vi.fn() };
      am.stream = { start: vi.fn(), stop: vi.fn() };
      expect(await am.toggle()).toBe(false);
      expect(am.audioEl.pause).toHaveBeenCalled();
      expect(am.stream.stop).toHaveBeenCalled();
    });
  });

  describe('loadSource', () => {
    it('sets audioEl, fft, and stream', async () => {
      const am = new AudioManager();
      const onSpectrum = vi.fn();
      await am.loadSource('test.mp3', onSpectrum);
      expect(am.audioEl).not.toBeNull();
      expect(am.fft).not.toBeNull();
      expect(am.stream).not.toBeNull();
    });

    it('calls onNewSource callback', async () => {
      const am = new AudioManager();
      const cb = vi.fn();
      await am.loadSource('test.mp3', vi.fn(), cb);
      expect(cb).toHaveBeenCalled();
    });

    it('stops previous source before loading', async () => {
      const am = new AudioManager();
      const old = { stop: vi.fn() };
      am.stream = old;
      am.audioEl = { pause: vi.fn() };
      await am.loadSource('test.mp3', vi.fn());
      expect(old.stop).toHaveBeenCalled();
    });

    it('handles Blob input via createObjectURL', async () => {
      const fakeUrl = 'blob:http://localhost/fake';
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue(fakeUrl);
      const am = new AudioManager();
      await am.loadSource(new Blob(['data']), vi.fn());
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
      expect(am.audioEl.src).toContain('blob:');
    });
  });

  describe('createAudioElement', () => {
    it('returns an audio element with correct attributes', () => {
      const el = AudioManager.createAudioElement('song.mp3');
      expect(el.tagName).toBe('AUDIO');
      expect(el.src).toContain('song.mp3');
      expect(el.crossOrigin).toBe('anonymous');
      expect(el.controls).toBe(false);
      expect(el.preload).toBe('auto');
    });
  });
});
