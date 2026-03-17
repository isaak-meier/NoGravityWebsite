import * as THREE from "three";

const TRAIL_LENGTH = 160;

/**
 * A comet that sweeps in a wide arc across the top of the screen,
 * positioned behind the planet the camera is following.
 *
 * The path is a horizontal sweep (left ↔ right) at a fixed depth behind
 * the anchor point, with a gentle upward arc so it bows through the
 * upper third of the viewport.
 */
export default class Comet {
  constructor({
    speed = 0.17,
    sweep = 15,
    height = 0,
    arcHeight = 0,
    depth = 22,
  } = {}) {
    this.speed = speed;
    this.sweep = sweep;
    this.height = height;
    this.arcHeight = arcHeight;
    this.depth = depth;

    this._angle = Math.random() * Math.PI * 2;
    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._anchor = new THREE.Vector3();
    this._spectrumResponse = 1.5;
    this._trailOpacity = 0.45;
    this._glowSize = 4.6;
    this._headScale = 0.05;
    this._color = "#aaccff";

    this.group = new THREE.Group();

    // --- Head ---
    const headGeo = new THREE.SphereGeometry(0.2, 10, 10);
    this._headMat = new THREE.MeshBasicMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.95,
    });
    this._head = new THREE.Mesh(headGeo, this._headMat);
    this.group.add(this._head);

    // --- Glow sprite ---
    const glowTex = new THREE.CanvasTexture(Comet._createGlowTexture());
    this._glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xaaccff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._glow = new THREE.Sprite(this._glowMat);
    this._glow.scale.setScalar(3);
    this._head.add(this._glow);

    // --- Trail sprites ---
    this._trailPositions = [];
    this._trailSprites = [];
    const dotTex = new THREE.CanvasTexture(Comet._createDotTexture());
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const mat = new THREE.SpriteMaterial({
        map: dotTex,
        color: 0xbbddff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.15);
      this.group.add(sprite);
      this._trailSprites.push(sprite);
      this._trailPositions.push(new THREE.Vector3());
    }
    this._dotTex = dotTex;

    // Seed trail at starting position
    const startPos = this._computePosition(this._angle);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      this._trailPositions[i].copy(startPos);
      this._trailSprites[i].position.copy(startPos);
    }
  }

  setLoudness(loudness) {
    this._targetBrightness = 0.2 + loudness * this._spectrumResponse;
  }

  setAnchor(worldPos) {
    this._anchor.copy(worldPos);
  }

  /**
   * Wide horizontal sweep behind the planet with a gentle upward arc.
   * X = sweep * sin(angle)            — left ↔ right
   * Y = height + arcHeight * cos(angle)² — peaks when crossing centre
   * Z = -depth                         — fixed distance behind planet
   */
  _computePosition(angle) {
    const x = Math.sin(angle) * this.sweep;
    const cross = Math.cos(angle);
    const y = this.height + this.arcHeight * cross * cross;
    const z = -this.depth;
    return new THREE.Vector3(
      this._anchor.x + x,
      this._anchor.y + y,
      this._anchor.z + z,
    );
  }

  update(dt) {
    this._angle += dt * this.speed;

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const b = Math.min(this._brightness, 2.0);

    const pos = this._computePosition(this._angle);
    this._head.position.copy(pos);

    // Head visuals
    this._head.scale.setScalar(this._headScale / 0.2);
    this._headMat.opacity = Math.min(0.5 + b * 0.5, 1.0);
    this._glowMat.opacity = Math.min(b * 0.45, 0.9);
    this._glow.scale.setScalar(this._glowSize * (0.6 + b));

    // Shift trail: slot 0 = newest (head position)
    for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
      this._trailPositions[i].copy(this._trailPositions[i - 1]);
    }
    this._trailPositions[0].copy(pos);

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const sprite = this._trailSprites[i];
      sprite.position.copy(this._trailPositions[i]);
      const t = 1 - i / (TRAIL_LENGTH - 1);
      const fade = t * t;
      sprite.material.opacity = fade * b * this._trailOpacity;
      sprite.scale.setScalar(0.1 + fade * 0.2 * b);
    }
  }

  setupGUI(gui) {
    const f = gui.addFolder("Comet");
    f.add(this, "speed", 0.01, 0.8, 0.01).name("Speed");
    f.add(this, "sweep", 5, 80, 1).name("Sweep Width");
    f.add(this, "height", 0, 40, 0.5).name("Height");
    f.add(this, "arcHeight", 0, 20, 0.5).name("Arc Height");
    f.add(this, "depth", 5, 80, 1).name("Depth (behind)");
    f.add(this, "_spectrumResponse", 0.1, 4.0, 0.1).name("Audio Response");
    f.add(this, "_trailOpacity", 0.05, 1.0, 0.01).name("Trail Opacity");
    f.add(this, "_glowSize", 0.5, 8.0, 0.1).name("Glow Size");
    f.add(this, "_headScale", 0.05, 1.0, 0.01).name("Head Size");
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
    this._dotTex.dispose();
    for (const s of this._trailSprites) s.material.dispose();
  }

  static _createGlowTexture(size = 64) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(200,225,255,1)");
    gradient.addColorStop(0.25, "rgba(160,200,255,0.5)");
    gradient.addColorStop(1, "rgba(120,170,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  static _createDotTexture(size = 16) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(200,220,255,1)");
    gradient.addColorStop(0.5, "rgba(150,190,255,0.4)");
    gradient.addColorStop(1, "rgba(100,150,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }
}
