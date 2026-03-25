import * as THREE from "three";
import ShardShatter from "./shard-shatter.js";

const _up = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Bars between all-shard waves; one shatter animation lasts this many bars. */
const SHATTER_CYCLE_BARS = 8;

export default class PyramidField {
  constructor({
    count = 60,
    orbitRadius = 1.46,
    size = 0.40595,
    rotationSpeed = 0.15,
    shardDrift = 0.05,
    tweenSpeed = 1.0,
    orbitPulseSpeed = 0.3,
    maxSimultaneousShatter = 15,
    beatSensitivity = 1.0,
  } = {}) {
    this.config = {
      count, orbitRadius, size, rotationSpeed, shardDrift,
      tweenSpeed, orbitPulseSpeed, maxSimultaneousShatter, beatSensitivity,
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
    this._orbitMax = 3;
    this._keyframes = null;
    this._tweenTime = 0;
    this._tweenDuration = 1;
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
    });
    this._shards.forEach((s, i) => {
      this._shatter.registerShard(
        i, this._geometry, s.mesh.position, s.mesh.quaternion, s.mesh.scale.x,
      );
    });
    this.group.add(this._shatter.group);
    this._primeShatterTimerForImmediateFirstWave();
  }

  _primeShatterTimerForImmediateFirstWave() {
    this._timeSinceLastShatter = this._barDuration * SHATTER_CYCLE_BARS;
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

  update(deltaTime) {
    this.group.rotation.y += deltaTime * this.config.rotationSpeed;
    const r = this._updateBreathing(deltaTime);
    this._updateShardPositions(r, deltaTime);
    if (this._shatter) {
      this._tickShatterTimer(deltaTime);
      this._syncShatterPositions();
      this._shatter.update(deltaTime, this._barDuration * SHATTER_CYCLE_BARS);
      this._restoreShardVisibilityAfterShatter();
    }
    this._updateKeyframeTween(deltaTime);
  }

  _tickShatterTimer(deltaTime) {
    const period = this._barDuration * SHATTER_CYCLE_BARS;
    this._timeSinceLastShatter += deltaTime;
    if (this._timeSinceLastShatter >= period) {
      this._timeSinceLastShatter -= period;
      this._triggerShatter(0.5);
    }
  }

  _syncShatterPositions() {
    for (let i = 0; i < this._shards.length; i++) {
      if (this._shatter.isShattered(i)) {
        const m = this._shards[i].mesh;
        this._shatter.syncShardTransform(i, m.position, m.quaternion, m.scale.x);
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

  onBeat({ barDuration }) {
    if (barDuration != null) this._barDuration = barDuration;
  }

  _triggerShatter(intensity) {
    for (let i = 0; i < this._shards.length; i++) {
      const m = this._shards[i].mesh;
      this._shatter.syncShardTransform(i, m.position, m.quaternion, m.scale.x);
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
    folder.add(this.config, "orbitRadius", 1.0, 5.0)
      .name("Orbit Radius").onChange(rebind);
    folder.add(this.config, "size", 0.05, 0.5).name("Size").onChange(rebind);
    folder.add(this.config, "rotationSpeed", 0, 2, 0.01).name("Orbit Speed");
    folder.add(this.config, "shardDrift", 0, 1, 0.01).name("Shard Drift");
    folder.add(this.config, "tweenSpeed", 0.1, 5, 0.01).name("Tween Speed");
    folder.add(this.config, "orbitPulseSpeed", 0.05, 2, 0.01)
      .name("Orbit Pulse Speed");
    folder.add(this.config, "maxSimultaneousShatter", 1, 30, 1)
      .name("Max Shatter");
    folder.open();
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
