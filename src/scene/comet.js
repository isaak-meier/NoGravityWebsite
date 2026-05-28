import * as THREE from "three";
import { COMET_HEAD_BASE_RADIUS, createCometHeadStyleMesh } from "./comet-head-mesh.js";

/** Pre-allocated trail sprites; pool grows if the comet outlives this count. */
const TRAIL_INITIAL_POOL = 480 * 2;

/** One full arc from ingress to egress in path parameter space (then straight outbound). */
const ARC_PERIOD = Math.PI * 2;

/**
 * Highly eccentric pass around the sun: nucleus, coma glow, and a tail that points
 * **away from the sun** (not opposite velocity). Brightness follows inverse-square
 * solar distance (perihelion peak).
 */
export default class Comet {
  constructor({
    /** Path parameter advance (radians/s); lower = slower pass. */
    speed = 0.5,
    /** Orbital eccentricity (0.9–0.99 ≈ long-period comet; ≥1 hyperbolic escape). */
    eccentricity = 0.96,
    /** Closest approach to sun center (world units). */
    perihelionDistance = 42,
    /** Polar angle (rad) at path start — far inbound leg. */
    thetaIngress = -2.35,
    /** Polar angle (rad) at end of curved leg — hands off to outbound cruise. */
    thetaEgress = 2.45,
    /** World units traveled along outbound asymptote per unit u beyond 1. */
    outboundUnitsPerArc = 90,
  } = {}) {
    this.speed = speed;
    this.eccentricity = eccentricity;
    this.perihelionDistance = perihelionDistance;
    this.thetaIngress = thetaIngress;
    this.thetaEgress = thetaEgress;
    this.outboundUnitsPerArc = outboundUnitsPerArc;

    this._semiLatus = perihelionDistance * (1 + eccentricity);

    /** Path phase (radians); monotonic — no looping. */
    this._angle = 0;
    this._sun = new THREE.Vector3(150, 0, 0);
    this._posScratch = new THREE.Vector3();
    this._sunRelScratch = new THREE.Vector3();
    this._tangentScratch = new THREE.Vector3();
    this._antiSunScratch = new THREE.Vector3();
    this._perpScratch = new THREE.Vector3();
    this._puffScratch = new THREE.Vector3();

    /** Orbital plane: sun → constellation (roughly −X), with a sky arc in +Y. */
    this._orbitAxisX = new THREE.Vector3(-1, 0, 0);
    this._orbitAxisY = new THREE.Vector3(0, 0.88, 0.22).normalize();

    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._spectrumResponse = 0.35;
    this._solarFlux = 1;
    this._trailBeatResponsiveness = 0.28;
    this._trailOpacity = 0.52;
    /** Per-second fade for deposited trail puffs (0 = no fade). */
    this.trailFadeRate = 0.02;
    this._glowSize = 2.4;
    this._headScale = 0.055;

    this.group = new THREE.Group();
    this._trailSprites = [];
    /** @type {number[]} seconds since each puff was emitted */
    this._trailSpriteAges = [];
    /** @type {number[]} peak opacity locked in at emit time */
    this._trailSpritePeak = [];
    this._trailEmitCount = 0;
    this._trailCloudTex = null;

    this.headRenderOrder = 1;
    this.trailTipFadeSamples = 28;

    this._trailColorNear = new THREE.Color(0xf8fbff);
    this._trailColorFar = new THREE.Color(0x6eb8ff);

    this.motionPaused = false;

    this._initHead();
    this._initGlow();
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
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._glow = new THREE.Sprite(this._glowMat);
    this._glow.scale.setScalar(1.9);
    this._head.add(this._glow);
  }

  _initTrail() {
    this._trailCloudTex = new THREE.CanvasTexture(Comet._createGasCloudTexture());
    for (let i = 0; i < TRAIL_INITIAL_POOL; i++) {
      this._createTrailSprite();
    }
  }

  _createTrailSprite() {
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
    sprite.visible = false;
    sprite.renderOrder = Math.max(0, this.headRenderOrder - 1);
    this.group.add(sprite);
    this._trailSprites.push(sprite);
    this._trailSpriteAges.push(0);
    this._trailSpritePeak.push(0);
    return sprite;
  }

  setLoudness(loudness) {
    this._targetBrightness = 0.15 + loudness * this._spectrumResponse;
  }

  setSunWorldPosition(worldPos) {
    this._sun.copy(worldPos);
  }

  getHeadWorldPosition(target) {
    return this._head.getWorldPosition(target);
  }

  getFollowOrbitRadius() {
    return this._headScale;
  }

  /**
   * @param {number} theta
   * @param {THREE.Vector3} target sun-relative position
   */
  _positionOnArc(theta, target) {
    const e = this.eccentricity;
    const cosT = Math.cos(theta);
    const denom = 1 + e * cosT;
    const r = denom > 1e-4 ? this._semiLatus / denom : this._semiLatus * 4;
    const sinT = Math.sin(theta);
    const x = this._orbitAxisX;
    const y = this._orbitAxisY;
    return target.set(
      (x.x * cosT + y.x * sinT) * r,
      (x.y * cosT + y.y * sinT) * r,
      (x.z * cosT + y.z * sinT) * r
    );
  }

  /**
   * ∂position/∂θ on the curved leg (for outbound asymptote).
   * @param {number} theta
   * @param {THREE.Vector3} target
   */
  _arcTangent(theta, target) {
    const e = this.eccentricity;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const denom = 1 + e * cosT;
    const r = denom > 1e-4 ? this._semiLatus / denom : this._semiLatus * 4;
    const drDtheta = (this._semiLatus * e * sinT) / (denom * denom);
    const x = this._orbitAxisX;
    const y = this._orbitAxisY;
    const px = x.x * cosT + y.x * sinT;
    const py = x.y * cosT + y.y * sinT;
    const pz = x.z * cosT + y.z * sinT;
    const dpx = -x.x * sinT + y.x * cosT;
    const dpy = -x.y * sinT + y.y * cosT;
    const dpz = -x.z * sinT + y.z * cosT;
    return target.set(dpx * r + px * drDtheta, dpy * r + py * drDtheta, dpz * r + pz * drDtheta);
  }

  /**
   * Sun-centered path: one eccentric arc (perihelion mid-pass), then straight escape.
   * @param {number} angle
   * @param {THREE.Vector3} [target]
   */
  _computePosition(angle, target = this._posScratch) {
    const u = Math.max(0, angle / ARC_PERIOD);
    const rel = this._sunRelScratch;

    if (u <= 1) {
      const thetaRange = this.thetaEgress - this.thetaIngress;
      const theta = this.thetaIngress + u * thetaRange;
      this._positionOnArc(theta, rel);
    } else {
      const thetaEnd = this.thetaEgress;
      this._positionOnArc(thetaEnd, rel);
      this._arcTangent(thetaEnd, this._tangentScratch);
      const cruise = (u - 1) * this.outboundUnitsPerArc;
      rel.addScaledVector(this._tangentScratch.normalize(), cruise);
    }

    return target.set(rel.x + this._sun.x, rel.y + this._sun.y, rel.z + this._sun.z);
  }

  /** Anti-sun unit vector (tail points this way). */
  _antiSunFrom(headWorld, target = this._antiSunScratch) {
    return target.subVectors(headWorld, this._sun).normalize();
  }

  _updateSolarFlux(headWorld) {
    const dist = Math.max(headWorld.distanceTo(this._sun), this.perihelionDistance * 0.35);
    const ratio = this.perihelionDistance / dist;
    this._solarFlux = THREE.MathUtils.clamp(ratio * ratio, 0.12, 6);
  }

  static _perpendicularUnit(axis, out) {
    const ax = Math.abs(axis.x);
    const ay = Math.abs(axis.y);
    const az = Math.abs(axis.z);
    if (ax < ay && ax < az) out.set(1, 0, 0);
    else if (ay < az) out.set(0, 1, 0);
    else out.set(0, 0, 1);
    out.crossVectors(axis, out).normalize();
    return out;
  }

  _emitTrailPuff(headWorld, antiSun, b) {
    const i = this._trailEmitCount;
    if (i >= this._trailSprites.length) {
      this._createTrailSprite();
    }
    this._trailEmitCount = i + 1;

    const k = THREE.MathUtils.clamp(this._trailBeatResponsiveness, 0, 1);
    const bTrail = 1 + (b - 1) * k;
    const neckBlendEnd = Math.max(1, this.trailTipFadeSamples);
    const tailFanBoost = 1.38;
    const headDiameter = 2 * this._headScale;
    const tail = Math.min(1, i / Math.max(1, neckBlendEnd * 4));

    const uNeck = THREE.MathUtils.clamp(i / neckBlendEnd, 0, 1);
    const neckBlend = uNeck * uNeck * (3 - 2 * uNeck);

    const puffBase =
      (0.1 + (1 - tail) * 0.32 + tail * 0.58 * tailFanBoost) * (0.92 + bTrail * 0.12);
    const alongLen = puffBase * (1.1 + tail * 0.85);
    const acrossW = puffBase * (0.55 + tail * 0.48);
    const sx = THREE.MathUtils.lerp(headDiameter, acrossW, neckBlend);
    const sy = THREE.MathUtils.lerp(headDiameter, alongLen, neckBlend);

    Comet._perpendicularUnit(antiSun, this._perpScratch);
    const lateral = (Math.random() - 0.5) * acrossW * 0.35;
    const behind = (0.02 + Math.random() * 0.06) * (0.4 + tail);
    this._puffScratch
      .copy(headWorld)
      .addScaledVector(antiSun, behind)
      .addScaledVector(this._perpScratch, lateral);

    const sprite = this._trailSprites[i];
    sprite.position.copy(this._puffScratch);
    sprite.scale.set(sx, sy, 1);
    sprite.material.rotation = Math.atan2(antiSun.y, antiSun.x) + (Math.random() - 0.5) * 0.4;
    sprite.material.color.copy(this._trailColorNear).lerp(this._trailColorFar, tail);
    const peak = bTrail * this._trailOpacity * this._solarFlux;
    this._trailSpriteAges[i] = 0;
    this._trailSpritePeak[i] = peak;
    sprite.material.opacity = peak;
    sprite.renderOrder = Math.max(0, this.headRenderOrder - 1);
    sprite.visible = true;
  }

  _fadeTrailSprites(dt) {
    const rate = Math.max(0, this.trailFadeRate);
    for (let i = 0; i < this._trailEmitCount; i++) {
      this._trailSpriteAges[i] += dt;
      const fade = rate <= 0 ? 1 : Math.exp(-rate * this._trailSpriteAges[i]);
      const opacity = this._trailSpritePeak[i] * fade;
      const sprite = this._trailSprites[i];
      sprite.material.opacity = opacity;
      sprite.visible = opacity > 0.008;
    }
  }

  update(dt) {
    if (!this.motionPaused) {
      this._angle += dt * this.speed;
    }

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const audioBoost = Math.min(Math.max(this._brightness, 0), 1.2);
    const pos = this._computePosition(this._angle);
    this._head.position.copy(pos);
    this._updateSolarFlux(pos);

    const b = THREE.MathUtils.clamp(0.42 + this._solarFlux * 0.22 + audioBoost * 0.12, 0.42, 2.2);

    this._head.renderOrder = this.headRenderOrder;
    this._head.scale.setScalar(this._headScale / COMET_HEAD_BASE_RADIUS);
    this._headMat.opacity = Math.min(0.45 + this._solarFlux * 0.12 + b * 0.2, 0.95);

    if (this._glowMat) {
      const coma = Math.min(this._solarFlux * 0.14 + b * 0.1, 0.82);
      this._glowMat.opacity = coma;
      this._glow.scale.setScalar(this._glowSize * (0.5 + this._solarFlux * 0.12 + b * 0.2));
    }

    if (this._trailSprites.length) {
      const antiSun = this._antiSunFrom(pos);
      this._emitTrailPuff(pos, antiSun, b);
      this._fadeTrailSprites(dt);
    }
  }

  setupGUI(gui) {
    const f = gui.addFolder("Comet");
    f.add(this, "headRenderOrder", 0, 4, 1).name("Head draw order");
    f.add(this, "trailTipFadeSamples", 4, 120, 1).name("Neck width blend (samples)");
    f.add(this, "speed", 0.02, 0.5, 0.01).name("Speed");
    f.add(this, "trailFadeRate", 0, 2.5, 0.02).name("Trail fade rate");
    f.add(this, "perihelionDistance", 20, 80, 1).name("Perihelion dist");
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
