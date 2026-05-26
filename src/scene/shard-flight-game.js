import * as THREE from "three";
import { spheresOverlap } from "./shard-flight-collision.js";

const SHIP_RADIUS = 0.075;
const AIM_SPEED = 28;
const SHIP_ACCEL = 52;
const SHIP_MAX_SPEED = 26;
const SHELL_PAD_MIN = 0.32;
const SHELL_MAX = 26;
const CAM_BEHIND = 3.1;
const CAM_UP = 0.62;
const CAM_LERP_POS = 0.1;
const EXPLODE_SEC = 0.75;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _look = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

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
  hull.rotation.x = Math.PI / 2;
  g.add(hull);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  );
  glow.position.z = 0.12;
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
   * @param {{ setAimDotVisible: (v: boolean) => void, syncAimDot: (cam: import('three').Camera, aim: import('three').Vector3, container: HTMLElement) => void, showGameOver: () => void, hideGameOver: () => void }} opts.hud
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
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
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
    const R = this.getPlanetRadius() + 1.85;

    this.camera.getWorldDirection(_fwd);
    _fwd.normalize();
    this.ship.position.copy(_planetCenter).addScaledVector(_fwd, R);

    this.aimWorld.copy(this.ship.position).addScaledVector(_fwd, 3);

    this.scene.add(this.ship);
    this.hud.setAimDotVisible(true);
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
    this.hud.setAimDotVisible(false);
    this.hud.hideGameOver();
  }

  restart() {
    if (!this.active) return;
    this._disposeExplosion();
    this.gameOver = false;
    this.ship.visible = true;
    this.velocity.set(0, 0, 0);
    this.planetMesh.getWorldPosition(_planetCenter);
    const R = this.getPlanetRadius() + 1.85;
    this.camera.getWorldDirection(_fwd);
    _fwd.normalize();
    this.ship.position.copy(_planetCenter).addScaledVector(_fwd, R);
    this.ship.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _fwd);
    this.aimWorld.copy(this.ship.position).addScaledVector(_fwd, 3);
    this.hud.hideGameOver();
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
    this.ship.visible = false;
    this._explosion = makeExplosionPoints();
    this._explosion.position.copy(this.ship.position);
    this.scene.add(this._explosion);
    this.hud.showGameOver();
  }

  _moveAim(dt) {
    const k = this.camCtrl.keys;
    this.camera.getWorldDirection(_fwd);
    _fwd.normalize();
    _right.crossVectors(_fwd, _worldUp);
    if (_right.lengthSq() < 1e-8) {
      _right.set(1, 0, 0);
    } else {
      _right.normalize();
    }
    const sp = AIM_SPEED * dt;
    if (k.w) this.aimWorld.y += sp;
    if (k.s) this.aimWorld.y -= sp;
    if (k.a) this.aimWorld.addScaledVector(_right, -sp);
    if (k.d) this.aimWorld.addScaledVector(_right, sp);
  }

  _integrateShip(dt) {
    _toAim.subVectors(this.aimWorld, this.ship.position);
    const dist = _toAim.length();
    if (dist > 0.02) {
      _toAim.multiplyScalar(1 / dist);
      this.velocity.addScaledVector(_toAim, SHIP_ACCEL * dt);
      const spd = this.velocity.length();
      if (spd > SHIP_MAX_SPEED) {
        this.velocity.multiplyScalar(SHIP_MAX_SPEED / spd);
      }
    } else {
      this.velocity.multiplyScalar(Math.max(0, 1 - 3 * dt));
    }
    this.ship.position.addScaledVector(this.velocity, dt);
    if (dist > 0.05) {
      this.ship.lookAt(this.aimWorld);
    }
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

  _updateChaseCamera() {
    const target = this.gameOver && this._explosion
      ? this._explosion.position
      : this.ship.position;
    _offset.set(0, CAM_UP, CAM_BEHIND).applyQuaternion(this.ship.quaternion);
    _camWant.copy(target).add(_offset);
    this.camera.position.lerp(_camWant, CAM_LERP_POS);
    _look.copy(target);
    this.camera.lookAt(_look);
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
    } else {
      this._updateExplosion(dt);
    }

    this.hud.syncAimDot(this.camera, this.aimWorld, this.container);
    this._updateChaseCamera();
  }
}
