import * as THREE from "/node_modules/three/build/three.module.js";

// Number of frequency bands each pyramid cluster is split into.
// Lower bands → larger triangles near the base, higher bands → smaller ones at the tip.
const BANDS = 8;

export default class PyramidField {
  constructor({ count = 12, orbitRadius = 1.46, size = 0.40595, rotationSpeed = 0.15, shardSpin = 0.25, tweenSpeed = 1.0, orbitPulseSpeed = 0.3 } = {}) {
    this.config = { count, orbitRadius, size, rotationSpeed, shardSpin, tweenSpeed, orbitPulseSpeed };
    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    // Each entry: { anchor: THREE.Group, shards: THREE.Mesh[], basePositions: Float32Array[], dir: THREE.Vector3 }
    this._clusters = [];
    this._geometries = [];
    this._spectrum = null;
    this._orbitTime = 0;
    this._orbitMin = 1;
    this._orbitMax = 3;
    this._introRadius = 80;
    this._introActive = true;
    this._introLerpSpeed = 2.;
    this._spectrumSmoothing = 0.08;
    // Keyframe tween state
    this._keyframes = null; // array of pre-computed shard states per keyframe
    this._tweenTime = 0;
    this._tweenDuration = 1; // seconds per keyframe transition (overridden by setKeyframes)
    this.rebuild();
  }

  rebuild() {
    // Dispose previous
    this._disposeContents();
    this._introActive = true;

    const { count: n, orbitRadius: r, size } = this.config;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const up = new THREE.Vector3(0, 1, 0);

    // Pre-create one shared geometry per band (large → small)
    this._geometries = [];
    for (let b = 0; b < BANDS; b++) {
      const t = b / (BANDS - 1); // 0 = base (low), 1 = tip (high)
      const bandSize = size * (1.0 - t * 0.8); // base shards are full size, tip shards 20%
      const geo = new THREE.ConeGeometry(bandSize * 0.4, bandSize, 3);
      this._geometries.push(geo);
    }

    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
      const rY = Math.sqrt(1 - y * y);
      const theta = golden * i;
      const sx = Math.cos(theta) * rY;
      const sz = Math.sin(theta) * rY;
      const dir = new THREE.Vector3(sx, y, sz).normalize();

      // Anchor group positioned on the orbit sphere, oriented outward
      const anchor = new THREE.Group();
      anchor.position.set(sx * r, y * r, sz * r);
      anchor.quaternion.setFromUnitVectors(up, dir);
      this.group.add(anchor);

      const shards = [];
      const basePositions = [];

      for (let b = 0; b < BANDS; b++) {
        const t = b / (BANDS - 1);
        // How many shards in this band: 1 at base, more towards tip
        const shardCount = 1 + Math.floor(t * 4);
        const bandRadius = size * 0.3 * (1.0 + t * 0.6);
        const bandHeight = size * 0.2 + t * size * 0.8; // stack upward along local Y

        for (let s = 0; s < shardCount; s++) {
          const angle = (s / shardCount) * Math.PI * 2 + b * 0.5;
          const jitter = (Math.random() - 0.5) * bandRadius * 0.4;
          const lx = Math.cos(angle) * bandRadius + (Math.random() - 0.5) * jitter;
          const lz = Math.sin(angle) * bandRadius + (Math.random() - 0.5) * jitter;
          const ly = bandHeight + (Math.random() - 0.5) * size * 0.1;

          const mesh = new THREE.Mesh(this._geometries[b], this.material);
          mesh.position.set(lx, ly, lz);
          mesh.userData.band = b;
          mesh.userData.spinDir = Math.random() > 0.5 ? 1 : -1;
          mesh.userData.spinMult = 0.7 + Math.random() * 0.6;

          basePositions.push(new Float32Array([lx, ly, lz]));
          anchor.add(mesh);
          shards.push(mesh);
        }
      }

      this._clusters.push({ anchor, shards, basePositions, dir: dir.clone() });
    }
  }

  /**
   * Apply FFT spectrum data. Each frequency band drives the displacement of
   * its corresponding shard tier outward from the pyramid centre.
   * @param {Float32Array|number[]} spectrum - normalised 0-1 frequency data
   */
  applySpectrum(spectrum) {
    this._spectrum = spectrum;
    if (!spectrum || spectrum.length === 0) {
      this._targetSpread = 0;
      return;
    }

    const len = spectrum.length;
    const bandEnergies = new Float32Array(BANDS);
    let totalEnergy = 0;
    for (let b = 0; b < BANDS; b++) {
      const start = Math.floor((b / BANDS) * len);
      const end = Math.floor(((b + 1) / BANDS) * len);
      let sum = 0;
      for (let j = start; j < end; j++) sum += spectrum[j];
      bandEnergies[b] = sum / Math.max(1, end - start);
      totalEnergy += bandEnergies[b];
    }

    const { size } = this.config;
    const lerp = this._spectrumSmoothing;
    for (const cluster of this._clusters) {
      const { shards, basePositions } = cluster;
      for (let s = 0; s < shards.length; s++) {
        const mesh = shards[s];
        const bp = basePositions[s];
        const b = mesh.userData.band;
        const energy = bandEnergies[b];
        const force = energy * size * 1.8;
        const tx = bp[0] + (bp[0] === 0 ? 0 : Math.sign(bp[0]) * force);
        const tz = bp[2] + (bp[2] === 0 ? 0 : Math.sign(bp[2]) * force);
        const ty = bp[1] + force * (1 + b / BANDS);
        // Smoothly interpolate toward target instead of snapping
        mesh.position.x += (tx - mesh.position.x) * lerp;
        mesh.position.y += (ty - mesh.position.y) * lerp;
        mesh.position.z += (tz - mesh.position.z) * lerp;
        const targetRx = energy * Math.PI * 0.15;
        const targetRz = energy * Math.PI * 0.1 * (s % 2 === 0 ? 1 : -1);
        mesh.rotation.x += (targetRx - mesh.rotation.x) * lerp;
        mesh.rotation.z += (targetRz - mesh.rotation.z) * lerp;
        const sc = 1.0 + energy * 0.35;
        const curSc = mesh.scale.x;
        mesh.scale.setScalar(curSc + (sc - curSc) * lerp);
      }
    }
  }

  /**
   * Pre-compute shard target states for each keyframe spectrum.
   * Immediately applies the first keyframe so shards don't sit at base positions.
   * @param {Float32Array[]} spectra - array of normalised 0-1 FFT snapshots
   * @param {number} [songDuration=0] - total song duration in seconds; tween
   *   transitions are spread evenly across it. Falls back to 3s/keyframe.
   */
  setKeyframes(spectra, songDuration = 0) {
    if (!spectra || spectra.length === 0) { this._keyframes = null; return; }
    const count = spectra.length;
    if (songDuration > 0 && count > 1) {
      this._tweenDuration = songDuration / count;
    } else {
      this._tweenDuration = 3;
    }
    const { size } = this.config;
    this._keyframes = spectra.map((spectrum) => {
      const len = spectrum.length;
      const bandEnergies = new Float32Array(BANDS);
      for (let b = 0; b < BANDS; b++) {
        const start = Math.floor((b / BANDS) * len);
        const end = Math.floor(((b + 1) / BANDS) * len);
        let sum = 0;
        for (let j = start; j < end; j++) sum += spectrum[j];
        bandEnergies[b] = sum / Math.max(1, end - start);
      }
      // Compute target state for every shard in every cluster
      const clusters = this._clusters.map((cluster) => {
        return cluster.shards.map((mesh, s) => {
          const bp = cluster.basePositions[s];
          const b = mesh.userData.band;
          const energy = bandEnergies[b];
          const force = energy * size * 1.8;
          const dx = bp[0] === 0 ? 0 : Math.sign(bp[0]) * force;
          const dz = bp[2] === 0 ? 0 : Math.sign(bp[2]) * force;
          const dy = force * (1 + b / BANDS);
          return {
            px: bp[0] + dx, py: bp[1] + dy, pz: bp[2] + dz,
            rx: energy * Math.PI * 0.15,
            rz: energy * Math.PI * 0.1 * (s % 2 === 0 ? 1 : -1),
            sc: 1.0 + energy * 0.35,
          };
        });
      });
      return clusters;
    });
    this._tweenTime = 0;

    // Immediately apply keyframe 0 so pyramids don't sit at base positions
    if (this._keyframes.length > 0) {
      const kf0 = this._keyframes[0];
      for (let c = 0; c < this._clusters.length; c++) {
        const shards = this._clusters[c].shards;
        const states = kf0[c];
        for (let s = 0; s < shards.length; s++) {
          const mesh = shards[s];
          const st = states[s];
          mesh.position.set(st.px, st.py, st.pz);
          mesh.rotation.x = st.rx;
          mesh.rotation.z = st.rz;
          mesh.scale.setScalar(st.sc);
        }
      }
    }
  }

  update(deltaTime) {
    this.group.rotation.y += deltaTime * this.config.rotationSpeed;

    // Oscillate orbit radius between _orbitMin and _orbitMax
    this._orbitTime += deltaTime * this.config.orbitPulseSpeed;
    const t01 = (Math.sin(this._orbitTime) + 1) * 0.5; // 0..1
    const targetR = this._orbitMin + (this._orbitMax - this._orbitMin) * t01;

    let r;
    if (this._introActive) {
      this._introRadius += (targetR - this._introRadius) * this._introLerpSpeed * deltaTime;
      if (Math.abs(this._introRadius - targetR) < 0.05) {
        this._introActive = false;
      }
      r = this._introRadius;
    } else {
      r = targetR;
    }
    for (const cluster of this._clusters) {
      cluster.anchor.position.set(
        cluster.dir.x * r,
        cluster.dir.y * r,
        cluster.dir.z * r,
      );
    }

    // Spin each shard around its local Y axis
    for (const cluster of this._clusters) {
      for (const mesh of cluster.shards) {
        mesh.rotation.y += deltaTime * this.config.shardSpin
          * mesh.userData.spinDir * mesh.userData.spinMult;
      }
    }

    // Tween between keyframes if available
    if (!this._keyframes || this._keyframes.length < 2) return;
    this._tweenTime += deltaTime * this.config.tweenSpeed;
    const count = this._keyframes.length;
    const totalDuration = count * this._tweenDuration;
    const loopTime = this._tweenTime % totalDuration;
    const rawIdx = loopTime / this._tweenDuration;
    const idxA = Math.floor(rawIdx) % count;
    const idxB = (idxA + 1) % count;
    const t = rawIdx - Math.floor(rawIdx); // 0..1 between keyframes
    // Smooth ease in-out
    const ease = t * t * (3 - 2 * t);

    const kfA = this._keyframes[idxA];
    const kfB = this._keyframes[idxB];
    for (let c = 0; c < this._clusters.length; c++) {
      const shards = this._clusters[c].shards;
      const a = kfA[c];
      const b = kfB[c];
      for (let s = 0; s < shards.length; s++) {
        const mesh = shards[s];
        const sa = a[s], sb = b[s];
        mesh.position.set(
          sa.px + (sb.px - sa.px) * ease,
          sa.py + (sb.py - sa.py) * ease,
          sa.pz + (sb.pz - sa.pz) * ease,
        );
        mesh.rotation.x = sa.rx + (sb.rx - sa.rx) * ease;
        mesh.rotation.z = sa.rz + (sb.rz - sa.rz) * ease;
        mesh.scale.setScalar(sa.sc + (sb.sc - sa.sc) * ease);
      }
    }
  }

  setupGUI(gui) {
    const folder = gui.addFolder("Pyramids");
    const rebind = () => this.rebuild();
    folder.add(this.config, "count", 1, 200, 1).name("Count").onChange(rebind);
    folder.add(this.config, "orbitRadius", 1.0, 5.0).name("Orbit Radius").onChange(rebind);
    folder.add(this.config, "size", 0.05, 0.5).name("Size").onChange(rebind);
    folder.add(this.config, "rotationSpeed", 0, 2, 0.01).name("Orbit Speed");
    folder.add(this.config, "shardSpin", 0, 5, 0.01).name("Shard Spin");
    folder.add(this.config, "tweenSpeed", 0.1, 5, 0.01).name("Tween Speed");
    folder.add(this.config, "orbitPulseSpeed", 0.05, 2, 0.01).name("Orbit Pulse Speed");
    folder.open();
    return folder;
  }

  _disposeContents() {
    for (const cluster of this._clusters) {
      cluster.anchor.parent?.remove(cluster.anchor);
    }
    this._clusters = [];
    for (const geo of this._geometries) geo.dispose();
    this._geometries = [];
  }

  dispose() {
    this._disposeContents();
    this.material.dispose();
  }
}
