import * as THREE from "three";

const TRAIL_LENGTH = 240;

/**
 * Wide arc behind the anchor (like a high pass) with a soft plane-style contrail:
 * elongated billboards aligned to motion, diffuse white–blue streak texture.
 */
export default class Comet {
  constructor({
    speed = 0.13,
    sweep = 16,
    height = 0.5,
    arcHeight = 5,
    depth = 20,
    bankDepth = 2,
  } = {}) {
    this.speed = speed;
    this.sweep = sweep;
    this.height = height;
    this.arcHeight = arcHeight;
    this.depth = depth;
    this.bankDepth = bankDepth;

    this._angle = Math.random() * Math.PI * 2;
    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._anchor = new THREE.Vector3();
    this._spectrumResponse = 1.35;
    this._trailOpacity = 0.52;
    this._glowSize = 2.4;
    this._headScale = 0.055;
    this._color = "#dce8ff";

    this.group = new THREE.Group();

    const headGeo = new THREE.SphereGeometry(0.18, 12, 12);
    this._headMat = new THREE.MeshBasicMaterial({
      color: 0xf0f6ff,
      transparent: true,
      opacity: 0.88,
    });
    this._head = new THREE.Mesh(headGeo, this._headMat);
    this.group.add(this._head);

    const glowTex = new THREE.CanvasTexture(Comet._createGlowTexture());
    this._glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xc8ddff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._glow = new THREE.Sprite(this._glowMat);
    this._glow.scale.setScalar(1.9);
    this._head.add(this._glow);

    this._trailPositions = [];
    this._trailSprites = [];
    const streakTex = new THREE.CanvasTexture(Comet._createContrailStreakTexture());
    this._streakTex = streakTex;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const mat = new THREE.SpriteMaterial({
        map: streakTex,
        color: 0xe8f0ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.85, 0.16, 1);
      this.group.add(sprite);
      this._trailSprites.push(sprite);
      this._trailPositions.push(new THREE.Vector3());
    }

    const startPos = this._computePosition(this._angle);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      this._trailPositions[i].copy(startPos);
      this._trailSprites[i].position.copy(startPos);
    }
  }

  setLoudness(loudness) {
    this._targetBrightness = 0.32 + loudness * this._spectrumResponse;
  }

  setAnchor(worldPos) {
    this._anchor.copy(worldPos);
  }

  /**
   * Smooth arc: horizontal sweep with cos² elevation peak over the anchor,
   * plus a gentle sinusoidal depth “bank” so the path reads as a graceful turn.
   */
  _computePosition(angle) {
    const x = Math.sin(angle) * this.sweep;
    const cross = Math.cos(angle);
    const y = this.height + this.arcHeight * cross * cross;
    const z = -this.depth + this.bankDepth * Math.sin(2 * angle);
    return new THREE.Vector3(this._anchor.x + x, this._anchor.y + y, this._anchor.z + z);
  }

  _segmentRotation(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx * dx + dy * dy < 1e-8) return 0;
    return Math.atan2(dy, dx);
  }

  _shiftTrail(pos) {
    for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
      this._trailPositions[i].copy(this._trailPositions[i - 1]);
    }
    this._trailPositions[0].copy(pos);
  }

  _applyTrailVisuals(b) {
    const pos = this._trailPositions;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const sprite = this._trailSprites[i];
      sprite.position.copy(pos[i]);
      const t = 1 - i / (TRAIL_LENGTH - 1);
      const fade = Math.pow(t, 0.5);
      const spread = 0.28 + fade * 0.42;
      const thin = 0.1 + fade * 0.18;
      sprite.scale.set(spread * (0.95 + b * 0.1), thin, 1);

      let rot;
      if (i < TRAIL_LENGTH - 1) {
        rot = this._segmentRotation(pos[i + 1], pos[i]);
      } else {
        rot = this._segmentRotation(pos[i], pos[i - 1]);
      }
      sprite.material.rotation = rot;

      sprite.material.opacity = fade * b * this._trailOpacity;
    }
  }

  update(dt) {
    this._angle += dt * this.speed;

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const b = Math.min(Math.max(this._brightness, 0.42), 2.0);

    const pos = this._computePosition(this._angle);
    this._head.position.copy(pos);

    this._head.scale.setScalar(this._headScale / 0.18);
    this._headMat.opacity = Math.min(0.5 + b * 0.35, 0.95);
    this._glowMat.opacity = Math.min(b * 0.48, 0.82);
    this._glow.scale.setScalar(this._glowSize * (0.65 + b * 0.35));

    this._shiftTrail(pos);
    this._applyTrailVisuals(b);
  }

  setupGUI(gui) {
    const f = gui.addFolder("Comet");
    f.add(this, "speed", 0.01, 0.5, 0.01).name("Speed");
    f.add(this, "sweep", 5, 80, 1).name("Sweep Width");
    f.add(this, "height", -5, 40, 0.5).name("Height");
    f.add(this, "arcHeight", 0, 28, 0.5).name("Arc Height");
    f.add(this, "depth", 5, 80, 1).name("Depth (behind)");
    f.add(this, "bankDepth", 0, 20, 0.5).name("Bank (depth wobble)");
    f.add(this, "_spectrumResponse", 0.1, 4.0, 0.1).name("Audio Response");
    f.add(this, "_trailOpacity", 0.05, 1.0, 0.01).name("Trail Opacity");
    f.add(this, "_glowSize", 0.5, 8.0, 0.1).name("Glow Size");
    f.add(this, "_headScale", 0.02, 1.0, 0.01).name("Head Size");
    f.addColor(this, "_color").name("Color").onChange((c) => {
      this._headMat.color.set(c);
      this._glowMat.color.set(c);
      for (const s of this._trailSprites) s.material.color.set(c);
    });
    f.add(this.group, "visible").name("Visible");
    f.open();
    return f;
  }

  dispose() {
    this._head.geometry.dispose();
    this._headMat.dispose();
    this._glowMat.map?.dispose();
    this._glowMat.dispose();
    this._streakTex.dispose();
    for (const s of this._trailSprites) s.material.dispose();
  }

  static _createGlowTexture(size = 64) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(235,245,255,1)");
    gradient.addColorStop(0.3, "rgba(180,210,255,0.45)");
    gradient.addColorStop(1, "rgba(140,180,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  /**
   * Long soft horizontal streak (bright core, wide fuzzy edges) for contrail billboards.
   */
  static _createContrailStreakTexture(w = 256, h = 48) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const cx = w * 0.52;
    const cy = h * 0.5;
    for (let pass = 0; pass < 3; pass++) {
      const blur = 6 + pass * 10;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.42 + blur);
      const a = 0.32 - pass * 0.06;
      grd.addColorStop(0, `rgba(255,255,255,${0.7 * (1 - pass * 0.2)})`);
      grd.addColorStop(0.22, `rgba(230,240,255,${a})`);
      grd.addColorStop(0.5, `rgba(200,220,255,${a * 0.65})`);
      grd.addColorStop(1, "rgba(210,225,255,0)");
      ctx.globalCompositeOperation = pass === 0 ? "source-over" : "lighter";
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
    const vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, "rgba(255,255,255,0)");
    vg.addColorStop(0.1, "rgba(255,255,255,0.12)");
    vg.addColorStop(0.5, "rgba(255,255,255,0.22)");
    vg.addColorStop(0.9, "rgba(255,255,255,0.12)");
    vg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = vg;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, w, h);
    return canvas;
  }
}
