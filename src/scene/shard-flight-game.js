import * as THREE from "three";
import { spheresOverlap } from "./shard-flight-collision.js";
import {
  buildBoosterRing,
  updateBoosterFlames,
  createSmokeTrail,
  emitSmoke,
  updateSmokeTrail,
  clearSmokeTrail,
  setSmokeTrailViewportHeight,
} from "./shard-flight-boosters.js";

const SHIP_RADIUS = 0.075;
const AIM_RAMP_UP_SEC = 0.5;
const AIM_RETURN_SEC = 0.18;
/** How fast the crosshair drifts across the screen when WASD is held (NDC units / sec). */
const AIM_SCREEN_DRIFT_RATE = 0.85;
/** Max crosshair offset from screen center (NDC, ±1 = viewport edge). */
const AIM_SCREEN_MAX = 0.72;
/** Distance ahead of the ship for the thrust line endpoint in world space. */
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
/**
 * Tank capacity, game units of "fuel mass". Wet mass = SHIP_DRY_MASS + this.
 *
 * At a full 16-unit tank the wet mass is 17, so starting accel at full throttle
 * is 28/17 ≈ 1.65 game-u/s² — slow and heavy (intentional Tsiolkovsky feel).
 * As fuel burns the mass drops and acceleration climbs; by the time the tank
 * is at a quarter (fuel = 4) accel is back up to 28/5 ≈ 5.6 game-u/s² — the
 * spry, original ship feel — and it keeps rising as you burn down.
 *
 * Full-tank Δv potential is v_e · ln(m₀/m_f) = 35 · ln(17/1) ≈ 99 game-u,
 * well above the speed cap so the tank carries plenty of "headroom" of
 * stored Δv across multiple boosts (≈6 boosts on a full tank).
 */
const SHIP_FUEL_MAX = 16.0;
/**
 * Maximum continuous thrust at full throttle (force, game units).
 * With a full tank (wet mass = SHIP_DRY_MASS + SHIP_FUEL_MAX = 17) the starting
 * acceleration is 28/17 ≈ 1.65 game-u/s² — Saturn-V-ish TWR (≈1.18 vs gravity
 * in real life; here gravity is zero, so this is just the raw figure). As fuel
 * burns the mass drops and accel climbs — the characteristic "rocket builds
 * up" curve Tsiolkovsky describes.
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
 * With a 16-unit tank a full burn yields Δv = v_e · ln(17/1) ≈ 99 game-u —
 * way above any cruising speed you'd reach in practice, and the ship can
 * stack burns to keep going faster (no top-speed cap any more).
 */
const SHIP_EXHAUST_V = 35.0;
/**
 * Passive fuel regen. Real rockets don't do this; we add it so a paused /
 * coasting ship eventually re-fills. Steady-state sustainable thrust is
 * thrust* = FUEL_REGEN_PER_SEC · v_e ≈ 15.75 — about 56% of {@link SHIP_MAX_THRUST},
 * so anything up to ~half-throttle is sustainable indefinitely.
 */
const FUEL_REGEN_PER_SEC = 0.45;
/**
 * Very gentle fly-by-wire assist: slerp the velocity vector toward the aim direction
 * at this rate (1/sec, exponential). Real spaceships need a lateral RCS burn to do
 * this — there is nothing physical in vacuum that would rotate your momentum for free.
 * We keep a token amount (≈ 0.15) so steering still feels responsive over a few
 * seconds; set to 0 for purely Newtonian "drift in the original direction" feel.
 */
const RCS_ALIGN_RATE = 0.15;
/** Smoke particles per game-unit of fuel burned. Plume density tracks ṁ. */
const SMOKE_PARTICLES_PER_MASS_UNIT = 32;
/** Burst of extra smoke emitted the instant a boost fires (the visible "blast"). */
const BOOST_FIRE_BURST_PARTICLES = 22;
/** Minimum fuel needed to light the boosters. Avoids dry-click sputters. */
const BOOST_MIN_FUEL = 0.18;
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Click-and-hold throttle ramp rates. Pressing the canvas drives the throttle toward 1.0
 * at {@link THROTTLE_RAMP_UP_PER_SEC} per second; releasing it lets it decay back toward 0
 * at the slower {@link THROTTLE_DECAY_PER_SEC} — gas-pedal feel where letting off lingers.
 */
const THROTTLE_RAMP_UP_PER_SEC = 0.6;
const THROTTLE_DECAY_PER_SEC = 0.22;

const SHELL_PAD_MIN = 0.32;
const SHELL_MAX = 26;
/** Local axis that points out the ship's nose (hull cone + glow sit at negative Z). */
const SHIP_NOSE_LOCAL = new THREE.Vector3(0, 0, -1);
/** Distance the chase camera trails behind the ship's nose, in world units. */
const CAM_BEHIND = 2;
/** World-up lift on top of {@link CAM_BEHIND} for a slight over-the-shoulder pose. */
const CAM_UP = 0.5;
/** Exponential follow rate (1/sec) for the chase camera position lerp. */
const CAM_FOLLOW_RATE = 5;
const EXPLODE_SEC = 0.75;

const _fwd = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _screenRay = new THREE.Vector3();
const _dbgShip0 = new THREE.Vector3();
const _dbgCam0 = new THREE.Vector3();
const _dbgShip1 = new THREE.Vector3();

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

function alignVelocityToAim(velocity, aimDir, rate, dt, scratch) {
  const speed = velocity.length();
  if (speed < 1e-4) return;
  const alignFactor = 1 - Math.exp(-rate * dt);
  scratch.copy(velocity).multiplyScalar(1 / speed);
  scratch.lerp(aimDir, alignFactor).normalize();
  velocity.copy(scratch).multiplyScalar(speed);
}

/** World-space line from the ship to the aim target — shows the thrust axis. */
function buildAimLine() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(6);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 24;
  return line;
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
   * @param {{ setAimDotVisible: (v: boolean) => void, syncAimDot: (ndcX: number, ndcY: number, container: HTMLElement) => void, showGameOver: () => void, hideGameOver: () => void, setThrottleVisible?: (v: boolean) => void, setFuelFraction?: (f: number) => void, resetThrottle?: () => void, setThrottleVisualValue?: (v: number) => void, setNewton?: (values: { thrust: number, mass: number, accel: number, speed: number }) => void }} opts.hud
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
    this._aimLine = buildAimLine();
    this._aimLine.visible = false;
    this.scene.add(this._aimLine);
    this._tmpNozzleWorld = this._boosters.localPositions.map(() => new THREE.Vector3());
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.aimOffsetX = 0;
    this.aimOffsetY = 0;
    this.aimScreenX = 0;
    this.aimScreenY = 0;
    /**
     * Throttle setting (0..1). Driven primarily by click-and-hold on the canvas — see
     * {@link setThrottlePressed} and {@link _updateThrottleFromPress}. Dragging the HUD
     * slider still writes directly into this value via {@link setThrottle} for manual
     * overrides.
     */
    this.throttle = 0;
    /** True while the user is holding the pointer down on the canvas (not on HUD). */
    this._throttlePressed = false;
    /** Remaining fuel mass (game units). Wet mass = SHIP_DRY_MASS + fuel. */
    this.fuel = SHIP_FUEL_MAX;
    /** Countdown timer for the boost-thrust window (seconds). 0 = not boosting. */
    this.boostTimeRemaining = 0;
    /** Accumulator for sub-unit smoke emissions so low ṁ still spawns particles. */
    this._smokeAccum = 0;
    /** Cached mass-flow rate for the current frame (used by the smoke emitter). */
    this._lastMassFlow = 0;
    /** Cached thrust / mass / accel from the last integrator step (for the HUD). */
    this._lastThrust = 0;
    this._lastMass = SHIP_DRY_MASS + SHIP_FUEL_MAX;
    this._lastAccel = 0;
    /** @type {THREE.Points | null} */
    this._explosion = null;
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.gameOver = false;
    this.camCtrl.shardFlightMode = true;
    this.camCtrl.followPlanet = null;
    this.camCtrl.followComet = null;
    this.camCtrl.zoomActive = false;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this._throttlePressed = false;
    this.fuel = SHIP_FUEL_MAX;
    this.boostTimeRemaining = 0;
    this._smokeAccum = 0;
    this._lastMassFlow = 0;
    this._lastThrust = 0;
    this._lastMass = SHIP_DRY_MASS + this.fuel;
    this._lastAccel = 0;
    this._smoke.visible = true;
    clearSmokeTrail(this._smoke);
    this._syncSmokeViewport();
    this.planetMesh.updateWorldMatrix(true, true);
    this.scene.add(this.ship);
    this._placeShipInShellFacingPlanet();
    this.hud.setAimDotVisible(true);
    this.hud.setThrottleVisible?.(true);
    this.hud.resetThrottle?.();
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
    this._aimLine.visible = true;
    this._updateAimLine();
  }

  /** @param {{ mesh: import('three').Mesh }} primaryPlanet */
  exit(primaryPlanet) {
    if (!this.active) return;
    this.active = false;
    this.gameOver = false;
    this._throttlePressed = false;
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
    this._aimLine.visible = false;
  }

  restart() {
    if (!this.active) return;
    this._disposeExplosion();
    this.gameOver = false;
    this.ship.visible = true;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this._throttlePressed = false;
    this.fuel = SHIP_FUEL_MAX;
    this.boostTimeRemaining = 0;
    this._smokeAccum = 0;
    this._lastMassFlow = 0;
    this._lastThrust = 0;
    this._lastMass = SHIP_DRY_MASS + this.fuel;
    this._lastAccel = 0;
    clearSmokeTrail(this._smoke);
    this._smoke.visible = true;
    updateBoosterFlames(this._boosters, 0, 1);
    this._placeShipInShellFacingPlanet();
    this.hud.setThrottleVisible?.(true);
    this.hud.resetThrottle?.();
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
    this._aimLine.visible = true;
    this._updateAimLine();
  }

  /**
   * Set the continuous-thrust setting. Called by the HUD throttle slider on every drag tick
   * for manual overrides. The auto-ramp in {@link _updateThrottleFromPress} will keep adjusting
   * from there on the next frame.
   * @param {number} value 0..1
   */
  setThrottle(value) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    this.throttle = Math.max(0, Math.min(1, v));
  }

  /**
   * Update the click-and-hold state. While pressed, {@link _updateThrottleFromPress} ramps
   * {@link throttle} toward 1; while released it decays toward 0. Wired by the HUD's
   * pointerdown / pointerup handlers (pointer-captured so a release off-canvas still fires).
   * @param {boolean} pressed
   */
  setThrottlePressed(pressed) {
    this._throttlePressed = !!pressed;
  }

  /**
   * Gas-pedal integration: ramp up while held, decay while released. Linear so the slider
   * visibly tracks at a constant rate; the rocket math downstream is what makes the actual
   * acceleration feel curvy (mass-dependent a = F/m).
   * @param {number} dt
   */
  _updateThrottleFromPress(dt) {
    if (this._throttlePressed) {
      this.throttle = Math.min(1, this.throttle + THROTTLE_RAMP_UP_PER_SEC * dt);
    } else if (this.throttle > 0) {
      this.throttle = Math.max(0, this.throttle - THROTTLE_DECAY_PER_SEC * dt);
    }
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
   * Place the ship on the flight shell between the planet and the camera, aimed at the planet.
   * World-space camera offset from the planet can be thousands of units (solar-system coords);
   * spawning at camera+fwd left the ship outside the shell and {@link _clampShell} pinned it
   * on the outer wall with velocity drained every frame.
   */
  _placeShipInShellFacingPlanet() {
    this.planetMesh.updateWorldMatrix(true, true);
    this.planetMesh.getWorldPosition(_planetCenter);
    _offset.subVectors(this.camera.position, _planetCenter);
    let camDist = _offset.length();
    if (camDist < 1e-4) {
      _offset.set(0, 0, 1);
      camDist = 1;
    } else {
      _offset.multiplyScalar(1 / camDist);
    }
    const R = this.getPlanetRadius();
    const minD = R + SHELL_PAD_MIN + SHIP_RADIUS;
    const spawnR = Math.min(Math.max(camDist, minD + 0.5), SHELL_MAX - 0.5);
    this.ship.position.copy(_planetCenter).addScaledVector(_offset, spawnR);
    this.aimDir.copy(_offset).negate().normalize();
    this.ship.quaternion.setFromUnitVectors(SHIP_NOSE_LOCAL, this.aimDir);
    this.aimOffsetX = 0;
    this.aimOffsetY = 0;
    this._projectAimDirToScreen();
  }

  /** Match {@link aimScreenX} / {@link aimScreenY} to the current {@link aimDir} on the view. */
  _projectAimDirToScreen() {
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
    _screenRay.copy(this.aimWorld).project(this.camera);
    if (_screenRay.z <= 1) {
      this.aimScreenX = THREE.MathUtils.clamp(_screenRay.x, -AIM_SCREEN_MAX, AIM_SCREEN_MAX);
      this.aimScreenY = THREE.MathUtils.clamp(_screenRay.y, -AIM_SCREEN_MAX, AIM_SCREEN_MAX);
    } else {
      this.aimScreenX = 0;
      this.aimScreenY = 0;
    }
  }

  /**
   * World aim direction from the 2D crosshair position on the current camera view.
   * @param {THREE.Vector3} out unit vector
   */
  _aimDirFromScreenInto(out) {
    _screenRay.set(this.aimScreenX, this.aimScreenY, 0.5);
    _screenRay.unproject(this.camera);
    out.copy(_screenRay).sub(this.camera.position).normalize();
  }

  /**
   * Per-frame chase camera: lerp the camera toward an over-the-shoulder goal behind the ship's nose,
   * then `lookAt` the ship. Standard three.js third-person camera pattern (goal + lerp + lookAt).
   * @param {number} dt
   */
  _updateChaseCamera(dt) {
    const target = this.gameOver && this._explosion
      ? this._explosion.position
      : this.ship.position;
    _fwd.set(0, 0, 1).applyQuaternion(this.ship.quaternion).normalize();
    _camWant.copy(target)
      .addScaledVector(_fwd, CAM_BEHIND)
      .addScaledVector(_worldUp, CAM_UP);
    const factor = 1 - Math.exp(-CAM_FOLLOW_RATE * dt);
    // this.camera.position.lerp(_camWant, factor);
    // this.camera.lookAt(target);
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
    this._aimLine.visible = false;
    this._explosion = makeExplosionPoints();
    this._explosion.position.copy(this.ship.position);
    this.scene.add(this._explosion);
    this.hud.showGameOver();
  }

  /**
   * Drift the 2D crosshair with WASD (screen space). Releasing a key stops motion but leaves
   * the crosshair where the pilot placed it. {@link aimDir} is rebuilt each frame from a
   * camera ray through the crosshair.
   */
  _moveAim(dt) {
    const k = this.camCtrl.keys;
    const targetX = (k.d ? 1 : 0) + (k.a ? -1 : 0);
    const targetY = (k.s ? -1 : 0) + (k.w ? 1 : 0);
    this.aimOffsetX = approachDeflection(this.aimOffsetX, targetX, dt);
    this.aimOffsetY = approachDeflection(this.aimOffsetY, targetY, dt);

    this.aimScreenX = THREE.MathUtils.clamp(
      this.aimScreenX + this.aimOffsetX * AIM_SCREEN_DRIFT_RATE * dt,
      -AIM_SCREEN_MAX,
      AIM_SCREEN_MAX,
    );
    this.aimScreenY = THREE.MathUtils.clamp(
      this.aimScreenY + this.aimOffsetY * AIM_SCREEN_DRIFT_RATE * dt,
      -AIM_SCREEN_MAX,
      AIM_SCREEN_MAX,
    );

    this._aimDirFromScreenInto(this.aimDir);
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
  }

  /**
   * Unit vector from the ship toward the crosshair (ship → {@link aimWorld}). That line is
   * the thrust axis: boosters push the ship along it, exhaust trails behind it.
   * @param {THREE.Vector3} out
   * @returns {boolean} false if no valid direction
   */
  _thrustDirectionInto(out) {
    out.subVectors(this.aimWorld, this.ship.position);
    const len = out.length();
    if (len > 1e-4) {
      out.multiplyScalar(1 / len);
      return true;
    }
    if (this.aimDir.lengthSq() > 1e-8) {
      out.copy(this.aimDir);
      return true;
    }
    return false;
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
   * Newton + Tsiolkovsky integration: a = F/m along aim, ṁ = F/v_e drains fuel.
   * Pure vacuum coast — no friction, no speed cap, no coast damping. The only
   * concession to fly-by-wire is a very gentle slerp of the velocity vector toward
   * aim (see {@link RCS_ALIGN_RATE}), which stands in for a tiny lateral RCS burn.
   * @param {number} dt
   */
  _integrateShip(dt) {
    if (!this._thrustDirectionInto(_toAim)) return;
    this.aimDir.copy(_toAim);

    const thrust = this._thrustForCurrentInputs();
    const mass = SHIP_DRY_MASS + this.fuel;
    const accel = thrust / mass;
    this._lastThrust = thrust;
    this._lastMass = mass;
    this._lastAccel = accel;
    this.velocity.addScaledVector(_toAim, accel * dt);
    this._burnFuel(dt);

    alignVelocityToAim(this.velocity, _toAim, RCS_ALIGN_RATE, dt, _vDir);

    if (this.boostTimeRemaining > 0) {
      this.boostTimeRemaining = Math.max(0, this.boostTimeRemaining - dt);
    }

    this.ship.position.addScaledVector(this.velocity, dt);
    this.ship.quaternion.setFromUnitVectors(SHIP_NOSE_LOCAL, _toAim);
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
  }

  _clampShell() {
    this.planetMesh.getWorldPosition(_planetCenter);
    const R = this.getPlanetRadius();
    _offset.subVectors(this.ship.position, _planetCenter);
    const d = _offset.length();
    const minD = R + SHELL_PAD_MIN + SHIP_RADIUS;
    const maxD = SHELL_MAX;
    if (d < 1e-6) return;
    const radialOut = _offset.multiplyScalar(1 / d);
    if (d < minD) {
      this.ship.position.copy(_planetCenter).addScaledVector(radialOut, minD);
      const vIn = this.velocity.dot(radialOut);
      if (vIn < 0) this.velocity.addScaledVector(radialOut, -vIn);
    } else if (d > maxD) {
      this.ship.position.copy(_planetCenter).addScaledVector(radialOut, maxD);
      const vOut = this.velocity.dot(radialOut);
      if (vOut > 0) this.velocity.addScaledVector(radialOut, -vOut);
    }
  }

  _checkShardHit() {
    const shipPos = this.ship.position;
    let hit = false;
    this.pyramidField.forEachActiveShardCollider(({ centerWorld, radius }) => {
      if (hit) return;
      if (spheresOverlap(shipPos, SHIP_RADIUS, centerWorld, radius)) {
        hit = true;
      }
    });
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

  /** Refresh the ship → crosshair thrust line in world space. */
  _updateAimLine() {
    const attr = this._aimLine.geometry.attributes.position;
    const p = attr.array;
    p[0] = this.ship.position.x;
    p[1] = this.ship.position.y;
    p[2] = this.ship.position.z;
    p[3] = this.aimWorld.x;
    p[4] = this.aimWorld.y;
    p[5] = this.aimWorld.z;
    attr.needsUpdate = true;
    this._aimLine.geometry.computeBoundingSphere();
  }

  /**
   * Call after `pyramidField.update` each frame while mode may be active.
   * @param {number} dt
   */
  update(dt) {
    if (!this.active) return;

    const k = this.camCtrl.keys;
    const wasdDown = !!(k.w || k.a || k.s || k.d);
    /** @type {THREE.Vector3 | null} */
    let shipBeforeClamp = null;
    if (wasdDown) {
      _dbgShip0.copy(this.ship.position);
      _dbgCam0.copy(this.camera.position);
    }

    if (!this.gameOver) {
      this._updateThrottleFromPress(dt);
      this._updateChaseCamera(dt);
      this._moveAim(dt);
      this._integrateShip(dt);
      if (wasdDown) shipBeforeClamp = _dbgShip1.copy(this.ship.position);
      this._clampShell();
      // this._checkShardHit();
      this._updateBoosterVisuals(dt);
      this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
      this.hud.setThrottleVisualValue?.(this.throttle);
      this.hud.setNewton?.({
        thrust: this._lastThrust,
        mass: this._lastMass,
        accel: this._lastAccel,
        speed: this.velocity.length(),
      });
    } else {
      this._updateExplosion(dt);
      this._updateBoosterVisuals(dt);
      this._updateChaseCamera(dt);
    }

    if (this._aimLine.visible) this._updateAimLine();
    this.hud.syncAimDot(this.aimScreenX, this.aimScreenY, this.container);

    // #region agent log
    if (wasdDown) {
      this._dbgWasdFrame = (this._dbgWasdFrame ?? 0) + 1;
      if (this._dbgWasdFrame % 10 === 0) {
        const shipD = _dbgShip1.copy(this.ship.position).sub(_dbgShip0).length();
        const camD = this.camera.position.distanceTo(_dbgCam0);
        const clampD = shipBeforeClamp
          ? this.ship.position.distanceTo(shipBeforeClamp)
          : 0;
        fetch("http://127.0.0.1:7420/ingest/78a6f2ec-47fb-4ea6-9cbc-d865eb7eaeff", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a9743c" },
          body: JSON.stringify({
            sessionId: "a9743c",
            hypothesisId: "H1-H2-H5",
            location: "shard-flight-game.js:update",
            message: "WASD frame deltas",
            data: {
              shipDelta: shipD,
              camDelta: camD,
              clampDelta: clampD,
              speed: this.velocity.length(),
              thrust: this._lastThrust,
              throttle: this.throttle,
              throttlePressed: this._throttlePressed,
              aimScreenX: this.aimScreenX,
              aimScreenY: this.aimScreenY,
              keys: { w: k.w, a: k.a, s: k.s, d: k.d },
              shardFlightMode: this.camCtrl.shardFlightMode,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
    }
    // #endregion
  }
}
