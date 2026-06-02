import * as THREE from "three";
import { poleBrake } from "./camera-controller.js";
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
import {
  computeBattleShipMetrics,
  computeBattleGoalAhead,
  computeBattleGoalAlongRing,
  collectShardSpawnAnchors,
  computeBattleSpawnInShardField,
  computeBattleOrientationTowardGoal,
  buildBattleGoalMarker,
  buildBattleRingBoundaryMesh,
  computeBattleRingBoundaryRadii,
  disposeBattleRingBoundaryMesh,
  isShipOutsideBattleRingBoundaryWorld,
  collectBattleShardObstacles,
  planBattleRouteWaypoints,
  nudgePointClearOfShardObstacles,
  BATTLE_SHIP_HULL_SCALE_MIN,
  BATTLE_SHIP_HULL_SCALE_MAX,
  BATTLE_SHIP_HULL_SCALE_DEFAULT,
  BATTLE_ROUTE_CLEARANCE_SHARD_MULT,
  BATTLE_SPAWN_CLEARANCE_MULT,
  battleShardHitRadius,
  BATTLE_HIT_SHIP_RADIUS_MULT,
} from "./shard-battle-helpers.js";
import {
  computeHorizonShipCameraPosition,
  LANDING_HORIZON_CAM_SIDE,
  LANDING_HORIZON_CAM_LIFT,
  LANDED_HORIZON_CAM_SIDE,
  LANDED_HORIZON_CAM_LIFT,
} from "./landed-ship-camera.js";

const SHIP_RADIUS = 0.075;
/** Distance ahead of the ship for the thrust line endpoint in world space. */
const AIM_FAR_DIST = 50;
/** Seconds of constant-acceleration coast to draw on the red path preview. */
const PATH_PREVIEW_SEC = 4;
/** Hide the path line when speed and accel are both below this (coasting to stop). */
const PATH_MIN_SPEED = 0.04;
/** Battle: polyline vertices for the optimal-thrust preview (ship → goal). */
const BATTLE_ROUTE_MAX_POINTS = 28;
/** Battle route preview horizon (seconds of simulated full-throttle flight). */
const BATTLE_ROUTE_PREVIEW_SEC = 2.8;
/** Battle route line opacity pulse (rad/s). */
const BATTLE_ROUTE_PULSE_RATE = 3.6;
/** Yaw rate for A / D (rad/s, world +Y). */
const SHIP_YAW_RATE = 1.15;
/** Pitch rate for W / S (rad/s, ship-local right). */
const SHIP_PITCH_RATE = 1.15;
/** Landing tween duration (blue hub touch → pad on blue). */
const LANDING_DURATION_SEC = 4.2;
/** Ship scale at touchdown on the landing planet. */
const LANDING_END_SCALE = 0.055;
/** Clearance above the landing planet surface at touchdown. */
const LANDING_SURFACE_PAD = 0.05;
/** Camera follow rate while the ship descends (1/sec, exponential). */
const LANDING_CAM_FOLLOW_RATE = 10;
/** Seconds to ease the camera into the final overlook after touchdown. */
const LANDING_SETTLE_SEC = 2;
/** Fly-in + shrink before battle gameplay (shell → inside shard field). */
const BATTLE_ENTRY_DURATION_SEC = 3.8;

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
/** Battle chase offset at {@link BATTLE_SHIP_HULL_SCALE_DEFAULT} (scales with hull slider). */
const BATTLE_CHASE_CAM_BEHIND = 0.0020;
const BATTLE_CHASE_CAM_UP = 0.0009;
/** Orbit-math floor only — keep below chase distance at min hull scale. */
const BATTLE_CHASE_CAM_MIN_DIST = 0.0012;
/** Exponential follow rate (1/sec) for the chase camera position lerp. */
const CAM_FOLLOW_RATE = 7;
/** Extra position follow rate per unit ship speed (keeps hull size steady under thrust). */
const CAM_FOLLOW_SPEED_MULT = 23;
/** Default perspective near plane (restored when leaving shard flight). */
const FLIGHT_CAMERA_NEAR_DEFAULT = 0.1;
/** Scale-driven near plane while flight is active (must stay below chase distance at min hull scale). */
const FLIGHT_CAMERA_NEAR_SCALE_MULT = 0.42;
/** Horizontal drag across the viewport ≈ this many degrees of orbit (lower = less twitch per pixel). */
const FLIGHT_ORBIT_DRAG_TURN_FRACTION = 54 / 360;
/** How fast the live orbit offset catches the drag goal (lower = smoother / more lag). */
const CHASE_ORBIT_SMOOTH_RATE = 7;
/** Wheel: multiplicative chase-distance step per unit deltaY (matches planet follow feel). */
const CHASE_WHEEL_ZOOM_SENSITIVITY = 0.00115;
const EXPLODE_SEC = 0.75;

const _fwd = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _shipRight = new THREE.Vector3();
const _chaseOrbitDir = new THREE.Vector3();
const _tRDrag = new THREE.Vector3();
const _tUDrag = new THREE.Vector3();
const _scrRightDrag = new THREE.Vector3();
const _scrUpDrag = new THREE.Vector3();
const _landingStartPos = new THREE.Vector3();
const _landingEndPos = new THREE.Vector3();
const _landingStartQuat = new THREE.Quaternion();
const _landingEndQuat = new THREE.Quaternion();
const _qLandingSlerp = new THREE.Quaternion();
const _landingSurfaceNormal = new THREE.Vector3();
const _landingSettleStartCam = new THREE.Vector3();
const _landingSettleEndCam = new THREE.Vector3();
const _battleGoalPos = new THREE.Vector3();
const _routePos = new THREE.Vector3();
const _routeVel = new THREE.Vector3();
const _routeToGoal = new THREE.Vector3();
/** @type {{ center: THREE.Vector3, radius: number }[]} */
const _routeObstacles = [];
/** @type {THREE.Vector3[]} */
const _routeWaypoints = [];
/** @type {import('./shard-battle-helpers.js').ShardSpawnAnchor[]} */
const _battleAnchors = [];
const _battleEntryStartPos = new THREE.Vector3();
const _battleEntryEndPos = new THREE.Vector3();
const _battleEntryStartQuat = new THREE.Quaternion();
const _battleEntryEndQuat = new THREE.Quaternion();
const _battleFieldDir = new THREE.Vector3();
const _qBattleEntrySlerp = new THREE.Quaternion();
const _planetScaleScratch = new THREE.Vector3();

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** @param {{ mesh: import('three').Object3D, def: { radius: number } }} planet */
function getPlanetWorldRadius(planet) {
  planet.mesh.updateWorldMatrix(true, true);
  planet.mesh.getWorldScale(_planetScaleScratch);
  const s =
    (_planetScaleScratch.x + _planetScaleScratch.y + _planetScaleScratch.z) / 3;
  return planet.def.radius * s;
}

/**
 * @param {import('three').Vector3} out
 * @param {import('three').Quaternion} shipQuat
 * @param {number} shipScale
 * @param {boolean} battle
 */
function fillChaseCamOffset(out, shipQuat, shipScale, battle) {
  _fwd.set(0, 0, 1).applyQuaternion(shipQuat).normalize();
  if (battle) {
    const t =
      Math.max(shipScale, BATTLE_SHIP_HULL_SCALE_MIN) / BATTLE_SHIP_HULL_SCALE_DEFAULT;
    const behind = Math.max(BATTLE_CHASE_CAM_BEHIND * t, BATTLE_CHASE_CAM_MIN_DIST);
    const up = BATTLE_CHASE_CAM_UP * t;
    out.copy(_fwd).multiplyScalar(behind);
    out.y += up;
    return;
  }
  out.copy(_fwd).multiplyScalar(CAM_BEHIND);
  out.y += CAM_UP;
}

function isFlightOrbitBlockedTarget(el) {
  return !!(
    el &&
    el.closest &&
    (el.closest(".bottom-left-hud") ||
      el.closest(".enter-planet-hud") ||
      el.closest(".planet-switcher-hud") ||
      el.closest(".shard-flight-hud") ||
      el.closest(".shard-flight-throttle") ||
      el.closest(".planet-interior-hud") ||
      el.closest(".screen-dials") ||
      el.closest(".lil-gui") ||
      el.closest(".auth-ui"))
  );
}

/** Screen-aligned tangent basis on the orbit sphere at pivot→camera unit direction `u`. */
function orbitScreenTangentBasis(cam, u, tR, tU) {
  cam.updateMatrixWorld(true);
  _scrRightDrag.set(1, 0, 0).applyQuaternion(cam.quaternion);
  _scrUpDrag.set(0, 1, 0).applyQuaternion(cam.quaternion);
  tR.copy(_scrRightDrag).addScaledVector(u, -_scrRightDrag.dot(u));
  if (tR.lengthSq() < 1e-10) {
    tR.copy(_worldUp).addScaledVector(u, -_worldUp.dot(u));
  }
  if (tR.lengthSq() < 1e-10) {
    tR.set(1, 0, 0).addScaledVector(u, -u.x);
  }
  tR.normalize();
  tU.copy(_scrUpDrag).addScaledVector(u, -_scrUpDrag.dot(u));
  tU.addScaledVector(tR, -tU.dot(tR));
  if (tU.lengthSq() < 1e-10) {
    tU.copy(tR).cross(u).normalize();
  } else {
    tU.normalize();
  }
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

/** World-space line segment (two points). */
function buildFlightLine(color, renderOrder) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(6);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = renderOrder;
  return line;
}

function buildAimLine() {
  return buildFlightLine(0x67e8f9, 24);
}

/** Red line: ship → projected position after {@link PATH_PREVIEW_SEC} at current v and a. */
function buildPathLine() {
  return buildFlightLine(0xf87171, 23);
}

function buildBattleRouteLine(maxPoints) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(maxPoints * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 22;
  line.userData.pulsePhase = Math.random() * Math.PI * 2;
  return line;
}

/**
 * Fastest-time preview along shard-skirting waypoints (full throttle + RCS assist).
 * @returns {number} vertex count written to `outPositions`
 */
function fillShardAwareBattleRoutePositions(
  shipPos,
  velocity,
  goalPos,
  fuel,
  shipRadius,
  avgShardR,
  pyramidField,
  outPositions,
  maxPoints,
) {
  collectBattleShardObstacles(pyramidField, _routeObstacles);
  const clearance = shipRadius + avgShardR * BATTLE_ROUTE_CLEARANCE_SHARD_MULT;
  planBattleRouteWaypoints(shipPos, goalPos, _routeObstacles, clearance, _routeWaypoints);

  const dt = BATTLE_ROUTE_PREVIEW_SEC / Math.max(1, maxPoints - 2);
  _routePos.copy(shipPos);
  _routeVel.copy(velocity);
  let pointCount = 1;
  outPositions[0] = shipPos.x;
  outPositions[1] = shipPos.y;
  outPositions[2] = shipPos.z;

  const arrive = 0.4;
  let fuelLeft = fuel;
  let wpIdx = 0;
  let target = _routeWaypoints[wpIdx] ?? goalPos;

  for (let step = 1; step < maxPoints - 1; step++) {
    _routeToGoal.subVectors(target, _routePos);
    let dist = _routeToGoal.length();
    if (dist < arrive) {
      if (wpIdx < _routeWaypoints.length - 1) {
        wpIdx += 1;
        target = _routeWaypoints[wpIdx];
        continue;
      }
      break;
    }

    _routeToGoal.multiplyScalar(1 / dist);
    const mass = SHIP_DRY_MASS + fuelLeft;
    const thrust = SHIP_MAX_THRUST;
    const accel = thrust / mass;
    _routeVel.addScaledVector(_routeToGoal, accel * dt);
    alignVelocityToAim(_routeVel, _routeToGoal, RCS_ALIGN_RATE, dt, _vDir);
    fuelLeft = Math.max(0, fuelLeft - (thrust / SHIP_EXHAUST_V) * dt);

    const prevDist = dist;
    _routePos.addScaledVector(_routeVel, dt);
    nudgePointClearOfShardObstacles(_routePos, _routeObstacles, clearance, shipPos);

    if (wpIdx >= _routeWaypoints.length - 1) {
      if (_routePos.distanceTo(goalPos) > prevDist && _routeVel.dot(_routeToGoal) < 0) break;
    }

    outPositions[pointCount * 3] = _routePos.x;
    outPositions[pointCount * 3 + 1] = _routePos.y;
    outPositions[pointCount * 3 + 2] = _routePos.z;
    pointCount += 1;
  }

  outPositions[pointCount * 3] = goalPos.x;
  outPositions[pointCount * 3 + 1] = goalPos.y;
  outPositions[pointCount * 3 + 2] = goalPos.z;
  return pointCount + 1;
}

/** Flat 3-sided cone — same family as pyramid field shards. */
function makeShardWingGeometry() {
  const geo = new THREE.ConeGeometry(0.05, 0.11, 3);
  geo.rotateZ(-Math.PI / 2);
  geo.translate(0.048, 0, 0);
  return geo;
}

function buildShipGroup() {
  const g = new THREE.Group();
  g.frustumCulled = false;
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    metalness: 0.45,
    roughness: 0.35,
    emissive: 0x0c4a6e,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 8), hullMat);
  hull.rotation.x = -Math.PI / 2;
  hull.frustumCulled = false;
  g.add(hull);

  const wingGeo = makeShardWingGeometry();
  const wingR = new THREE.Mesh(wingGeo, hullMat);
  wingR.position.set(0.068, 0, 0.02);
  wingR.rotation.z = -0.22;
  wingR.frustumCulled = false;
  g.add(wingR);
  const wingL = new THREE.Mesh(wingGeo, hullMat);
  wingL.position.set(-0.068, 0, 0.02);
  wingL.rotation.y = Math.PI;
  wingL.rotation.z = 0.22;
  wingL.frustumCulled = false;
  g.add(wingL);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  );
  glow.position.z = -0.12;
  glow.frustumCulled = false;
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
   * @param {{ mesh: import('three').Object3D, def: { radius: number } }} opts.bluePlanet
   * @param {{ mesh: import('three').Object3D, def: { radius: number } }} opts.landingPlanet
   * @param {(detail: { planet: { mesh: import('three').Object3D }, shipPosition: import('three').Vector3, surfaceNormal: import('three').Vector3, shipVisualScale: number }) => void} [opts.onLandingComplete]
   * @param {(paused: boolean) => void} [opts.onHubSpinPausedChange] — freeze blue hub + shard field (battle)
   * @param {HTMLElement} opts.container
   * @param {{ setFlightHudActive: (v: boolean) => void, showGameOver: () => void, hideGameOver: () => void, showVictory?: () => void, hideVictory?: () => void, setBattleModeActive?: (v: boolean) => void, setThrottleVisible?: (v: boolean) => void, setFuelFraction?: (f: number) => void, resetThrottle?: () => void, setThrottleVisualValue?: (v: number) => void, setNewton?: (values: { thrust: number, mass: number, accel: number, speed: number }) => void }} opts.hud
   */
  constructor({
    scene,
    camera,
    camCtrl,
    pyramidField,
    planetMesh,
    getPlanetRadius,
    bluePlanet,
    landingPlanet,
    onLandingComplete,
    onHubSpinPausedChange,
    container,
    hud,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.camCtrl = camCtrl;
    this.pyramidField = pyramidField;
    this.planetMesh = planetMesh;
    this.getPlanetRadius = getPlanetRadius;
    this.bluePlanet = bluePlanet;
    this.landingPlanet = landingPlanet;
    this.onLandingComplete = onLandingComplete;
    this.onHubSpinPausedChange = onHubSpinPausedChange;
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
    this._pathLine = buildPathLine();
    this._pathLine.visible = false;
    this.scene.add(this._pathLine);
    this._battleRouteLine = buildBattleRouteLine(BATTLE_ROUTE_MAX_POINTS);
    this._battleRouteLine.visible = false;
    this.scene.add(this._battleRouteLine);
    this._tmpNozzleWorld = this._boosters.localPositions.map(() => new THREE.Vector3());
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    /** World offset ship → camera (smoothed each frame toward {@link _chaseCamOffsetGoal}). */
    this._chaseCamOffset = new THREE.Vector3();
    this._chaseCamOffsetGoal = new THREE.Vector3();
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
    this._chaseOrbitDragging = false;
    this._chaseOrbitLast = { x: 0, y: 0 };
    this._landingActive = false;
    this._landingElapsed = 0;
    this._landingSettleActive = false;
    this._landingSettleElapsed = 0;
    /** Hull scale at landing sequence start — camera offsets scale with ship so screen size stays steady. */
    this._landingStartScale = 1;
    this._battleMode = false;
    this._battleEntryActive = false;
    this._battleEntryElapsed = 0;
    this._battleWon = false;
    this._battleShipRadius = SHIP_RADIUS;
    this._battleGoalRadius = 0.1;
    this._battleGoalViewDist = 0.5;
    this._battleSpawnGraceRemaining = 0;
    this._battleHullScale = BATTLE_SHIP_HULL_SCALE_DEFAULT;
    this._battleEndHullScale = BATTLE_SHIP_HULL_SCALE_DEFAULT;
    this._preBattleShipScale = 1;
    /** @type {THREE.Group | null} */
    this._goalMarker = null;
    /** @type {THREE.Group | null} */
    this._battleRingBoundary = null;
    this._battleRingInnerR = 0;
    this._battleRingOuterR = 0;
    this._bindChaseOrbitInput();
  }

  _effectiveShipRadius() {
    return this._battleMode ? this._battleShipRadius : SHIP_RADIUS;
  }

  isBattleMode() {
    return this._battleMode || this._battleEntryActive;
  }

  getBattleShipHullScale() {
    return this._battleHullScale;
  }

  /** @param {number} hullScale — {@link BATTLE_SHIP_HULL_SCALE_MIN} … {@link BATTLE_SHIP_HULL_SCALE_MAX} */
  setBattleShipHullScale(hullScale) {
    const h = THREE.MathUtils.clamp(
      hullScale,
      BATTLE_SHIP_HULL_SCALE_MIN,
      BATTLE_SHIP_HULL_SCALE_MAX,
    );
    this._battleHullScale = h;
    this._battleEndHullScale = h;
    this._battleShipRadius = SHIP_RADIUS * h;
    if (this._battleMode || this._battleEntryActive) {
      this.ship.scale.setScalar(h);
      this._syncFlightCameraClip();
    }
    this.hud.setBattleShipSizeVisual?.(h);
  }

  /** Pull the near clip in when the hull is tiny so battle scale slider does not vanish the ship. */
  _syncFlightCameraClip() {
    const s = Math.max(this.ship.scale.x, BATTLE_SHIP_HULL_SCALE_MIN);
    this.camera.near = Math.max(
      0.0008,
      Math.min(FLIGHT_CAMERA_NEAR_DEFAULT, s * FLIGHT_CAMERA_NEAR_SCALE_MULT),
    );
    this.camera.updateProjectionMatrix();
  }

  _restoreFlightCameraClip() {
    this.camera.near = FLIGHT_CAMERA_NEAR_DEFAULT;
    this.camera.updateProjectionMatrix();
  }

  enterBattleMode() {
    if (
      !this.active ||
      this._battleMode ||
      this._battleEntryActive ||
      this._landingActive ||
      this._landingSettleActive
    ) {
      return;
    }
    this._beginBattleEntry();
  }

  _placeBattleGoalInView() {
    this._syncAimFromShip();
    computeBattleGoalAhead(
      this.ship.position,
      this.aimDir,
      this._battleGoalViewDist,
      this._battleGoalRadius,
      this.pyramidField,
      _battleGoalPos,
    );
  }

  _spawnBattleGoal() {
    this._disposeBattleGoal();
    const avgR = this.pyramidField.estimateAverageShardColliderRadius();
    this._goalMarker = buildBattleGoalMarker(avgR);
    this._goalMarker.position.copy(_battleGoalPos);
    this.scene.add(this._goalMarker);
  }

  _setBattleHubFrozen(frozen) {
    this.pyramidField.setSimulationPaused(frozen);
    if (typeof this.onHubSpinPausedChange === "function") {
      this.onHubSpinPausedChange(frozen);
    }
  }

  _beginBattleEntry() {
    this._battleWon = false;
    this.gameOver = false;
    this.pyramidField.prepareRingPatternForBattle();
    this._setBattleHubFrozen(true);
    this._preBattleShipScale = this.ship.scale.x;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this._throttlePressed = false;
    this.boostTimeRemaining = 0;
    this._chaseOrbitDragging = false;
    this._aimLine.visible = false;
    this._pathLine.visible = false;
    this._battleRouteLine.visible = false;
    this.hud.setThrottleVisible?.(false);
    this.hud.hideGameOver?.();
    this.hud.hideVictory?.();
    this.hud.setBattleModeActive?.(true);

    this._battleEndHullScale = this._battleHullScale;
    this._battleShipRadius = SHIP_RADIUS * this._battleHullScale;
    computeBattleSpawnInShardField(
      this.planetMesh,
      this.pyramidField,
      this._battleShipRadius,
      _battleEntryEndPos,
      _battleFieldDir,
    );
    const metrics = computeBattleShipMetrics(this.pyramidField);
    this._battleGoalRadius = metrics.goalRadius;
    this._battleGoalViewDist = metrics.goalViewDist;
    this.hud.setBattleShipSizeVisible?.(true);
    this.hud.setBattleShipSizeVisual?.(this._battleHullScale);

    _battleEntryStartPos.copy(this.ship.position);
    _battleEntryStartQuat.copy(this.ship.quaternion);
    this.planetMesh.getWorldPosition(_planetCenter);
    collectShardSpawnAnchors(this.pyramidField, _battleAnchors);
    computeBattleGoalAlongRing(
      _battleEntryEndPos,
      _planetCenter,
      _battleAnchors,
      this.pyramidField,
      metrics.goalRadius,
      this._battleShipRadius * BATTLE_SPAWN_CLEARANCE_MULT,
      _battleGoalPos,
    );
    _battleFieldDir.subVectors(_battleGoalPos, _battleEntryEndPos);
    if (_battleFieldDir.lengthSq() < 1e-8) {
      _battleFieldDir.set(0, 0, -1);
    } else {
      _battleFieldDir.normalize();
    }
    computeBattleOrientationTowardGoal(
      _battleEntryEndPos,
      _battleGoalPos,
      _battleEntryEndQuat,
    );

    this._battleEntryActive = false;
    this._battleEntryElapsed = 0;
    this._finishBattleEntry();
  }

  _finishBattleEntry() {
    this._battleEntryActive = false;
    this.ship.position.copy(_battleEntryEndPos);
    this.ship.quaternion.copy(_battleEntryEndQuat);
    this.ship.scale.setScalar(this._battleEndHullScale);
    this._battleMode = true;
    this._battleSpawnGraceRemaining = 0.55;
    this._syncAimFromShip();
    this._snapChaseCameraBehindShip();
    this._spawnBattleGoal();
    this._spawnBattleRingBoundary();
    this._battleRouteLine.visible = true;
    this.hud.setThrottleVisible?.(true);
    this.hud.resetThrottle?.();
  }

  _updateBattleEntry(dt) {
    this._battleEntryElapsed += dt;
    const t = Math.min(1, this._battleEntryElapsed / BATTLE_ENTRY_DURATION_SEC);
    const u = easeInOutCubic(t);
    this.ship.position.lerpVectors(_battleEntryStartPos, _battleEntryEndPos, u);
    _qBattleEntrySlerp.copy(_battleEntryStartQuat).slerp(_battleEntryEndQuat, u);
    this.ship.quaternion.copy(_qBattleEntrySlerp);
    this.ship.scale.setScalar(
      THREE.MathUtils.lerp(this._preBattleShipScale, this._battleHullScale, u),
    );
    updateBoosterFlames(this._boosters, (1 - t) * 0.35, dt);
    if (t >= 1) this._finishBattleEntry();
  }

  _updateBattleEntryCamera(dt) {
    if (this._chaseOrbitDragging) {
      this._smoothChaseOrbitOffset(dt);
    }
    const target = this.ship.position;
    _camWant.copy(target).add(this._chaseCamOffset);
    this.camera.position.copy(_camWant);
    this.camera.lookAt(target);
  }

  exitBattleMode() {
    if (!this._battleMode && !this._battleEntryActive) return;
    this._battleEntryActive = false;
    this._battleMode = false;
    this._battleWon = false;
    this._setBattleHubFrozen(false);
    this.ship.scale.setScalar(this._preBattleShipScale);
    this._battleShipRadius = SHIP_RADIUS;
    this._snapChaseCameraBehindShip();
    this._syncFlightCameraClip();
    this._disposeBattleGoal();
    this._disposeBattleRingBoundary();
    this._battleRouteLine.visible = false;
    this.hud.setBattleModeActive?.(false);
    this.hud.setBattleShipSizeVisible?.(false);
    this.hud.hideVictory?.();
    this.hud.setThrottleVisible?.(true);
  }

  _planetMeanScale() {
    this.planetMesh.updateWorldMatrix(true, true);
    this.planetMesh.getWorldScale(_planetScaleScratch);
    return (
      (_planetScaleScratch.x + _planetScaleScratch.y + _planetScaleScratch.z) / 3
    );
  }

  _spawnBattleRingBoundary() {
    this._disposeBattleRingBoundary();
    const { innerR, outerR, wallHeight } = computeBattleRingBoundaryRadii(this.pyramidField);
    this._battleRingInnerR = innerR;
    this._battleRingOuterR = outerR;
    this._battleRingBoundary = buildBattleRingBoundaryMesh(innerR, outerR, wallHeight);
    this.planetMesh.add(this._battleRingBoundary);
  }

  _disposeBattleRingBoundary() {
    if (!this._battleRingBoundary) return;
    this.planetMesh.remove(this._battleRingBoundary);
    disposeBattleRingBoundaryMesh(this._battleRingBoundary);
    this._battleRingBoundary = null;
  }

  _checkBattleRingBoundary() {
    if (!this._battleMode || this.gameOver || this._battleWon) return;
    if (this._battleSpawnGraceRemaining > 0) return;
    if (
      isShipOutsideBattleRingBoundaryWorld(
        this.ship.position,
        this.planetMesh,
        this._battleRingInnerR,
        this._battleRingOuterR,
        this._battleShipRadius,
      )
    ) {
      this._triggerGameOver();
    }
  }

  _disposeBattleGoal() {
    if (!this._goalMarker) return;
    this.scene.remove(this._goalMarker);
    this._goalMarker.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this._goalMarker = null;
  }

  _pulseBattleGoal(dt) {
    if (!this._goalMarker) return;
    const ud = this._goalMarker.userData;
    const phase = (ud.pulsePhase += dt * 2.6);
    const s = 1 + Math.sin(phase) * 0.07;
    this._goalMarker.scale.setScalar(s);
    this._goalMarker.lookAt(this.camera.position);
    const spinRings = ud.spinRings;
    if (!spinRings) return;
    for (let i = 0; i < spinRings.length; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      spinRings[i].rotation.z += dt * (0.45 + i * 0.22) * dir;
    }
  }

  _checkBattleGoal() {
    if (!this._battleMode || this.gameOver || this._battleWon || !this._goalMarker) return;
    if (
      spheresOverlap(
        this.ship.position,
        this._battleShipRadius,
        _battleGoalPos,
        this._battleGoalRadius,
      )
    ) {
      this._triggerVictory();
    }
  }

  _triggerVictory() {
    if (this._battleWon || this.gameOver) return;
    this._battleWon = true;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.boostTimeRemaining = 0;
    this._battleRouteLine.visible = false;
    updateBoosterFlames(this._boosters, 0, 1);
    this.hud.showVictory?.();
  }

  /** White pulsing polyline: simulated full-throttle path toward the battle goal. */
  _updateBattleRouteLine(dt) {
    if (!this._battleRouteLine.visible) return;

    const ud = this._battleRouteLine.userData;
    const phase = (ud.pulsePhase += dt * BATTLE_ROUTE_PULSE_RATE);
    const mat = /** @type {THREE.LineBasicMaterial} */ (this._battleRouteLine.material);
    mat.opacity = 0.38 + 0.52 * (0.5 + 0.5 * Math.sin(phase));

    const attr = this._battleRouteLine.geometry.attributes.position;
    const avgShardR = this.pyramidField.estimateAverageShardColliderRadius();
    const pointCount = fillShardAwareBattleRoutePositions(
      this.ship.position,
      this.velocity,
      _battleGoalPos,
      this.fuel,
      this._battleShipRadius,
      avgShardR,
      this.pyramidField,
      attr.array,
      BATTLE_ROUTE_MAX_POINTS,
    );
    attr.needsUpdate = true;
    this._battleRouteLine.geometry.setDrawRange(0, pointCount);
    this._battleRouteLine.geometry.computeBoundingSphere();
  }

  /** Right-click drag orbits the chase camera around the ship (ship → camera offset). */
  _bindChaseOrbitInput() {
    if (this._chaseOrbitInputBound) return;
    this._chaseOrbitInputBound = true;
    const container = this.container;

    const onMouseDown = (/** @type {MouseEvent} */ e) => {
      if (!this.active || e.button !== 2) return;
      const t = /** @type {Node | null} */ (e.target);
      if (!t || !container.contains(t) || isFlightOrbitBlockedTarget(/** @type {Element} */ (t))) {
        return;
      }
      e.preventDefault();
      this._chaseOrbitDragging = true;
      this._chaseCamOffsetGoal.copy(this._chaseCamOffset);
      this._chaseOrbitLast.x = e.clientX;
      this._chaseOrbitLast.y = e.clientY;
    };
    const onMouseMove = (/** @type {MouseEvent} */ e) => {
      if (!this._chaseOrbitDragging) return;
      const dx = e.clientX - this._chaseOrbitLast.x;
      const dy = e.clientY - this._chaseOrbitLast.y;
      this._chaseOrbitLast.x = e.clientX;
      this._chaseOrbitLast.y = e.clientY;
      if (dx !== 0 || dy !== 0) this._applyChaseOrbitDrag(dx, dy);
    };
    const endOrbitDrag = (/** @type {MouseEvent} */ e) => {
      if (e.button === 2) this._chaseOrbitDragging = false;
    };
    const onContextMenu = (/** @type {MouseEvent} */ e) => {
      if (this.active) e.preventDefault();
    };
    const onWheel = (/** @type {WheelEvent} */ e) => {
      if (!this.active || this._landingActive || this._landingSettleActive) return;
      const t = /** @type {Node | null} */ (e.target);
      if (!t || !container.contains(t) || isFlightOrbitBlockedTarget(/** @type {Element} */ (t))) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this._applyChaseZoomWheel(e.deltaY);
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", endOrbitDrag, true);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    container.addEventListener("contextmenu", onContextMenu);
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.gameOver = false;
    this._landingActive = false;
    this._landingElapsed = 0;
    this._landingSettleActive = false;
    this._landingSettleElapsed = 0;
    this.ship.scale.setScalar(1);
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
    this.hud.setFlightHudActive(true);
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
    this._aimLine.visible = false;
    this._pathLine.visible = false;
    this.enterBattleMode();
  }

  /**
   * @param {{ mesh: import('three').Mesh }} primaryPlanet
   * @param {{ retainShip?: boolean }} [opts]
   */
  exit(primaryPlanet, opts = {}) {
    if (!this.active) return;
    const { retainShip = false } = opts;
    if (this._battleMode || this._battleEntryActive) this.exitBattleMode();
    this.active = false;
    this.gameOver = false;
    this._landingActive = false;
    this._landingSettleActive = false;
    this._throttlePressed = false;
    if (!retainShip) this.ship.scale.setScalar(1);
    this.camCtrl.shardFlightMode = false;
    this.camCtrl.followPlanet = primaryPlanet;
    this.camCtrl.followComet = null;
    if (!retainShip) this.scene.remove(this.ship);
    this._disposeExplosion();
    clearSmokeTrail(this._smoke);
    this._smoke.visible = false;
    updateBoosterFlames(this._boosters, 0, 1);
    this.hud.setFlightHudActive(false);
    this.hud.setThrottleVisible?.(false);
    this.hud.hideGameOver();
    this._aimLine.visible = false;
    this._pathLine.visible = false;
    this._restoreFlightCameraClip();
  }

  restart() {
    if (!this.active) return;
    const wasBattle = this._battleMode || this._battleEntryActive;
    this._disposeExplosion();
    this.gameOver = false;
    this._battleWon = false;
    this._landingActive = false;
    this._landingElapsed = 0;
    this._landingSettleActive = false;
    this._landingSettleElapsed = 0;
    this.ship.visible = true;
    this.hud.hideVictory?.();
    if (wasBattle) {
      this.exitBattleMode();
      this.enterBattleMode();
      return;
    }
    this.ship.scale.setScalar(1);
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
    this._snapChaseCameraBehindShip();
    this.hud.setThrottleVisible?.(true);
    this.hud.resetThrottle?.();
    this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
    this.hud.hideGameOver();
    this._aimLine.visible = true;
    this._pathLine.visible = true;
    this._updateAimLine();
    this._updatePathLine();
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
    const minD = R + SHELL_PAD_MIN + this._effectiveShipRadius();
    const spawnR = Math.min(Math.max(camDist, minD + 0.5), SHELL_MAX - 0.5);
    this.ship.position.copy(_planetCenter).addScaledVector(_offset, spawnR);
    this.aimDir.copy(_offset).negate().normalize();
    this.ship.quaternion.setFromUnitVectors(SHIP_NOSE_LOCAL, this.aimDir);
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
  }

  /**
   * Place the camera directly behind the ship (along local +Z / tail) and store a fixed
   * world-space follow offset so the hull can yaw underneath a stable view.
   */
  _snapChaseCameraBehindShip() {
    const target = this.ship.position;
    const battle = this._battleMode || this._battleEntryActive;
    fillChaseCamOffset(
      this._chaseCamOffset,
      this.ship.quaternion,
      battle ? this.ship.scale.x : 1,
      battle,
    );
    this._chaseCamOffsetGoal.copy(this._chaseCamOffset);
    this.camera.position.copy(target).add(this._chaseCamOffset);
    this.camera.lookAt(target);
  }

  /** Ease {@link _chaseCamOffset} toward {@link _chaseCamOffsetGoal} (direction + distance). */
  _smoothChaseOrbitOffset(dt) {
    const goalDist = this._chaseCamOffsetGoal.length();
    if (goalDist < 1e-6) return;

    if (this._chaseOrbitDragging) {
      this._chaseCamOffset.copy(this._chaseCamOffsetGoal);
      return;
    }

    const t = 1 - Math.exp(-CHASE_ORBIT_SMOOTH_RATE * dt);
    const curDist = this._chaseCamOffset.length();
    if (curDist < 1e-6) {
      this._chaseCamOffset.copy(this._chaseCamOffsetGoal);
      return;
    }

    _chaseOrbitDir.copy(this._chaseCamOffset).multiplyScalar(1 / curDist);
    _offset.copy(this._chaseCamOffsetGoal).multiplyScalar(1 / goalDist);
    _chaseOrbitDir.lerp(_offset, t).normalize();
    const dist = THREE.MathUtils.lerp(curDist, goalDist, t);
    this._chaseCamOffset.copy(_chaseOrbitDir).multiplyScalar(dist);
  }

  /**
   * Per-frame chase camera: follow the ship with the spawn offset; orientation stays world-locked.
   * @param {number} dt
   */
  _updateChaseCamera(dt) {
    if (this._chaseOrbitDragging) {
      this._smoothChaseOrbitOffset(dt);
    }
    const target = this.gameOver && this._explosion
      ? this._explosion.position
      : this.ship.position;
    _camWant.copy(target).add(this._chaseCamOffset);
    const battle = this._battleMode || this._battleEntryActive;
    if (battle) {
      this.camera.position.copy(_camWant);
    } else {
      const speed = this.velocity.length();
      const rate = CAM_FOLLOW_RATE + speed * CAM_FOLLOW_SPEED_MULT;
      this.camera.position.lerp(_camWant);
    }
    this.camera.lookAt(target);
  }

  /** @returns {{ min: number, max: number }} */
  _chaseZoomDistanceLimits() {
    if (this._battleMode || this._battleEntryActive) {
      const t =
        Math.max(this.ship.scale.x, BATTLE_SHIP_HULL_SCALE_MIN) /
        BATTLE_SHIP_HULL_SCALE_DEFAULT;
      const base = Math.max(BATTLE_CHASE_CAM_BEHIND * t, BATTLE_CHASE_CAM_MIN_DIST);
      return { min: base * 0.3, max: base * 8 };
    }
    return { min: CAM_BEHIND * 0.25, max: CAM_BEHIND * 10 };
  }

  /**
   * Scroll wheel: scale ship→camera distance (zoom in / out on the chase view).
   * @param {number} deltaY
   */
  _applyChaseZoomWheel(deltaY) {
    let dist = this._chaseCamOffsetGoal.length();
    if (dist < 1e-6) {
      dist = this._chaseCamOffset.length();
      if (dist < 1e-6) return;
      this._chaseCamOffsetGoal.copy(this._chaseCamOffset);
    }
    const { min, max } = this._chaseZoomDistanceLimits();
    const factor = Math.exp(deltaY * CHASE_WHEEL_ZOOM_SENSITIVITY);
    const newDist = THREE.MathUtils.clamp(dist * factor, min, max);
    _chaseOrbitDir.copy(this._chaseCamOffsetGoal).multiplyScalar(1 / dist);
    this._chaseCamOffsetGoal.copy(_chaseOrbitDir).multiplyScalar(newDist);
    this._chaseCamOffset.copy(this._chaseCamOffsetGoal);
  }

  /**
   * Right-drag updates the orbit goal only; {@link _smoothChaseOrbitOffset} eases the live offset.
   * @param {number} dx
   * @param {number} dy
   */
  _applyChaseOrbitDrag(dx, dy) {
    let dist = this._chaseCamOffsetGoal.length();
    if (dist < 1e-6) {
      dist = this._chaseCamOffset.length();
      if (dist < 1e-6) return;
      this._chaseCamOffsetGoal.copy(this._chaseCamOffset);
    }

    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const horiz = (dx / w) * Math.PI * 2 * FLIGHT_ORBIT_DRAG_TURN_FRACTION;
    const vert = (dy / h) * Math.PI * 2 * FLIGHT_ORBIT_DRAG_TURN_FRACTION;

    _chaseOrbitDir.copy(this._chaseCamOffsetGoal).multiplyScalar(1 / dist);
    orbitScreenTangentBasis(this.camera, _chaseOrbitDir, _tRDrag, _tUDrag);
    const pitchAngle = -vert;
    const dyPerTheta = _tRDrag.z * _chaseOrbitDir.x - _tRDrag.x * _chaseOrbitDir.z;
    const brake = poleBrake(_chaseOrbitDir.y, pitchAngle * dyPerTheta);
    _chaseOrbitDir.applyAxisAngle(_tRDrag, pitchAngle * brake);
    _chaseOrbitDir.applyAxisAngle(_tUDrag, -horiz);
    _chaseOrbitDir.normalize();
    this._chaseCamOffsetGoal.copy(_chaseOrbitDir).multiplyScalar(dist);
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
    if (this.gameOver || this._battleWon) return;
    this.gameOver = true;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this.boostTimeRemaining = 0;
    updateBoosterFlames(this._boosters, 0, 1);
    this.ship.visible = false;
    this._aimLine.visible = false;
    this._pathLine.visible = false;
    this._battleRouteLine.visible = false;
    this._explosion = makeExplosionPoints();
    this._explosion.position.copy(this.ship.position);
    this.scene.add(this._explosion);
    this.hud.showGameOver();
  }

  /** W / S pitch (nose up / down), A / D yaw (world up); no angle clamps. */
  _turnShip(dt) {
    const k = this.camCtrl.keys;
    let yaw = 0;
    if (k.a) yaw += SHIP_YAW_RATE * dt;
    if (k.d) yaw -= SHIP_YAW_RATE * dt;
    if (yaw !== 0) {
      _qYaw.setFromAxisAngle(_worldUp, yaw);
      this.ship.quaternion.premultiply(_qYaw);
    }

    let pitch = 0;
    if (k.w) pitch += SHIP_PITCH_RATE * dt;
    if (k.s) pitch -= SHIP_PITCH_RATE * dt;
    if (pitch !== 0) {
      _shipRight.set(1, 0, 0).applyQuaternion(this.ship.quaternion).normalize();
      _qPitch.setFromAxisAngle(_shipRight, pitch);
      this.ship.quaternion.premultiply(_qPitch);
    }

    if (yaw !== 0 || pitch !== 0) this.ship.quaternion.normalize();
  }

  /** Nose direction and thrust-line endpoint from the ship's current orientation. */
  _syncAimFromShip() {
    this.aimDir.set(0, 0, -1).applyQuaternion(this.ship.quaternion).normalize();
    this.aimWorld.copy(this.ship.position).addScaledVector(this.aimDir, AIM_FAR_DIST);
  }

  /**
   * Unit vector from the ship toward the aim point (ship → {@link aimWorld}). That line is
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
  }

  /** Same inner radius as {@link _clampShell} — ship cannot fly closer during normal flight. */
  _shellInnerDistance() {
    return this.getPlanetRadius() + SHELL_PAD_MIN + this._effectiveShipRadius();
  }

  _tryBeginBluePlanetLanding() {
    if (this._battleMode || this._battleEntryActive || this._landingActive || this.gameOver) {
      return false;
    }
    if (!this.bluePlanet?.mesh || !this.landingPlanet?.mesh) return false;
    this._beginLandingSequence();
    return true;
  }

  _clampShell() {
    if (this._battleMode || this._battleEntryActive) return;
    this.planetMesh.getWorldPosition(_planetCenter);
    const R = this.getPlanetRadius();
    _offset.subVectors(this.ship.position, _planetCenter);
    const d = _offset.length();
    const minD = R + SHELL_PAD_MIN + this._effectiveShipRadius();
    const maxD = SHELL_MAX;
    if (d < 1e-6) return;
    const radialOut = _offset.multiplyScalar(1 / d);
    if (d < minD) {
      if (this._tryBeginBluePlanetLanding()) return;
      this.ship.position.copy(_planetCenter).addScaledVector(radialOut, minD);
      const vIn = this.velocity.dot(radialOut);
      if (vIn < 0) this.velocity.addScaledVector(radialOut, -vIn);
    } else if (d > maxD) {
      this.ship.position.copy(_planetCenter).addScaledVector(radialOut, maxD);
      const vOut = this.velocity.dot(radialOut);
      if (vOut > 0) this.velocity.addScaledVector(radialOut, -vOut);
    }
  }

  _checkShardHit(dt) {
    if (!this._battleMode || this.gameOver || this._battleWon) return;
    if (this._battleSpawnGraceRemaining > 0) {
      this._battleSpawnGraceRemaining = Math.max(0, this._battleSpawnGraceRemaining - dt);
      return;
    }
    const shipPos = this.ship.position;
    const shipR = this._battleShipRadius * BATTLE_HIT_SHIP_RADIUS_MULT;
    let hit = false;
    this.pyramidField.forEachBattleShardCollider(
      ({ centerWorld, radius, fragmentIndex }) => {
        if (hit) return;
        const shardR = battleShardHitRadius(radius, fragmentIndex);
        if (spheresOverlap(shipPos, shipR, centerWorld, shardR)) {
          hit = true;
        }
      },
    );
    if (hit) this._triggerGameOver();
  }

  /** Fallback when the ship sits on the shell without crossing inward this frame. */
  _checkBluePlanetLandingTrigger() {
    if (this._battleMode || this._battleEntryActive || this._landingActive || this.gameOver) {
      return;
    }
    if (!this.bluePlanet?.mesh || !this.landingPlanet?.mesh) return;
    this.bluePlanet.mesh.getWorldPosition(_planetCenter);
    _offset.subVectors(this.ship.position, _planetCenter);
    const d = _offset.length();
    if (d > this._shellInnerDistance() + 0.04) return;
    this._tryBeginBluePlanetLanding();
  }

  _computeLandingPose() {
    this.landingPlanet.mesh.getWorldPosition(_planetCenter);
    const planetR = getPlanetWorldRadius(this.landingPlanet);
    _offset.subVectors(this.ship.position, _planetCenter);
    if (_offset.lengthSq() < 1e-8) _offset.set(1, 0, 0);
    _offset.normalize();
    _landingEndPos.copy(_planetCenter).addScaledVector(_offset, planetR + LANDING_SURFACE_PAD);
    _landingEndQuat.setFromUnitVectors(SHIP_NOSE_LOCAL, _offset);
    _landingSurfaceNormal.copy(_offset);
  }

  /**
   * Side-on camera beside the pad (horizon in frame, shards in the sky).
   * @param {import('three').Vector3} outPos
   * @param {boolean} [settled] Wider framing after touchdown.
   */
  _computeLandingOverlookPosition(outPos, settled = false) {
    const ref = this._landingStartScale > 1e-8 ? this._landingStartScale : 1;
    const scaleComp = this.ship.scale.x / ref;
    const side =
      (settled ? LANDED_HORIZON_CAM_SIDE : LANDING_HORIZON_CAM_SIDE) * scaleComp;
    const lift =
      (settled ? LANDED_HORIZON_CAM_LIFT : LANDING_HORIZON_CAM_LIFT) * scaleComp;
    computeHorizonShipCameraPosition(
      this.ship.position,
      _landingSurfaceNormal,
      outPos,
      side,
      lift,
    );
  }

  /** Chase the ship during descent using a surface-relative overlook offset. */
  _updateLandingCamera(dt) {
    this._computeLandingOverlookPosition(_camWant, false);
    const factor = 1 - Math.exp(-LANDING_CAM_FOLLOW_RATE * dt);
    this.camera.position.lerp(_camWant, factor);
    this.camera.lookAt(this.ship.position);
  }

  _beginLandingSettle() {
    this._landingSettleActive = true;
    this._landingSettleElapsed = 0;
    _landingSettleStartCam.copy(this.camera.position);
    this._computeLandingOverlookPosition(_landingSettleEndCam, true);
  }

  _updateLandingSettle(dt) {
    this._landingSettleElapsed += dt;
    const t = Math.min(1, this._landingSettleElapsed / LANDING_SETTLE_SEC);
    const u = easeInOutCubic(t);
    this.camera.position.lerpVectors(_landingSettleStartCam, _landingSettleEndCam, u);
    this.camera.lookAt(this.ship.position);
    updateBoosterFlames(this._boosters, (1 - t) * 0.12, dt);
    if (t >= 1) this._finishLandingSettle();
  }

  _finishLandingSettle() {
    this._landingSettleActive = false;
    if (this.landingPlanet?.mesh) {
      this.landingPlanet.mesh.attach(this.ship);
    }
    if (typeof this.onLandingComplete === "function") {
      this.onLandingComplete({
        planet: this.landingPlanet,
        shipPosition: this.ship.position.clone(),
        surfaceNormal: _landingSurfaceNormal.clone(),
        shipVisualScale: this.ship.scale.x,
      });
    }
  }

  _beginLandingSequence() {
    this._landingActive = true;
    this._landingElapsed = 0;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    this._throttlePressed = false;
    this.boostTimeRemaining = 0;
    this._chaseOrbitDragging = false;
    this._aimLine.visible = false;
    this._pathLine.visible = false;
    this.hud.setThrottleVisible?.(false);
    this._landingStartScale = this.ship.scale.x;
    _landingStartPos.copy(this.ship.position);
    _landingStartQuat.copy(this.ship.quaternion);
    this._computeLandingPose();
  }

  _finishLandingSequence() {
    this._landingActive = false;
    this.ship.position.copy(_landingEndPos);
    this.ship.quaternion.copy(_landingEndQuat);
    this.ship.scale.setScalar(LANDING_END_SCALE);
    this._beginLandingSettle();
  }

  /** Shrink, translate, and pitch the ship onto the landing planet (boosters down). */
  _updateLandingSequence(dt) {
    this._landingElapsed += dt;
    const t = Math.min(1, this._landingElapsed / LANDING_DURATION_SEC);
    const u = easeInOutCubic(t);
    this.ship.position.lerpVectors(_landingStartPos, _landingEndPos, u);
    _qLandingSlerp.copy(_landingStartQuat).slerp(_landingEndQuat, u);
    this.ship.quaternion.copy(_qLandingSlerp);
    this.ship.scale.setScalar(
      THREE.MathUtils.lerp(this._landingStartScale, LANDING_END_SCALE, u),
    );
    this.landingPlanet.mesh.getWorldPosition(_planetCenter);
    _offset.subVectors(this.ship.position, _planetCenter);
    if (_offset.lengthSq() > 1e-8) _landingSurfaceNormal.copy(_offset).normalize();
    updateBoosterFlames(this._boosters, (1 - t) * 0.35, dt);
    if (t >= 1) this._finishLandingSequence();
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

  /** Refresh the ship → aim thrust line in world space. */
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
   * Red preview: s = v·t + ½·a·t² along the nose (current {@link velocity} and {@link _lastAccel}).
   */
  _updatePathLine() {
    const speed = this.velocity.length();
    const show =
      speed >= PATH_MIN_SPEED || this._lastAccel > 1e-5;
    this._pathLine.visible = show;
    if (!show) return;

    const t = PATH_PREVIEW_SEC;
    _offset.copy(this.velocity).multiplyScalar(t);
    if (this._lastAccel > 1e-6) {
      _offset.addScaledVector(this.aimDir, 0.5 * this._lastAccel * t * t);
    }

    const attr = this._pathLine.geometry.attributes.position;
    const p = attr.array;
    p[0] = this.ship.position.x;
    p[1] = this.ship.position.y;
    p[2] = this.ship.position.z;
    p[3] = this.ship.position.x + _offset.x;
    p[4] = this.ship.position.y + _offset.y;
    p[5] = this.ship.position.z + _offset.z;
    attr.needsUpdate = true;
    this._pathLine.geometry.computeBoundingSphere();
  }

  /**
   * Call after `pyramidField.update` each frame while mode may be active.
   * @param {number} dt
   */
  update(dt) {
    if (!this.active) return;

    if (this._landingSettleActive) {
      this._updateLandingSettle(dt);
      return;
    }

    if (this._battleEntryActive) {
      this._updateBattleEntry(dt);
      this._updateBattleEntryCamera(dt);
      return;
    }

    if (this._landingActive) {
      this._updateLandingSequence(dt);
      this._updateLandingCamera(dt);
      return;
    }

    if (!this.gameOver && !this._battleWon) {
      this._updateThrottleFromPress(dt);
      if (this._battleMode || this._battleEntryActive) this._syncFlightCameraClip();
      this._updateChaseCamera(dt);
      this._turnShip(dt);
      this._syncAimFromShip();
      this._integrateShip(dt);
      this._clampShell();
      if (this._battleMode) {
        this._checkShardHit(dt);
        this._checkBattleRingBoundary();
        this._checkBattleGoal();
        this._pulseBattleGoal(dt);
        this._updateBattleRouteLine(dt);
        if (this._goalMarker) {
          this._goalMarker.position.copy(_battleGoalPos);
        }
      } else {
        this._checkBluePlanetLandingTrigger();
      }
      this._updateBoosterVisuals(dt);
      this.hud.setFuelFraction?.(this.fuel / SHIP_FUEL_MAX);
      this.hud.setThrottleVisualValue?.(this.throttle);
      this.hud.setNewton?.({
        thrust: this._lastThrust,
        mass: this._lastMass,
        accel: this._lastAccel,
        speed: this.velocity.length(),
      });
    } else if (!this._battleWon) {
      this._updateExplosion(dt);
      this._updateBoosterVisuals(dt);
      this._updateChaseCamera(dt);
    } else {
      this._updateChaseCamera(dt);
      this._pulseBattleGoal(dt);
    }

    if (this._aimLine.visible) this._updateAimLine();
    if (!this.gameOver && !this._battleWon) this._updatePathLine();
  }
}
