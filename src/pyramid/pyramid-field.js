import * as THREE from "three";
import ShardShatter, {
  FRAGMENTS_PER_LEVEL,
  intensityToDepth,
} from "./shard-shatter.js";
import FragmentPatternCoordinator from "./fragment-pattern-coordinator.js";
import {
  PATTERN_SPHERE,
  PATTERN_RING,
  PATTERN_GALAXY,
  PATTERN_DRIFT,
} from "./fragment-pattern-math.js";

const _up = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Bars between all-shard waves; one shatter animation lasts this many bars. */
export const SHATTER_CYCLE_BARS = 8;
/** Bars per automatic pattern rotation (Rings → Swirl → Field → Drift → …). */
export const PATTERN_CYCLE_BARS = 32;

const PATTERN_CYCLE_ORDER = [
  PATTERN_RING,
  PATTERN_GALAXY,
  PATTERN_SPHERE,
  PATTERN_DRIFT,
];

/**
 * Which {@link PyramidField} `patternMode` to use for a given song bar index (32-bar cycle).
 * @param {number} barIndex
 * @returns {number}
 */
export function patternModeForBar(barIndex) {
  const n = PATTERN_CYCLE_ORDER.length;
  const i = Math.floor(barIndex / PATTERN_CYCLE_BARS) % n;
  return PATTERN_CYCLE_ORDER[i];
}

export default class PyramidField {
  constructor({
    count = 60,
    orbitRadius = 1.46,
    /** Orbit scale when the shatter pattern is fully formed (ramps from {@link orbitRadius} during the pattern phase). */
    patternOrbitRadius = 5,
    size = 0.40595,
    rotationSpeed = 0.035,
    shardDrift = 0.05,
    tweenSpeed = 1.0,
    orbitPulseSpeed = 0.3,
    maxSimultaneousShatter = 15,
    beatSensitivity = 1.0,
    /** 0 = pyramids only (no shatter wave); 1 = max fragments + expansion. */
    shatterAmount = 1,
    /** When false, shatter timer / simulation / triggers are skipped (pyramids only). */
    shatterSubsystemEnabled = true,
    /** 0 Field · 1 Rings · 2 Swirls · 3 Drift */
    patternMode = 0,
    /** When true, fragments stay at the pattern pose until the next shatter wave (no return phase). */
    holdPatternPhase = true,
    pattern = {},
  } = {}) {
    this.config = {
      count, orbitRadius, patternOrbitRadius, size, rotationSpeed, shardDrift,
      tweenSpeed, orbitPulseSpeed, maxSimultaneousShatter, beatSensitivity,
      shatterAmount,
      shatterSubsystemEnabled,
      patternMode,
      holdPatternPhase,
      pattern: {
        ringRadiusScale: 1,
        ringAzimuthJitter: 0.14,
        ringRadialJitter: 0.045,
        ringVerticalJitter: 0.04,
        galaxyBulgeFrac: 0.12,
        galaxyBulgeRadius: 0.9,
        galaxyArmInner: 0.72,
        galaxyRadialFloor: 0.72,
        galaxyArmOuter: 1.15,
        galaxySpiralTightness: 0.11,
        galaxyArmSweepTurns: 5.2,
        galaxyVerticalAmplitude: 0.38,
        galaxyVerticalWobbleTurns: 2.85,
        ...pattern,
      },
    };
    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    this._shards = [];
    this._geometry = null;
    this._shatter = null;
    this._barDuration = 2.0;
    this._spectrum = null;
    this._spectrumSmoothing = 0.08;
    this._orbitTime = 0;
    this._orbitMin = 1.5;
    /** Breathing sine peaks here (see `_updateBreathing`). */
    this._orbitMax = 5;
    this._keyframes = null;
    this._tweenTime = 0;
    this._tweenDuration = 1;
    this._shatterWaveIndex = 0;
    this._patternCoordinator = new FragmentPatternCoordinator();
    /** @type {number} BPM from BeatDetector when known; 0 = use wall-clock shatter timer. */
    this._bpm = 0;
    this._virtualSongTime = 0;
    /** Next shatter on downbeat of this bar index (multiples of {@link SHATTER_CYCLE_BARS}). */
    this._nextWaveAtBar = SHATTER_CYCLE_BARS;
    this._previousBarIndex = -1;
    /** @type {number | null} File `currentTime` when playing; else virtual time. */
    this._audioCurrentTimeForClock = null;
    this._hudSongTime = 0;
    this._hudBarIndex = 0;
    /** Set when `update` receives `musicClock` from the scene (file / live timing). */
    this._hasMusicClock = false;
    this.rebuild();
  }

  rebuild() {
    this._disposeContents();
    const { count, size } = this.config;
    this._geometry = new THREE.ConeGeometry(size * 0.4, size, 3);
    for (let i = 0; i < count; i++) {
      this._addShard(i, count);
    }
    this._shatter = new ShardShatter({
      maxShards: count,
      material: this.material,
      patternCoordinator: this._patternCoordinator,
    });
    this._shards.forEach((s, i) => {
      this._shatter.registerShard(
        i, this._geometry, s.mesh.position, s.mesh.quaternion, s.mesh.scale.x,
      );
    });
    this.group.add(this._shatter.group);
    this._resetShatterMusicClock();
  }

  /** Call when a new audio source loads so bar index aligns with the track. */
  resetMusicClock() {
    this._resetShatterMusicClock();
  }

  _resetShatterMusicClock() {
    this._timeSinceLastShatter = 0;
    this._virtualSongTime = 0;
    this._nextWaveAtBar = SHATTER_CYCLE_BARS;
    this._previousBarIndex = -1;
    this._audioCurrentTimeForClock = null;
    this._hudSongTime = 0;
    this._hudBarIndex = 0;
    this._hasMusicClock = false;
  }

  /**
   * Debug HUD: BPM, bar position, and time until the next shatter wave.
   * @returns {{ bpm: number | null, barIndex: number, nextWaveAtBar: number, secondsUntilWave: number, mode: 'musical' | 'wall' }}
   */
  getShatterClockHud() {
    const period = this._barDuration * SHATTER_CYCLE_BARS;
    if (this._hasMusicClock && this._barDuration > 0) {
      const sec = Math.max(0, this._nextWaveAtBar * this._barDuration - this._hudSongTime);
      return {
        bpm: this._bpm > 0 ? this._bpm : null,
        barIndex: this._hudBarIndex,
        nextWaveAtBar: this._nextWaveAtBar,
        secondsUntilWave: sec,
        mode: this._bpm > 0 ? "musical" : "wall",
      };
    }
    return {
      bpm: null,
      barIndex: 0,
      nextWaveAtBar: this._nextWaveAtBar,
      secondsUntilWave: Math.max(0, period - this._timeSinceLastShatter),
      mode: "wall",
    };
  }

  _addShard(i, count) {
    const { orbitRadius } = this.config;
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const rY = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    const dir = new THREE.Vector3(
      Math.cos(theta) * rY, y, Math.sin(theta) * rY,
    ).normalize();

    const mesh = new THREE.Mesh(this._geometry, this.material);
    mesh.quaternion.setFromUnitVectors(_up, dir);
    mesh.position.copy(dir).multiplyScalar(orbitRadius);

    const sizeMult = 0.7 + Math.random() * 0.6;
    mesh.scale.setScalar(sizeMult);
    const driftDir = Math.random() > 0.5 ? 1 : -1;
    const driftMult = 0.7 + Math.random() * 0.6;

    this._shards.push({ mesh, dir, sizeMult, driftDir, driftMult });
    this.group.add(mesh);
  }

  /**
   * @param {number} deltaTime
   * @param {object} [musicClock]
   * @param {number} [musicClock.bpm]
   * @param {number} [musicClock.barDuration] — one bar in seconds (from BeatDetector)
   * @param {number | null} [musicClock.audioCurrentTime] — HTMLMediaElement.currentTime when playing a file; null for mic / no transport
   */
  update(deltaTime, musicClock = null) {
    const prevBpm = this._bpm;
    if (musicClock != null) {
      this._hasMusicClock = true;
      if (musicClock.barDuration != null && musicClock.barDuration > 0) {
        this._barDuration = musicClock.barDuration;
      }
      if (musicClock.bpm != null && musicClock.bpm >= 0) {
        this._bpm = musicClock.bpm;
      }
      this._audioCurrentTimeForClock =
        musicClock.audioCurrentTime != null && Number.isFinite(musicClock.audioCurrentTime)
          ? musicClock.audioCurrentTime
          : null;
      this._sampleSongTimeForHud(deltaTime);
      if (this._barDuration > 0) {
        this.config.patternMode = patternModeForBar(this._hudBarIndex);
      }
    }

    if (prevBpm === 0 && this._bpm > 0 && this._barDuration > 0) {
      const st =
        this._audioCurrentTimeForClock != null && this._audioCurrentTimeForClock >= 0
          ? this._audioCurrentTimeForClock
          : this._virtualSongTime;
      const bi = Math.floor(st / this._barDuration);
      this._previousBarIndex = -1;
      this._nextWaveAtBar = Math.max(
        SHATTER_CYCLE_BARS,
        Math.ceil(bi / SHATTER_CYCLE_BARS) * SHATTER_CYCLE_BARS,
      );
    }

    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.group.rotation.y += deltaTime * this.config.rotationSpeed;
    const r = this._updateBreathing(deltaTime);
    this._updateShardPositions(r, deltaTime);
    if (this._shatter && this.config.shatterSubsystemEnabled) {
      this._tickShatterTimer(deltaTime);
      this._syncShatterPositions(deltaTime);
      this._shatter.holdPatternPhase = this.config.holdPatternPhase;
      this._shatter.update(deltaTime, this._barDuration * SHATTER_CYCLE_BARS);
      this._restoreShardVisibilityAfterShatter();
    }
    this._updateKeyframeTween(deltaTime);
  }

  /**
   * Song phase for HUD (and musical shatter): one virtual-time advance per frame when no file clock.
   * Must run whenever `musicClock` is passed, even if BPM is still 0 or shatter is disabled.
   */
  _sampleSongTimeForHud(deltaTime) {
    const barDur = this._barDuration;
    if (!(barDur > 0)) return;

    let songTime;
    if (this._audioCurrentTimeForClock != null && this._audioCurrentTimeForClock >= 0) {
      songTime = this._audioCurrentTimeForClock;
    } else {
      this._virtualSongTime += deltaTime;
      songTime = this._virtualSongTime;
    }

    this._hudSongTime = songTime;
    this._hudBarIndex = Math.floor(songTime / barDur);
  }

  _tickShatterTimer(deltaTime) {
    if (this.config.shatterAmount <= 0) return;
    if (this._bpm > 0 && this._barDuration > 0) {
      this._tickShatterTimerMusical(deltaTime);
    } else {
      this._tickShatterTimerWall(deltaTime);
    }
  }

  /** Downbeat-aligned: fire when the song crosses into bar `nextWaveAtBar` (from audio time or virtual time). */
  _tickShatterTimerMusical(deltaTime) {
    const barDur = this._barDuration;
    if (!(barDur > 0)) return;

    const barIndex = this._hudBarIndex;

    if (barIndex !== this._previousBarIndex) {
      if (barIndex >= this._nextWaveAtBar) {
        this._triggerShatter();
        this._nextWaveAtBar =
          Math.floor(barIndex / SHATTER_CYCLE_BARS) * SHATTER_CYCLE_BARS + SHATTER_CYCLE_BARS;
      }
      this._previousBarIndex = barIndex;
    }
  }

  /** Fallback when BPM unknown: wall-clock period = barDuration × SHATTER_CYCLE_BARS. */
  _tickShatterTimerWall(deltaTime) {
    const period = this._barDuration * SHATTER_CYCLE_BARS;
    if (!(period > 0)) return;
    this._timeSinceLastShatter += deltaTime;
    if (this._timeSinceLastShatter < period) return;
    this._timeSinceLastShatter %= period;
    this._triggerShatter();
  }

  _syncShatterPositions(deltaTime) {
    for (let i = 0; i < this._shards.length; i++) {
      if (this._shatter.isShattered(i)) {
        const m = this._shards[i].mesh;
        this._shatter.syncShardTransform(i, m.position, m.quaternion, m.scale.x, deltaTime);
      }
    }
  }

  _restoreShardVisibilityAfterShatter() {
    for (let i = 0; i < this._shards.length; i++) {
      const shard = this._shards[i];
      if (!this._shatter.isShattered(i) && !shard.mesh.visible) {
        shard.mesh.visible = true;
        shard.mesh.scale.setScalar(shard.sizeMult);
      }
    }
  }

  /**
   * Optional; main scene passes {@link musicClock} every frame via `update`.
   * Kept for tests and callers that only have beat info from the audio thread.
   */
  onBeat({ barDuration, bpm }) {
    if (barDuration != null && barDuration > 0) {
      const oldPeriod = this._barDuration * SHATTER_CYCLE_BARS;
      this._barDuration = barDuration;
      const newPeriod = barDuration * SHATTER_CYCLE_BARS;
      if (this._bpm <= 0 && oldPeriod > 0 && newPeriod > 0) {
        this._timeSinceLastShatter *= newPeriod / oldPeriod;
      }
    }
    if (bpm != null && bpm >= 0) {
      this._bpm = bpm;
    }
  }

  /** Start a full shatter wave immediately (e.g. user tapped the planet on mobile). */
  triggerManualShatter() {
    if (!this.config.shatterSubsystemEnabled) return;
    this._triggerShatter();
  }

  _triggerShatter() {
    if (!this.config.shatterSubsystemEnabled) return;
    const intensity = this.config.shatterAmount;
    if (intensity <= 0) return;
    const depth = intensityToDepth(intensity);
    const fragPerShard = FRAGMENTS_PER_LEVEL[depth - 1];
    this._shatterWaveIndex += 1;
    const patternId = this.config.patternMode;
    const center = new THREE.Vector3(0, 0, 0);
    this._patternCoordinator.beginWave({
      waveIndex: this._shatterWaveIndex,
      patternId,
      center,
      params: {
        ...this.config.pattern,
        orbitRadius: this.config.patternOrbitRadius,
        orbitRadiusBurst: this.config.orbitRadius,
      },
    });
    for (let i = 0; i < this._shards.length; i++) {
      this._patternCoordinator.registerShard(i, fragPerShard);
    }
    this._patternCoordinator.finalizeWave();

    for (let i = 0; i < this._shards.length; i++) {
      const m = this._shards[i].mesh;
      this._shatter.syncShardTransform(i, m.position, m.quaternion, m.scale.x, null);
      m.visible = false;
      this._shatter.triggerShatter(i, intensity);
    }
  }

  _updateBreathing(deltaTime) {
    this._orbitTime += deltaTime * this.config.orbitPulseSpeed;
    const t01 = (Math.sin(this._orbitTime) + 1) * 0.5;
    return this._orbitMin + (this._orbitMax - this._orbitMin) * t01;
  }

  _updateShardPositions(r, deltaTime) {
    const { shardDrift } = this.config;
    for (const shard of this._shards) {
      shard.mesh.position.copy(shard.dir).multiplyScalar(r);
      shard.mesh.rotation.y +=
        deltaTime * shardDrift * shard.driftDir * shard.driftMult;
    }
  }

  _updateKeyframeTween(deltaTime) {
    if (!this._keyframes || this._keyframes.length < 2) return;
    this._tweenTime += deltaTime * this.config.tweenSpeed;
    const total = this._keyframes.length - 1;
    const rawIdx = this._tweenTime / this._tweenDuration;
    const idx = Math.min(Math.floor(rawIdx), total - 1);
    const frac = Math.min(rawIdx - idx, 1);
    const from = this._keyframes[idx];
    const to = this._keyframes[Math.min(idx + 1, total)];
    const { size } = this.config;
    const lerp = this._spectrumSmoothing;
    for (let i = 0; i < this._shards.length; i++) {
      if (this._shatter?.isShattered?.(i)) continue;
      const energy = from[i] + (to[i] - from[i]) * frac;
      applySpectrumToShard(this._shards[i], energy, size, lerp);
    }
  }

  applySpectrum(spectrum) {
    this._spectrum = spectrum;
    if (!spectrum || spectrum.length === 0) return;
    const { size } = this.config;
    const lerp = this._spectrumSmoothing;
    const len = spectrum.length;
    for (let i = 0; i < this._shards.length; i++) {
      if (this._shatter?.isShattered?.(i)) continue;
      const energy = bandEnergyForShard(i, this._shards.length, spectrum, len);
      applySpectrumToShard(this._shards[i], energy, size, lerp);
    }
  }

  setKeyframes(spectra, songDuration = 0) {
    if (!spectra || spectra.length === 0) {
      this._keyframes = null;
      return;
    }
    const count = spectra.length;
    if (songDuration > 0 && count > 1) {
      this._tweenDuration = songDuration / count;
    } else {
      this._tweenDuration = 3;
    }
    const shardCount = this._shards.length;
    this._keyframes = spectra.map(s =>
      buildPerShardEnergies(shardCount, s),
    );
    this._tweenTime = 0;
  }

  setupGUI(gui) {
    const folder = gui.addFolder("Pyramids");
    const rebind = () => this.rebuild();
    folder.add(this.config, "count", 1, 200, 1).name("Count").onChange(rebind);
    folder.add(this.config, "orbitRadius", 1.0, 10.0)
      .name("Orbit radius (shell)").onChange(rebind);
    folder.add(this.config, "patternOrbitRadius", 1.0, 12.0, 0.01)
      .name("Pattern orbit (locked)");
    folder.add(this.config, "size", 0.05, 0.5).name("Size").onChange(rebind);
    folder.add(this.config, "rotationSpeed", 0, 2, 0.01).name("Orbit Speed");
    folder.add(this.config, "shardDrift", 0, 1, 0.01).name("Shard Drift");
    folder.add(this.config, "tweenSpeed", 0.1, 5, 0.01).name("Tween Speed");
    folder.add(this.config, "orbitPulseSpeed", 0.05, 2, 0.01)
      .name("Orbit Pulse Speed");
    folder.add(this.config, "maxSimultaneousShatter", 1, 30, 1)
      .name("Max Shatter");
    folder.add(this.config, "shatterAmount", 0, 1, 0.01).name("Shatter amount");
    folder.add(this.config, "patternMode", 0, 3, 1).name("Pattern (0–3)");
    folder.open();

    const pat = this.config.pattern;
    const patternFolder = gui.addFolder("Shatter pattern");
    patternFolder.add(this.config, "holdPatternPhase")
      .name("Hold pattern (no return)");
    patternFolder.add(pat, "ringRadiusScale", 0.5, 2.0, 0.01)
      .name("Ring band scale");
    patternFolder.add(pat, "ringAzimuthJitter", 0, 0.5, 0.01)
      .name("Ring azimuth jitter");
    patternFolder.add(pat, "ringRadialJitter", 0, 0.15, 0.005)
      .name("Ring radial jitter");
    patternFolder.add(pat, "ringVerticalJitter", 0, 0.2, 0.005)
      .name("Ring thickness (Y)");
    patternFolder.add(pat, "galaxyBulgeFrac", 0.02, 0.35, 0.01)
      .name("Galaxy bulge %");
    patternFolder.add(pat, "galaxyBulgeRadius", 0.55, 1.12, 0.01)
      .name("Galaxy bulge outer");
    patternFolder.add(pat, "galaxyRadialFloor", 0.55, 0.92, 0.01)
      .name("Galaxy min radius");
    patternFolder.add(pat, "galaxyArmInner", 0.55, 0.95, 0.01)
      .name("Galaxy arm inner");
    patternFolder.add(pat, "galaxyArmOuter", 0.5, 2.0, 0.01)
      .name("Galaxy arm outer");
    patternFolder.add(pat, "galaxySpiralTightness", 0.04, 0.35, 0.01)
      .name("Galaxy spiral tight");
    patternFolder.add(pat, "galaxyArmSweepTurns", 2, 12, 0.1)
      .name("Galaxy arm turns");
    patternFolder.add(pat, "galaxyVerticalAmplitude", 0, 0.85, 0.01)
      .name("Galaxy 3D height");
    patternFolder.add(pat, "galaxyVerticalWobbleTurns", 0.5, 8, 0.05)
      .name("Galaxy 3D wobble");
    patternFolder.open();

    return folder;
  }

  _disposeContents() {
    if (this._shatter) {
      this._shatter.dispose();
      if (this._shatter.group) this.group.remove(this._shatter.group);
      this._shatter = null;
    }
    for (const shard of this._shards) {
      shard.mesh.parent?.remove(shard.mesh);
    }
    this._shards = [];
    if (this._geometry) {
      this._geometry.dispose();
      this._geometry = null;
    }
  }

  dispose() {
    this._disposeContents();
    this.material.dispose();
  }
}

function bandEnergyForShard(shardIndex, shardCount, spectrum, len) {
  const bandStart = Math.floor((shardIndex / shardCount) * len);
  const bandEnd = Math.floor(((shardIndex + 1) / shardCount) * len);
  const start = Math.min(bandStart, len - 1);
  const end = Math.max(bandEnd, start + 1);
  let sum = 0;
  for (let j = start; j < end && j < len; j++) sum += spectrum[j];
  return sum / Math.max(1, end - start);
}

function buildPerShardEnergies(shardCount, spectrum) {
  const len = spectrum.length;
  const energies = new Float32Array(shardCount);
  for (let i = 0; i < shardCount; i++) {
    energies[i] = bandEnergyForShard(i, shardCount, spectrum, len);
  }
  return energies;
}

function applySpectrumToShard(shard, energy, size, lerp) {
  const { mesh, dir, sizeMult } = shard;
  const targetScale = sizeMult * (1.0 + energy * 0.08);
  const curScale = mesh.scale.x;
  mesh.scale.setScalar(curScale + (targetScale - curScale) * lerp);
  const push = energy * size * 0.3 * lerp;
  mesh.position.x += dir.x * push;
  mesh.position.y += dir.y * push;
  mesh.position.z += dir.z * push;
}
