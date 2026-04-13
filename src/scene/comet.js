import * as THREE from "three";
import { COMET_HEAD_BASE_RADIUS, createCometHeadStyleMesh } from "./comet-head-mesh.js";

const TRAIL_LENGTH = 480;

/**
 * Gentle parabolic path behind the anchor with soft gas-cloud sprites along the path.
 */
export default class Comet {
  constructor({
    /** Radians per second along the path parameter (lower = slower crossing). */
    speed = 0.2,
    sweep = 16,
    height = 0.5,
    arcHeight = 5,
    /** Depth offset along world −Z from anchor (tail behind head). */
    depth = 20,
    bankDepth = 2,
  } = {}) {
    this.speed = speed;
    this.sweep = sweep;
    this.height = height;
    this.arcHeight = arcHeight;
    this.depth = depth;
    this.bankDepth = bankDepth;

    /** Path phase: 0 ⇒ u=0 ⇒ x = −sweep (left end of parabola before crossing). */
    this._angle = 0;
    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._anchor = new THREE.Vector3();
    this._spectrumResponse = 1.35;
    /** 0 = trail ignores beat; 1 = full `b` like before. */
    this._trailBeatResponsiveness = 0.28;
    this._trailOpacity = 0.52;
    this._glowSize = 2.4;
    this._headScale = 0.055;
    this._color = "#dce8ff";

    this.group = new THREE.Group();
    this._trailPositions = [];
    this._trailSprites = [];
    /** @type {number[]} fixed random Z rotation per trail sprite (symmetric puffs, varied orientation) */
    this._trailSpriteRotations = [];
    this._trailCloudTex = null;

    /** Drawn after trail sprites so the nucleus stays visible at the tip (higher = later). */
    this.headRenderOrder = 1;
    /**
     * Over this many indices from the head, trail width blends from **head diameter** to full fan width.
     * (Not an opacity-only fade — geometry matches the nucleus at the neck.)
     */
    this.trailTipFadeSamples = 28;

    this._trailColorNear = new THREE.Color(0xf8fbff);
    this._trailColorFar = new THREE.Color(0x6eb8ff);

    /** When true, arc angle does not advance (freeze motion for inspection). */
    this.motionPaused = false;

    this._initHead();
    this._initTrail();
  }

  _initHead() {
    const { mesh, material } = createCometHeadStyleMesh(this._headScale, 0xf0f6ff, {
      icosahedronDetail: 0,
    });
    this._head = mesh;
    this._headMat = material;
    this._head.renderOrder = this.headRenderOrder;
    this.group.add(this._head);
  }

  _initGlow() {
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
  }

  _initTrail() {
    this._trailCloudTex = new THREE.CanvasTexture(Comet._createGasCloudTexture());
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._trailCloudTex,
        color: 0xe8f0ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.2, 0.2, 1);
      sprite.renderOrder = Math.max(0, this.headRenderOrder - 1);
      this._trailSpriteRotations.push(Math.random() * Math.PI * 2);
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
   * @param {THREE.Vector3} target
   * @returns {THREE.Vector3}
   */
  getHeadWorldPosition(target) {
    return this._head.getWorldPosition(target);
  }

  /** World-space radius of the head for camera min-orbit distance (matches scaled sphere). */
  getFollowOrbitRadius() {
    return this._headScale;
  }

  /**
   * One parabolic crossing per 2π of `angle`. Path is **world-anchored** only (does not depend on the camera).
   * u=0 → left end; u=1 → right end (local X); Y = height + parabola; Z = behind anchor.
   * @param {number} angle
   */
  _computePosition(angle) {
    const period = Math.PI * 2;
    let a = angle % period;
    if (a < 0) a += period;
    const u = a / period;
    const horiz = (u - 0.5) * 2 * this.sweep;
    const parabola = this.arcHeight * 4 * u * (1 - u);
    const vert = this.height + parabola;
    const depthLegacy = -this.depth + this.bankDepth * Math.sin(Math.PI * u);
    return new THREE.Vector3(
      this._anchor.x + horiz,
      this._anchor.y + vert,
      this._anchor.z + depthLegacy
    );
  }

  _shiftTrail(pos) {
    for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
      this._trailPositions[i].copy(this._trailPositions[i - 1]);
    }
    this._trailPositions[0].copy(pos);
  }

  _applyTrailVisuals(b) {
    const k = THREE.MathUtils.clamp(this._trailBeatResponsiveness, 0, 1);
    const bTrail = 1 + (b - 1) * k;
    const pos = this._trailPositions;
    const neckBlendEnd = Math.max(1, this.trailTipFadeSamples);
    const tailFanBoost = 1.38;
    /** Matches icosa head diameter in world units (`createCometHeadStyleMesh` world radius = `_headScale`). */
    const headDiameter = 2 * this._headScale;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const sprite = this._trailSprites[i];
      sprite.position.copy(pos[i]);
      sprite.renderOrder = Math.max(0, this.headRenderOrder - 1);

      const t = 1 - i / (TRAIL_LENGTH - 1);
      const fadeLinear = t;
      const tail = 1 - fadeLinear;

      const uNeck = THREE.MathUtils.clamp(i / neckBlendEnd, 0, 1);
      const neckBlend = uNeck * uNeck * (3 - 2 * uNeck);

      const puffBase =
        (0.1 + fadeLinear * 0.32 + tail * 0.58 * tailFanBoost) *
        (0.92 + bTrail * 0.12);
      const spreadW = 1 + tail * 0.52;
      const spreadH = 1 + tail * 0.22;
      const fanW = puffBase * spreadW;
      const fanH = puffBase * spreadH;
      const sx = THREE.MathUtils.lerp(headDiameter, fanW, neckBlend);
      const sy = THREE.MathUtils.lerp(headDiameter, fanH, neckBlend);
      sprite.scale.set(sx, sy, 1);
      sprite.material.rotation = this._trailSpriteRotations[i];

      sprite.material.color.copy(this._trailColorNear).lerp(this._trailColorFar, tail);

      sprite.material.opacity = fadeLinear * bTrail * this._trailOpacity;
    }
  }

  update(dt) {
    if (!this.motionPaused) {
      this._angle += dt * this.speed;
    }

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const b = Math.min(Math.max(this._brightness, 0.42), 2.0);

    const pos = this._computePosition(this._angle);
    this._head.position.copy(pos);
    this._head.renderOrder = this.headRenderOrder;

    this._head.scale.setScalar(this._headScale / COMET_HEAD_BASE_RADIUS);
    this._headMat.opacity = Math.min(0.5 + b * 0.35, 0.95);
    if (this._glowMat) {
      this._glowMat.opacity = Math.min(b * 0.48, 0.82);
      this._glow.scale.setScalar(this._glowSize * (0.65 + b * 0.35));
    }

    if (this._trailSprites.length) {
      this._shiftTrail(pos);
      this._applyTrailVisuals(b);
    }
  }

  setupGUI(gui) {
    const f = gui.addFolder("Comet");
    f.add(this, "headRenderOrder", 0, 4, 1).name("Head draw order");
    f.add(this, "trailTipFadeSamples", 4, 120, 1).name("Neck width blend (samples)");
    f.open();
    return f;
  }

  dispose() {
    this._head.geometry.dispose();
    this._headMat.dispose();
    if (this._glowMat) {
      this._glowMat.map?.dispose();
      this._glowMat.dispose();
    }
    this._trailCloudTex?.dispose();
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
   * Soft overlapping gas blobs (no head-style glow core — trail stays softer).
   */
  static _createGasCloudTexture(size = 128) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const blobs = [
      { x: 0.5, y: 0.48, r: 0.44, a: 0.28 },
      { x: 0.36, y: 0.56, r: 0.3, a: 0.22 },
      { x: 0.64, y: 0.52, r: 0.27, a: 0.2 },
      { x: 0.48, y: 0.34, r: 0.22, a: 0.17 },
      { x: 0.58, y: 0.38, r: 0.16, a: 0.14 },
    ];
    for (const b of blobs) {
      const cx = size * b.x;
      const cy = size * b.y;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * b.r);
      grd.addColorStop(0, `rgba(248,252,255,${b.a})`);
      grd.addColorStop(0.38, `rgba(215,232,255,${b.a * 0.5})`);
      grd.addColorStop(0.72, `rgba(190,215,255,${b.a * 0.22})`);
      grd.addColorStop(1, "rgba(180,210,255,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, size, size);
    }
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  }
}
