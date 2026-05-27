import * as THREE from "three";
import { spheresOverlap } from "./shard-flight-collision.js";

const SHIP_RADIUS = 0.075;
const AIM_SPEED = 22;
const AIM_LEAD_MIN = 4;
const AIM_LEAD_MAX = 16;
const SHIP_ACCEL = 48;
const SHIP_MAX_SPEED = 22;
const SHIP_DRAG = 2.2;
const FLIGHT_START_DIST = 40;
const SHIP_RADIAL_INSET = 1.5;
const SHELL_PAD_MIN = 0.32;
const SHELL_MAX = 55;
const CAM_BEHIND = 3.4;
const CAM_UP = 0.55;
const EXPLODE_SEC = 0.75;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _camWant = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _viewDir = new THREE.Vector3();
const _zForward = new THREE.Vector3(0, 0, 1);
const _prevCamPos = new THREE.Vector3();
const _camDelta = new THREE.Vector3();

function buildShipGroup() {
  const g = new THREE.Group();
  g.name = "shardFlightShip";
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.32, 8),
    new THREE.MeshStandardMaterial({
      color: 0xf97316,
      metalness: 0.45,
      roughness: 0.35,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.35,
    }),
  );
  hull.rotation.x = Math.PI / 2;
  g.add(hull);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfdba74 }),
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

    this.flightLayer = new THREE.Group();
    this.flightLayer.name = "shardFlightLayer";
    scene.add(this.flightLayer);

    this.active = false;
    this.gameOver = false;
    this._flightEngaged = false;
    this.ship = buildShipGroup();
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
    this._explosion = null;
    this._peakCamMove = 0;
    _prevCamPos.copy(camera.position);
  }

  _steeringKeysDown() {
    const k = this.camCtrl.keys;
    return !!(k.w || k.s || k.a || k.d);
  }

  /** Camera forward / right / up for screen-space aim steering. */
  _cameraBasis() {
    this.camera.updateMatrixWorld();
    this.camera.getWorldDirection(_fwd).normalize();
    _right.crossVectors(_fwd, _worldUp);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    else _right.normalize();
    _camUp.crossVectors(_right, _fwd).normalize();
  }

  _placeAimAheadOfShip(dist = AIM_LEAD_MIN) {
    this._cameraBasis();
    this.aimWorld.copy(this.ship.position).addScaledVector(_fwd, dist);
  }

  _setupFlightStartPose() {
    this.planetMesh.updateWorldMatrix(true, true);
    this.planetMesh.getWorldPosition(_planetCenter);

    _viewDir.subVectors(this.camera.position, _planetCenter);
    if (_viewDir.lengthSq() < 1e-8) _viewDir.set(0, 0, 1);
    else _viewDir.normalize();

    const shipDist = FLIGHT_START_DIST - SHIP_RADIAL_INSET;
    this.ship.position.copy(_planetCenter).addScaledVector(_viewDir, shipDist);
    this.ship.quaternion.setFromUnitVectors(_zForward, _viewDir);

    this.camera.position.copy(_planetCenter).addScaledVector(_viewDir, FLIGHT_START_DIST);
    this.camera.lookAt(_planetCenter);
    this._placeAimAheadOfShip(AIM_LEAD_MIN);
  }

  _maintainEntryPose() {
    this.planetMesh.getWorldPosition(_planetCenter);
    const shipDist = FLIGHT_START_DIST - SHIP_RADIAL_INSET;

    this.camera.position.copy(_planetCenter).addScaledVector(_viewDir, FLIGHT_START_DIST);
    this.camera.lookAt(_planetCenter);

    this.ship.position.copy(_planetCenter).addScaledVector(_viewDir, shipDist);
    this.ship.quaternion.setFromUnitVectors(_zForward, _viewDir);
    this._placeAimAheadOfShip(AIM_LEAD_MIN);
  }

  _constrainAimToShell() {
    this.planetMesh.getWorldPosition(_planetCenter);
    _offset.subVectors(this.aimWorld, _planetCenter);
    const d = _offset.length();
    const minD = this.getPlanetRadius() + SHELL_PAD_MIN;
    const maxD = SHELL_MAX;
    if (d > maxD && d > 1e-6) {
      _offset.multiplyScalar(maxD / d);
      this.aimWorld.copy(_planetCenter).add(_offset);
    } else if (d < minD && d > 1e-6) {
      _offset.multiplyScalar(minD / d);
      this.aimWorld.copy(_planetCenter).add(_offset);
    }
  }

  _constrainAimAroundShip() {
    _toAim.subVectors(this.aimWorld, this.ship.position);
    const dist = _toAim.length();
    if (dist < AIM_LEAD_MIN && dist > 1e-6) {
      _toAim.multiplyScalar(AIM_LEAD_MIN / dist);
      this.aimWorld.copy(this.ship.position).add(_toAim);
    } else if (dist > AIM_LEAD_MAX) {
      _toAim.multiplyScalar(AIM_LEAD_MAX / dist);
      this.aimWorld.copy(this.ship.position).add(_toAim);
    }
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.gameOver = false;
    this._flightEngaged = false;
    this.camCtrl.shardFlightMode = true;
    this.camCtrl.followPlanet = null;
    this.camCtrl.followComet = null;
    this.camCtrl.zoomActive = false;
    this.velocity.set(0, 0, 0);
    this._peakCamMove = 0;
    this._setupFlightStartPose();
    _prevCamPos.copy(this.camera.position);
    this.flightLayer.add(this.ship);
    this.hud.setAimDotVisible(true);
    this.hud.hideGameOver();
  }

  exit(primaryPlanet) {
    if (!this.active) return;
    this.active = false;
    this.gameOver = false;
    this.camCtrl.shardFlightMode = false;
    this.camCtrl.followPlanet = primaryPlanet;
    this.camCtrl.followComet = null;
    this.flightLayer.remove(this.ship);
    this._disposeExplosion();
    this.hud.setAimDotVisible(false);
    this.hud.hideGameOver();
  }

  restart() {
    if (!this.active) return;
    this._disposeExplosion();
    this.gameOver = false;
    this._flightEngaged = false;
    this.ship.visible = true;
    this.velocity.set(0, 0, 0);
    this._peakCamMove = 0;
    this._setupFlightStartPose();
    _prevCamPos.copy(this.camera.position);
    this.hud.hideGameOver();
  }

  _disposeExplosion() {
    if (!this._explosion) return;
    this.flightLayer.remove(this._explosion);
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
    this.flightLayer.add(this._explosion);
    this.hud.showGameOver();
  }

  _moveAim(dt) {
    const k = this.camCtrl.keys;
    if (!k.w && !k.s && !k.a && !k.d) return;

    this._cameraBasis();
    const sp = AIM_SPEED * dt;
    if (k.w) this.aimWorld.addScaledVector(_camUp, sp);
    if (k.s) this.aimWorld.addScaledVector(_camUp, -sp);
    if (k.a) this.aimWorld.addScaledVector(_right, -sp);
    if (k.d) this.aimWorld.addScaledVector(_right, sp);

    this._constrainAimAroundShip();
    this._constrainAimToShell();
  }

  _integrateShip(dt) {
    _toAim.subVectors(this.aimWorld, this.ship.position);
    const dist = _toAim.length();
    if (dist > 0.05) {
      _toAim.multiplyScalar(1 / dist);
      this.velocity.addScaledVector(_toAim, SHIP_ACCEL * dt);
    }
    const drag = Math.exp(-SHIP_DRAG * dt);
    this.velocity.multiplyScalar(drag);
    const spd = this.velocity.length();
    if (spd > SHIP_MAX_SPEED) {
      this.velocity.multiplyScalar(SHIP_MAX_SPEED / spd);
    }
    this.ship.position.addScaledVector(this.velocity, dt);

    if (dist > 0.08) {
      this.ship.lookAt(this.aimWorld);
    }
  }

  _clampShipShell() {
    this.planetMesh.getWorldPosition(_planetCenter);
    const R = this.getPlanetRadius();
    _offset.subVectors(this.ship.position, _planetCenter);
    const d = _offset.length();
    const minD = R + SHELL_PAD_MIN + SHIP_RADIUS;
    const maxD = SHELL_MAX;
    if (d < minD && d > 1e-6) {
      _offset.multiplyScalar(minD / d);
      this.ship.position.copy(_planetCenter).add(_offset);
      this.velocity.multiplyScalar(0.25);
    } else if (d > maxD) {
      _offset.multiplyScalar(maxD / d);
      this.ship.position.copy(_planetCenter).add(_offset);
      this.velocity.multiplyScalar(0.25);
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
    if (pts.userData.t > EXPLODE_SEC) this._disposeExplosion();
  }

  /**
   * Third-person chase: world-space offset opposite the ship→aim line (not ship local axes).
   * Ship rotation is handled in {@link _integrateShip} only.
   */
  _updateChaseCamera() {
    _toAim.subVectors(this.aimWorld, this.ship.position);
    const aimDist = _toAim.length();
    if (aimDist < 1e-6) return;
    _toAim.multiplyScalar(1 / aimDist);

    _camWant.copy(this.ship.position).addScaledVector(_toAim, -CAM_BEHIND);
    _camWant.y += CAM_UP;

    this.camera.position.copy(_camWant);
    this.camera.lookAt(this.aimWorld);
  }

  update(dt) {
    if (!this.active) return;

    if (!this.gameOver) {
      if (this._steeringKeysDown() && !this._flightEngaged) {
        this._flightEngaged = true;
        this.velocity.set(0, 0, 0);
      }

      if (!this._flightEngaged) {
        this._maintainEntryPose();
      } else {
        this._moveAim(dt);
        this._integrateShip(dt);
        this._constrainAimAroundShip();
        this._clampShipShell();
        this._checkShardHit();
        this._updateChaseCamera();
      }
    } else {
      this._updateExplosion(dt);
      this._updateChaseCamera();
    }

    this.hud.syncAimDot(this.camera, this.aimWorld, this.container);
    this._syncFlightTelemetry();
  }

  _syncFlightTelemetry() {
    const cam = this.camera.position;
    _camDelta.subVectors(cam, _prevCamPos);
    const camMove = _camDelta.length();
    this._peakCamMove = Math.max(this._peakCamMove, camMove);

    this.planetMesh.getWorldPosition(_planetCenter);

    this.hud.syncTelemetry({
      camPos: cam,
      camDelta: _camDelta,
      camMove,
      peakMove: this._peakCamMove,
      distPlanet: cam.distanceTo(_planetCenter),
      distShip: cam.distanceTo(this.ship.position),
      distAim: cam.distanceTo(this.aimWorld),
      shipPos: this.ship.position,
      shipSpeed: this.velocity.length(),
      flightEngaged: this._flightEngaged,
    });

    _prevCamPos.copy(cam);
  }
}
