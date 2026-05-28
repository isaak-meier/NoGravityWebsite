import * as THREE from "three";
import { spheresOverlap } from "./shard-flight-collision.js";
import { poleBrake } from "./camera-controller.js";
import {
  buildBoosterRing,
  updateBoosterFlames,
  createSmokeTrail,
  emitSmoke,
  updateSmokeTrail,
  clearSmokeTrail,
  disposeBoosters,
  disposeSmokeTrail,
  setSmokeTrailViewportHeight,
} from "./shard-flight-boosters.js";

const SHIP_RADIUS = 0.075;
const AIM_RAMP_UP_SEC = 0.5;
const AIM_RETURN_SEC = 0.18;
/** Max yaw rotation rate of the aim direction when D / A is fully deflected (rad / sec). */
const AIM_YAW_RATE = 0.6;
/** Max pitch rotation rate of the aim direction when W / S is fully deflected (rad / sec). */
const AIM_PITCH_RATE = 0.45;
/** Distance ahead of the ship where the aim dot lives in world space — far enough to feel "in space". */
const AIM_FAR_DIST = 50;

// ─── Rocket physics constants ────────────────────────────────────────────────
// Newton's 2nd law gives a(t) = F(t) / m(t). Tsiolkovsky's rocket equation,
// written in differential form, gives mass-flow ṁ = F / v_e and the total
// Δv = v_e · ln(m₀ / m_f) for a burn that takes m₀ → m_f. We mirror these
// directly in {@link _integrateShip}: thrust comes from throttle + boost,
// the wet mass is (dry + remaining fuel), and the same thrust both
// accelerates the ship and drains the fuel tank.
//
// Real-world reference numbers we're roughly emulating (scaled to game units):
//   Saturn V S-IC : Isp ≈ 263 s → v_e ≈ 2580 m/s, TWR @ liftoff ≈ 1.18
//   Falcon 9 stage 1: Isp ≈ 282 s → v_e ≈ 2770 m/s, TWR @ liftoff ≈ 1.4
//   Solid booster "afterburner" pulse: thrust ≈ 5–8× sustained value.
//
/** Empty ship mass (no fuel). Game units. */
const SHIP_DRY_MASS = 1.0;
/** Tank capacity, game units of "fuel mass". Wet mass = SHIP_DRY_MASS + this. */
const SHIP_FUEL_MAX = 4.0;
/**
 * Maximum continuous thrust at full throttle (force, game units).
 * With a full tank (m = 5) this gives a starting acceleration of 28/5 = 5.6
 * game-u/s² — Falcon-9-ish TWR, so a few seconds of throttle to spool up to
 * {@link SHIP_MAX_SPEED} instead of the snappy old SHIP_ACCEL=52.
 */
const SHIP_MAX_THRUST = 28.0;
/**
 * Booster pulse thrust (one click). ≈7× the sustained max — modelled on
 * solid-fuel afterburner stages whose thrust dwarfs the main engine for a
 * short window. Held flat for ~75% of the duration then tapers off.
 */
const SHIP_BOOST_THRUST = 200.0;
const SHIP_BOOST_DURATION_SEC = 0.45;
/**
 * Effective exhaust velocity v_e for Tsiolkovsky. Sets ṁ = thrust / v_e, so
 * higher v_e = more efficient burn (slower fuel drain for the same thrust).
 * Tuned so that a full tank yields Δv = v_e · ln(5/1) ≈ 56 game-u — well
 * above the speed cap but reachable across multiple boosts.
 */
const SHIP_EXHAUST_V = 35.0;
/**
 * Passive fuel regen. Real rockets don't do this; we add it so a paused /
 * coasting ship eventually re-fills. Steady-state sustainable thrust is then
 * thrust* = FUEL_REGEN_PER_SEC · v_e ≈ 15.75, ~56% of {@link SHIP_MAX_THRUST}.
 */
const FUEL_REGEN_PER_SEC = 0.45;
/** Soft cap. Above this an RCS-like drag bleeds the excess off. */
const SHIP_MAX_SPEED = 32.0;
/** Exponential velocity damping when neither throttle nor boost is active. */
const COAST_DAMPING_PER_SEC = 0.35;
/** Rate (1/sec) at which the velocity vector slerps toward the aim direction. */
const RCS_ALIGN_RATE = 0.75;
/** Smoke particles per game-unit of fuel burned. Plume density tracks ṁ. */
const SMOKE_PARTICLES_PER_MASS_UNIT = 32;
/** Burst of extra smoke emitted the instant a boost fires (the visible "blast"). */
const BOOST_FIRE_BURST_PARTICLES = 22;
/** Minimum fuel needed to light the boosters. Avoids dry-click sputters. */
const BOOST_MIN_FUEL = 0.18;
// ─────────────────────────────────────────────────────────────────────────────

const SHELL_PAD_MIN = 0.32;
const SHELL_MAX = 26;
/** Where the ship spawns ahead of the camera at the start of a flight. */
const SPAWN_DIST = 5;
/** Distance the chase camera trails behind the ship's nose, in world units. */
const CAM_BEHIND = 2;
/** World-up lift on top of {@link CAM_BEHIND} for a slight over-the-shoulder pose. */
const CAM_UP = 0.5;
/**
 * Exponential follow rate (1/sec) for the chase camera position lerp. dt-independent:
 * factor = 1 - exp(-rate * dt). Higher = snappier. ~5 gives ~half-second to close most of the gap.
 */
const CAM_FOLLOW_RATE = 5;
const EXPLODE_SEC = 0.75;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

function approachDeflection(current, target, dt) {
  if (current === target) return target;
  const rate = target === 0 ? 1 / AIM_RETURN_SEC : 1 / AIM_RAMP_UP_SEC;
  const step = rate * dt;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/**
 * Boost-thrust scaling over the boost window: flat at 1.0 for the first ~75% of the
 * duration, then linear taper to 0. Lets the boosters feel punchy at fire time and
 * trail off cleanly rather than cutting off as a square wave.
 */
function boostThrustFactor(boostTimeRemaining, duration) {
  if (boostTimeRemaining <= 0) return 0;
  const taperWindow = duration * 0.25;
  return Math.min(1, boostTimeRemaining / Math.max(1e-6, taperWindow));
}

function applySoftSpeedCap(velocity, maxSpeed, dt) {
  const speed = velocity.length();
  if (speed <= maxSpeed) return;
  const over = speed - maxSpeed;
  // Decel scales with overspeed so the cap is soft — boost can punch past it briefly.
  const decel = Math.min(speed, (over * 2.0 + maxSpeed * 0.01) * dt);
  velocity.multiplyScalar(Math.max(0, (speed - decel) / speed));
}

function alignVelocityToAim(velocity, aimDir, rate, dt, scratch) {
  const speed = velocity.length();
  if (speed < 1e-4) return;
  const alignFactor = 1 - Math.exp(-rate * dt);
  scratch.copy(velocity).multiplyScalar(1 / speed);
  scratch.lerp(aimDir, alignFactor).normalize();
  velocity.copy(scratch).multiplyScalar(speed);
}

function buildShipGroup() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.32, 8),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.45,
      roughness: 0.35,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.35,
    }),
  );
  hull.rotation.x = -Math.PI / 2;
  g.add(hull);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  );
  glow.position.z = -0.12;
  g.add(glow);
  return g;
}

function makeExplosionPoints() {
  const n = 56;
  const pos = new Float32Array(n * 3);
  const vels = [];
  for (let i = 0; i < n; i++) {
    const vx = (Math.random() - 0.5) * 2;
    const vy = (Math.random() - 0.5) * 2;
    const vz = (Math.random() - 0.5) * 2;
    const len = Math.hypot(vx, vy, vz) || 1;
    const sp = 2.5 + Math.random() * 4;
    vels.push((vx / len) * sp, (vy / len) * sp, (vz / len) * sp);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffaa55,
    size: 0.14,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.vels = vels;
  pts.userData.t = 0;
  return pts;
}

export default class ShardFlightGame {
  /**
   * @param {object} opts
   * @param {import('three').Scene} opts.scene
   * @param {import('three').PerspectiveCamera} opts.camera
   * @param {import('./camera-controller.js').default} opts.camCtrl
   * @param {import('../pyramid/pyramid-field.js').default} opts.pyramidField
   * @param {import('three').Mesh} opts.planetMesh
   * @param {() => number} opts.getPlanetRadius
   * @param {HTMLElement} opts.container
   * @param {{ setAimDotVisible: (v: boolean) => void, syncAimDot: (cam: import('three').Camera, aim: import('three').Vector3, container: HTMLElement) => void, showGameOver: () => void, hideGameOver: () => void, setThrottleVisible?: (v: boolean) => void, setFuelFraction?: (f: number) => void }} opts.hud
   */
  constructor({
    scene,
    camera,
    camCtrl,
    pyramidField,
    planetMesh,
    getPlanetRadius,
    container,
    hud,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.camCtrl = camCtrl;
    this.pyramidField = pyramidField;
    this.planetMesh = planetMesh;
    this.getPlanetRadius = getPlanetRadius;
    this.container = container;
    this.hud = hud;

    this.active = false;
    this.gameOver = false;
    this.ship = buildShipGroup();
    this._boosters = buildBoosterRing(this.ship);
    this._smoke = createSmokeTrail();
    this._smoke.visible = false;
    this.scene.add(this._smoke);
    this._tmpNozzleWorld = this._boosters.localPositions.map(() => new THREE.Vector3());
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimOffsetX = 0;
    this.aimOffsetY = 0;
    /** Throttle setting (0..1). Driven by the right-side HUD slider. */
    this.throttle = 0;
    /** Remaining fuel mass (game units). Wet mass = SHIP_DRY_MASS + fuel. */
    this.fuel = SHIP_FUEL_MAX;
    /** Countdown timer for the boost-thrust window (seconds). 0 = not boosting. */
    this.boostTimeRemaining = 0;
    /** Accumulator for sub-unit smoke emissions so low ṁ still spawns particles. */
    this._smokeAccum = 0;
    /** Cached mass-flow rate for the current frame (used by the smoke emitter). */
    this._lastMassFlow = 0;
    /** @type {THREE.Points | null} */
    this._explosion = null;
    /** @type {number} agent debug: frame index for tick segmentation logs */
    this._debugTickIndex = 0;
  }

  enter() {
    if (this.active) return;
    // #region agent log
    const _agentEnterT0 = performance.now();
    fetch("http://127.0.0.1:7420/ingest/78a6f2ec-47fb-4ea6-9cbc-d865eb7eaeff", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "297bb4" },
      body: JSON.stringify({
        sessionId: "297bb4",
        location: "shard-flight-game.js:enter",
        message: "enter start",
        data: {},
        timestamp: Date.now(),
        hypothesisId: "H5",
        runId: "pre-fix",
      }),
    }).catch(() => {});
    // #endregion
    this.active = true;
    this.gameOver = false;
    this.camCtrl.shardFlightMode = true;
    this.camCtrl.followPlanet = null;
    this.camCtrl.followComet = null;
    this.camCtrl.zoomActive = false;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.fuel = SHIP_FUEL_MAX;
    this.boostTimeRemaining = 0;
    this._smokeAccum = 0;
    this._lastMassFlow = 0;
    this._smoke.visible = true;
    clearSmokeTrail(this._smoke);
    this._syncSmokeViewport();
    this._debugTickIndex = 0;

    // #region agent log
    const _agentBeforeUwm = performance.now();
    // #endregion
    this.planetMesh.updateWorldMatrix(true, true);
    // #region agent log
    fetch("http://127.0.0.1:7420/ingest/78a6f2ec-47fb-4ea6-9cbc-d865eb7eaeff", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "297bb4" },
      body: JSON.stringify({
        sessionId: "297bb4",
        location: "shard-flight-game.js:enter:afterUwm",
        message: "after planetMesh.updateWorldMatrix(true,true)",
        data: {
          uwmMs: performance.now() - _agentBeforeUwm,
          enterSoFarMs: performance.now() - _agentEnterT0,
        },
        timestamp: Date.now(),
        hypothesisId: "H5",
        runId: "pre-fix",
      }),
    }).catch(() => {});
    // #endregion
    this.planetMesh.getWorldPosition(_planetCenter);

    this.camera.getWorldDirection(_fwd);
    _fwd.normalize();
    this.ship.position.copy(this.camera.position).addScaledVector(_fwd, SPAWN_DIST);
    this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _fwd);

    this.aimOffsetX = 0;
    this.aimOffsetY = 0;
    this.aimDir.copy(_fwd);
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);

    this.scene.add(this.ship);
    this.hud.setAimDotVisible(true);
    this.hud.setThrottleVisible?.(true);
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
    // #region agent log
    fetch("http://127.0.0.1:7420/ingest/78a6f2ec-47fb-4ea6-9cbc-d865eb7eaeff", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "297bb4" },
      body: JSON.stringify({
        sessionId: "297bb4",
        location: "shard-flight-game.js:enter:end",
        message: "enter end",
        data: { totalEnterMs: performance.now() - _agentEnterT0 },
        timestamp: Date.now(),
        hypothesisId: "H5",
        runId: "pre-fix",
      }),
    }).catch(() => {});
    // #endregion
  }

  /** @param {{ mesh: import('three').Mesh }} primaryPlanet */
  exit(primaryPlanet) {
    if (!this.active) return;
    this.active = false;
    this.gameOver = false;
    this.camCtrl.shardFlightMode = false;
    this.camCtrl.followPlanet = primaryPlanet;
    this.camCtrl.followComet = null;
    this.scene.remove(this.ship);
    this._disposeExplosion();
    clearSmokeTrail(this._smoke);
    this._smoke.visible = false;
    updateBoosterFlames(this._boosters, 0, 1);
    this.hud.setAimDotVisible(false);
    this.hud.setThrottleVisible?.(false);
    this.hud.hideGameOver();
  }

  restart() {
    if (!this.active) return;
    this._disposeExplosion();
    this.gameOver = false;
    this.ship.visible = true;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.fuel = SHIP_FUEL_MAX;
    this.boostTimeRemaining = 0;
    this._smokeAccum = 0;
    this._lastMassFlow = 0;
    clearSmokeTrail(this._smoke);
    this._smoke.visible = true;
    updateBoosterFlames(this._boosters, 0, 1);
    this.planetMesh.getWorldPosition(_planetCenter);
    this.camera.getWorldDirection(_fwd);
    _fwd.normalize();
    this.ship.position.copy(this.camera.position).addScaledVector(_fwd, SPAWN_DIST);
    this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), _fwd);
    this.aimOffsetX = 0;
    this.aimOffsetY = 0;
    this.aimDir.copy(_fwd);
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
    this.hud.setThrottleVisible?.(true);
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
  }

  /**
   * Set the continuous-thrust setting. Called by the HUD throttle slider on every drag tick.
   * @param {number} value 0..1
   */
  setThrottle(value) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    this.throttle = Math.max(0, Math.min(1, v));
  }

  /**
   * Light the 7 boosters: enter a fixed-duration boost-thrust window if there's fuel.
   * The actual Δv is whatever Tsiolkovsky says it is for the burn (m₀ → m_f over the
   * window) — so a click on a full tank gives a much bigger kick than the same click
   * on near-empty.
   * @returns {boolean} true if the boosters actually lit (vs sputtered dry).
   */
  triggerBoost() {
    if (!this.active || this.gameOver) return false;
    if (this.fuel < BOOST_MIN_FUEL) return false;
    this.boostTimeRemaining = SHIP_BOOST_DURATION_SEC;
    this._collectNozzleWorldPositions(this._tmpNozzleWorld);
    // Visible blast: extra particles dumped at ignition moment.
    emitSmoke(
      this._smoke,
      this._tmpNozzleWorld,
      this.velocity,
      BOOST_FIRE_BURST_PARTICLES,
      1.4,
    );
    return true;
  }

  /**
   * Per-frame chase camera: lerp the camera toward an over-the-shoulder goal behind the ship's nose,
   * then `lookAt` the ship. Standard three.js third-person camera pattern (goal + lerp + lookAt).
   * The lerp is dt-independent so the framerate doesn't change the feel.
   * @param {number} dt
   */
  _updateChaseCamera(dt) {
    const target = this.gameOver && this._explosion
      ? this._explosion.position
      : this.ship.position;
    // Ship's local +Z in world is the "behind the nose" direction (apex sits at local -Z after
    // the hull rotation flip, so local +Z points opposite to where the ship is heading).
    _fwd.set(0, 0, 1).applyQuaternion(this.ship.quaternion).normalize();
    _camWant.copy(target)
      .addScaledVector(_fwd, CAM_BEHIND)
      .addScaledVector(_worldUp, CAM_UP);
    const factor = 1 - Math.exp(-CAM_FOLLOW_RATE * dt);
    this.camera.position.lerp(_camWant, factor);
    this.camera.lookAt(target);
  }

  _disposeExplosion() {
    if (!this._explosion) return;
    this.scene.remove(this._explosion);
    this._explosion.geometry.dispose();
    const m = this._explosion.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m.dispose();
    this._explosion = null;
  }

  _triggerGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.boostTimeRemaining = 0;
    updateBoosterFlames(this._boosters, 0, 1);
    this.ship.visible = false;
    this._explosion = makeExplosionPoints();
    this._explosion.position.copy(this.ship.position);
    this.scene.add(this._explosion);
    this.hud.showGameOver();
  }

  /**
   * Translate WASD into yaw / pitch *rates* applied to {@link aimDir}. Holding D yaws right at
   * AIM_YAW_RATE, holding W pitches up at AIM_PITCH_RATE; releasing the key stops the rotation so
   * the dot stays wherever the pilot placed it (a flight-stick feel, not a centering joystick).
   * The dot is then placed AIM_FAR_DIST out in that direction so the ship's lookAt locks onto a
   * target "far off in space" instead of a point one ship-length away from itself.
   */
  _moveAim(dt) {
    const k = this.camCtrl.keys;
    const targetX = (k.d ? 1 : 0) + (k.a ? -1 : 0);
    const targetY = (k.w ? 1 : 0) + (k.s ? -1 : 0);
    this.aimOffsetX = approachDeflection(this.aimOffsetX, targetX, dt);
    this.aimOffsetY = approachDeflection(this.aimOffsetY, targetY, dt);

    // D-positive (right of screen) wants the aim to rotate clockwise about world up — that's a
    // negative right-handed rotation around +Y, hence the leading minus.
    const yawDelta = -this.aimOffsetX * AIM_YAW_RATE * dt;
    const pitchDelta = this.aimOffsetY * AIM_PITCH_RATE * dt;
    this._rotateAimDir(yawDelta, pitchDelta);

    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
  }

  /**
   * Rotate {@link aimDir} by a yaw step about world up and a pitch step about the local right
   * axis. Pitch is run through the shared {@link poleBrake} so the direction asymptotically
   * approaches but never reaches `±worldUp`, keeping `lookAt` away from its singularity.
   * @param {number} yawDelta radians, right-handed about world +Y.
   * @param {number} pitchDelta radians, right-handed about the current right axis.
   */
  _rotateAimDir(yawDelta, pitchDelta) {
    if (yawDelta !== 0) {
      this.aimDir.applyAxisAngle(_worldUp, yawDelta);
    }
    if (pitchDelta !== 0) {
      _right.crossVectors(this.aimDir, _worldUp);
      if (_right.lengthSq() > 1e-6) {
        _right.normalize();
        // Rotation around `_right` follows the meridian, so d(aim.y)/dθ ≈ +1 and the proposed
        // Δy has the same sign as pitchDelta — pass it straight to the brake.
        const brake = poleBrake(this.aimDir.dot(_worldUp), pitchDelta);
        this.aimDir.applyAxisAngle(_right, pitchDelta * brake);
      }
    }
    this.aimDir.normalize();
  }

  /**
   * Compute the current engine thrust from throttle + active boost. Also stashes
   * the mass-flow ṁ = F/v_e on `this._lastMassFlow` for {@link _burnFuel} and the
   * smoke emitter (they need the same number).
   * @returns {number} thrust in game force-units.
   */
  _thrustForCurrentInputs() {
    if (this.fuel <= 0) {
      this._lastMassFlow = 0;
      return 0;
    }
    const boostFactor = boostThrustFactor(this.boostTimeRemaining, SHIP_BOOST_DURATION_SEC);
    const thrust = this.throttle * SHIP_MAX_THRUST + boostFactor * SHIP_BOOST_THRUST;
    this._lastMassFlow = thrust / SHIP_EXHAUST_V;
    return thrust;
  }

  /**
   * Drain fuel at the Tsiolkovsky mass-flow rate ṁ stashed last call, then add
   * passive regen and clamp to the tank. Keeping burn and regen on the same line
   * makes the steady-state thrust math obvious.
   * @param {number} dt
   */
  _burnFuel(dt) {
    const burned = Math.min(this.fuel, this._lastMassFlow * dt);
    this.fuel = Math.min(
      SHIP_FUEL_MAX,
      Math.max(0, this.fuel - burned + FUEL_REGEN_PER_SEC * dt),
    );
  }

  /**
   * Newton + Tsiolkovsky integration: a = F/m along aim, ṁ = F/v_e drains fuel,
   * then RCS slerps the velocity vector toward the aim direction so the ship
   * tracks where the pilot is looking (real ships use lateral thrusters; we
   * collapse that into one smooth alignment). A soft speed cap and a coast-damp
   * keep things playable.
   * @param {number} dt
   */
  _integrateShip(dt) {
    _toAim.subVectors(this.aimWorld, this.ship.position);
    const dist = _toAim.length();
    if (dist > 1e-4) _toAim.multiplyScalar(1 / dist);

    const thrust = this._thrustForCurrentInputs();
    const mass = SHIP_DRY_MASS + this.fuel;
    const accel = thrust / mass;
    this.velocity.addScaledVector(_toAim, accel * dt);
    this._burnFuel(dt);

    alignVelocityToAim(this.velocity, _toAim, RCS_ALIGN_RATE, dt, _vDir);

    if (this.throttle < 0.02 && this.boostTimeRemaining <= 0) {
      this.velocity.multiplyScalar(Math.exp(-COAST_DAMPING_PER_SEC * dt));
    }
    applySoftSpeedCap(this.velocity, SHIP_MAX_SPEED, dt);

    if (this.boostTimeRemaining > 0) {
      this.boostTimeRemaining = Math.max(0, this.boostTimeRemaining - dt);
    }

    this.ship.position.addScaledVector(this.velocity, dt);
    if (dist > 0.05) this.ship.lookAt(this.aimWorld);
  }

  _clampShell() {
    this.planetMesh.getWorldPosition(_planetCenter);
    const R = this.getPlanetRadius();
    _offset.subVectors(this.ship.position, _planetCenter);
    const d = _offset.length();
    const minD = R + SHELL_PAD_MIN + SHIP_RADIUS;
    const maxD = SHELL_MAX;
    if (d < minD && d > 1e-6) {
      _offset.multiplyScalar(minD / d);
      this.ship.position.copy(_planetCenter).add(_offset);
      this.velocity.multiplyScalar(0.3);
    } else if (d > maxD) {
      _offset.multiplyScalar(maxD / d);
      this.ship.position.copy(_planetCenter).add(_offset);
      this.velocity.multiplyScalar(0.3);
    }
  }

  _checkShardHit() {
    const shipPos = this.ship.position;
    let hit = false;
    // #region agent log
    const colliderStartMs =
      this._debugTickIndex < 25 ? performance.now() : 0;
    // #endregion
    this.pyramidField.forEachActiveShardCollider(({ centerWorld, radius }) => {
      if (hit) return;
      if (spheresOverlap(shipPos, SHIP_RADIUS, centerWorld, radius)) {
        hit = true;
      }
    });
    // #region agent log
    if (this._debugTickIndex < 25 && colliderStartMs) {
      fetch("http://127.0.0.1:7420/ingest/78a6f2ec-47fb-4ea6-9cbc-d865eb7eaeff", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "297bb4" },
        body: JSON.stringify({
          sessionId: "297bb4",
          location: "shard-flight-game.js:_checkShardHit",
          message: "collider iteration",
          data: {
            idx: this._debugTickIndex,
            colliderMs: performance.now() - colliderStartMs,
          },
          timestamp: Date.now(),
          hypothesisId: "H2",
          runId: "pre-fix",
        }),
      }).catch(() => {});
    }
    // #endregion
    if (hit) this._triggerGameOver();
  }

  _updateExplosion(dt) {
    if (!this._explosion) return;
    const pts = this._explosion;
    const vels = pts.userData.vels;
    pts.userData.t += dt;
    const pos = pts.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3;
      pos.array[ix] += vels[ix] * dt;
      pos.array[ix + 1] += vels[ix + 1] * dt;
      pos.array[ix + 2] += vels[ix + 2] * dt;
    }
    pos.needsUpdate = true;
    const m = /** @type {THREE.PointsMaterial} */ (pts.material);
    m.opacity = Math.max(0, 1 - pts.userData.t / EXPLODE_SEC);
    if (pts.userData.t > EXPLODE_SEC) {
      this._disposeExplosion();
    }
  }

  /** Project each nozzle's local position into world space. Reuses preallocated vectors. */
  _collectNozzleWorldPositions(out) {
    this.ship.updateMatrixWorld(false);
    const local = this._boosters.localPositions;
    for (let i = 0; i < local.length; i++) {
      if (!out[i]) out[i] = new THREE.Vector3();
      out[i].copy(local[i]).applyMatrix4(this.ship.matrixWorld);
    }
  }

  /**
   * Update flame intensity + spawn smoke at a rate proportional to the current
   * mass-flow ṁ — physically: the more fuel we burn this frame, the more
   * combustion product hits the air behind us.
   * @param {number} dt
   */
  _updateBoosterVisuals(dt) {
    const boostFactor = boostThrustFactor(this.boostTimeRemaining, SHIP_BOOST_DURATION_SEC);
    const fuelGate = this.fuel > 0 ? 1 : 0;
    const intensity = (this.throttle + boostFactor * 1.6) * fuelGate;
    updateBoosterFlames(this._boosters, intensity, dt);
    this._smokeAccum += this._lastMassFlow * dt * SMOKE_PARTICLES_PER_MASS_UNIT;
    if (this._smokeAccum >= 1) {
      const toEmit = Math.min(18, Math.floor(this._smokeAccum));
      this._smokeAccum -= toEmit;
      this._collectNozzleWorldPositions(this._tmpNozzleWorld);
      const exhaustBase = 0.5 + boostFactor * 0.9;
      emitSmoke(this._smoke, this._tmpNozzleWorld, this.velocity, toEmit, exhaustBase);
    } else if (this._smokeAccum < 0) {
      this._smokeAccum = 0;
    }
    updateSmokeTrail(this._smoke, dt);
  }

  _syncSmokeViewport() {
    const h = this.container?.getBoundingClientRect?.().height
      ?? (typeof window !== "undefined" ? window.innerHeight : 800);
    setSmokeTrailViewportHeight(this._smoke, h);
  }

  /**
   * Call after `pyramidField.update` each frame while mode may be active.
   * @param {number} dt
   */
  update(dt) {
    if (!this.active) return;

    if (!this.gameOver) {
      this._moveAim(dt);
      this._integrateShip(dt);
      this._clampShell();
      this._checkShardHit();
      this._updateBoosterVisuals(dt);
      this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    } else {
      this._updateExplosion(dt);
      this._updateBoosterVisuals(dt);
    }

    this._updateChaseCamera(dt);
    this.hud.syncAimDot(this.camera, this.aimWorld, this.container);
  }
}
