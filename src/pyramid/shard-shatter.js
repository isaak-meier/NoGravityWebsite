import * as THREE from 'three';
import {
  DEFAULT_EXPONENTIAL_DRAG_TAU,
  exponentialDragBlend,
} from '../math/exponential-drag.js';
import { PATTERN_DRIFT } from './fragment-pattern-math.js';

// --- Geometry extraction & subdivision (existing) ---

function extractTriangles(geometry) {
  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  const triangles = [];
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2));
      triangles.push([a, b, c]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      triangles.push([a, b, c]);
    }
  }
  return triangles;
}

function splitTriangleByCentroid(a, b, c) {
  const center = new THREE.Vector3().copy(a).add(b).add(c).multiplyScalar(1 / 3);
  return [
    [a.clone(), b.clone(), center.clone()],
    [b.clone(), c.clone(), center.clone()],
    [c.clone(), a.clone(), center.clone()],
  ];
}

function triangleNormal(a, b, c) {
  const e1 = new THREE.Vector3().subVectors(b, a);
  const e2 = new THREE.Vector3().subVectors(c, a);
  return e1.cross(e2).normalize();
}

function triangleToFragment([v0, v1, v2]) {
  const centroid = new THREE.Vector3().copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);
  const radius = Math.max(
    centroid.distanceTo(v0), centroid.distanceTo(v1), centroid.distanceTo(v2),
  );
  const normal = triangleNormal(v0, v1, v2);
  const quatFace = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    normal,
  );
  return { centroid, vertices: [v0, v1, v2], radius, quatFace };
}

function subdivideTrianglesOnce(triangles) {
  const next = [];
  for (const [a, b, c] of triangles) {
    next.push(...splitTriangleByCentroid(a, b, c));
  }
  return next;
}

// --- Pool & animation helpers ---

export const FRAGMENTS_PER_LEVEL = [18, 54, 162];

export function intensityToDepth(intensity) {
  if (intensity < 0.33) return 1;
  if (intensity < 0.66) return 2;
  return 3;
}

/** Normalized time: burst [0, T_BURST_END), pattern [T_BURST_END, T_PATTERN_END), return [T_PATTERN_END, 1] */
export const T_BURST_END = 0.15;
export const T_PATTERN_END = 0.5;
/** Non-pattern: end of burst+drift before return; drift mode caps `t` here (no return phase). */
export const T_DRIFT_END = 0.5;

function makeFragmentGeometry() {
  return new THREE.ConeGeometry(0.4, 1.0, 3);
}

function generateWorldVelocity(localCentroid, shardQuat, intensity) {
  const dir = localCentroid.clone().normalize();
  dir.x += (Math.random() - 0.5) * 0.3;
  dir.y += (Math.random() - 0.5) * 0.3;
  dir.z += (Math.random() - 0.5) * 0.3;
  dir.normalize();
  const speed = 0.5 + intensity * 2.0;
  return dir.applyQuaternion(shardQuat).multiplyScalar(speed);
}

function localPointToWorld(local, position, quaternion, scale) {
  return local.clone().multiplyScalar(scale).applyQuaternion(quaternion).add(position);
}

function generateTumble() {
  return new THREE.Vector3(
    (Math.random() - 0.5) * Math.PI * 4,
    (Math.random() - 0.5) * Math.PI * 4,
    (Math.random() - 0.5) * Math.PI * 4,
  );
}

const PEAK_VELOCITY_SCALE = 0.35;

function computeFragmentPosition(origin, velocity, t) {
  if (t <= T_DRIFT_END) {
    if (t <= T_BURST_END) {
      const phase = t / T_BURST_END;
      const decay = 1 - phase * 0.7;
      return origin.clone().addScaledVector(velocity, phase * decay);
    }
    const driftT = (t - T_BURST_END) / (T_DRIFT_END - T_BURST_END);
    return origin.clone().addScaledVector(velocity, 0.3 + driftT * 0.05);
  }
  const u = (t - T_DRIFT_END) / (1 - T_DRIFT_END);
  const peak = origin.clone().addScaledVector(velocity, PEAK_VELOCITY_SCALE);
  return peak.lerp(origin, u);
}

function computeTumbleAngle(t) {
  if (t <= T_DRIFT_END) {
    if (t <= T_BURST_END) return t / T_BURST_END;
    return 1.0 + ((t - T_BURST_END) / (T_DRIFT_END - T_BURST_END)) * 0.3;
  }
  const u = (t - T_DRIFT_END) / (1 - T_DRIFT_END);
  return 1.3 * (1 - u);
}

/** @param {number} t */
function computeTumbleAnglePattern(t) {
  if (t < T_BURST_END) return t / T_BURST_END;
  if (t < T_PATTERN_END) {
    const u = (t - T_BURST_END) / (T_PATTERN_END - T_BURST_END);
    return 1.0 + u * 0.3;
  }
  const u = (t - T_PATTERN_END) / (1 - T_PATTERN_END);
  return 1.3 * (1 - u);
}

const _euler = new THREE.Euler();
const _mat4 = new THREE.Matrix4();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
const _burstEnd = new THREE.Vector3();
const _patternPos = new THREE.Vector3();
const _fragPos = new THREE.Vector3();

function quatFromTumbleVecInto(tumble, angle, target) {
  _euler.set(tumble.x * angle, tumble.y * angle, tumble.z * angle);
  return target.setFromEuler(_euler);
}

function buildFragmentMatrix(position, quaternion, scale) {
  _scaleVec.setScalar(scale);
  _mat4.compose(position, quaternion, _scaleVec);
  return _mat4;
}

// --- ShardShatter class ---

export default class ShardShatter {
  /**
   * @param {object} opts
   * @param {number} opts.maxShards
   * @param {import('three').Material} opts.material
   * @param {import('./fragment-pattern-coordinator.js').default | null} [opts.patternCoordinator]
   */
  constructor({ maxShards, material, patternCoordinator = null }) {
    this.maxShards = maxShards;
    this.material = material;
    /** @type {import('./fragment-pattern-coordinator.js').default | null} */
    this.patternCoordinator = patternCoordinator;
    /** When true with an active field pattern wave, `t` does not pass {@link T_PATTERN_END}. Drift mode always caps at {@link T_DRIFT_END} (no return). */
    this.holdPatternPhase = false;
    this.group = new THREE.Group();
    this._shardStates = new Map();
    this._shardRegistry = new Map();
    this._pools = this._createPools(maxShards, material);
  }

  _createPools(maxShards, material) {
    const fragGeo = makeFragmentGeometry();
    return FRAGMENTS_PER_LEVEL.map((fragCount) => {
      const maxCount = maxShards * fragCount;
      const mesh = new THREE.InstancedMesh(fragGeo.clone(), material, maxCount);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, freeSlots: [], highWatermark: 0 };
    });
  }

  _subdivide(geometry, depth) {
    let triangles = extractTriangles(geometry);
    for (let pass = 0; pass < depth; pass++) {
      triangles = subdivideTrianglesOnce(triangles);
    }
    return triangles.map(triangleToFragment);
  }

  registerShard(index, geometry, position, quaternion, scale) {
    this._shardRegistry.set(index, {
      geometry,
      position: position.clone(),
      quaternion: quaternion.clone(),
      scale,
    });
  }

  /**
   * Keep registry + active wave origin aligned with the pyramid mesh.
   * @param {number | null} deltaTime - When > 0 and the shard is mid-shatter, drag toward the target
   *   (exponential smoothing). Pass `null` to snap (e.g. starting a new wave in `_triggerShatter`).
   */
  syncShardTransform(index, position, quaternion, scale, deltaTime) {
    const entry = this._shardRegistry.get(index);
    if (!entry) return;

    const state = this._shardStates.get(index);
    if (!state) {
      entry.position.copy(position);
      entry.quaternion.copy(quaternion);
      entry.scale = scale;
      return;
    }

    const instant = deltaTime == null || !(deltaTime > 0);
    if (instant) {
      entry.position.copy(position);
      entry.quaternion.copy(quaternion);
      entry.scale = scale;
      state.worldPos.copy(position);
      state.shardQuat.copy(quaternion);
      state.shardScale = scale;
      return;
    }

    const a = exponentialDragBlend(deltaTime, DEFAULT_EXPONENTIAL_DRAG_TAU);
    entry.position.lerp(position, a);
    entry.quaternion.slerp(quaternion, a);
    entry.scale = THREE.MathUtils.lerp(entry.scale, scale, a);
    state.worldPos.lerp(position, a);
    state.shardQuat.slerp(quaternion, a);
    state.shardScale = THREE.MathUtils.lerp(state.shardScale, scale, a);
  }

  _claimSlots(levelIndex, count) {
    const pool = this._pools[levelIndex];
    const slots = [];
    for (let i = 0; i < count; i++) {
      slots.push(
        pool.freeSlots.length > 0
          ? pool.freeSlots.pop()
          : pool.highWatermark++,
      );
    }
    pool.mesh.count = pool.highWatermark;
    return slots;
  }

  _freeSlots(levelIndex, slots) {
    const pool = this._pools[levelIndex];
    for (const slot of slots) {
      pool.mesh.setMatrixAt(slot, _zeroMatrix);
      pool.freeSlots.push(slot);
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  triggerShatter(index, intensity) {
    const entry = this._shardRegistry.get(index);
    if (!entry) return;

    if (this._shardStates.has(index)) {
      const old = this._shardStates.get(index);
      this._freeSlots(old.levelIndex, old.slots);
    }

    const depth = intensityToDepth(intensity);
    const levelIndex = depth - 1;
    const fragments = this._subdivide(entry.geometry, depth);
    const centroids = fragments.map(f => f.centroid.clone());
    const quatFaces = fragments.map(f => f.quatFace.clone());
    const velocities = fragments.map(f =>
      generateWorldVelocity(f.centroid, entry.quaternion, intensity),
    );
    const tumbles = fragments.map(() => generateTumble());
    const radii = fragments.map(f => f.radius);
    const slots = this._claimSlots(levelIndex, fragments.length);
    const worldPos = entry.position.clone();
    const shardQuat = entry.quaternion.clone();
    const shardScale = entry.scale;

    let globalSlotBase = 0;
    const coord = this.patternCoordinator;
    if (coord?.finalized && coord.totalFragmentCount > 0) {
      globalSlotBase = coord.getBaseOffset(index);
    }

    const state = {
      depth, levelIndex, t: 0,
      centroids, quatFaces, worldPos, shardQuat, shardScale,
      velocities, tumbles, radii, slots,
      globalSlotBase,
    };
    this._shardStates.set(index, state);
    this._applyTransforms(state);
  }

  _applyTransforms(state) {
    const {
      levelIndex, slots, centroids, quatFaces, worldPos, shardQuat, shardScale,
      velocities, tumbles, radii, t, globalSlotBase,
    } = state;
    const pool = this._pools[levelIndex];
    const coord = this.patternCoordinator;
    const usePattern =
      coord?.finalized
      && coord.totalFragmentCount > 0
      && coord.patternId !== PATTERN_DRIFT;
    const patternParams = coord?.params;
    const orbitTarget = patternParams != null ? Number(patternParams.orbitRadius) : NaN;
    const orbitBurstRaw = patternParams?.orbitRadiusBurst;
    const orbitBurst =
      orbitBurstRaw != null && Number.isFinite(Number(orbitBurstRaw))
        ? Number(orbitBurstRaw)
        : orbitTarget;

    const ang = usePattern ? computeTumbleAnglePattern(t) : computeTumbleAngle(t);
    const angPeak = usePattern
      ? computeTumbleAnglePattern(T_PATTERN_END)
      : computeTumbleAngle(T_DRIFT_END);
    const tQuatSplit = usePattern ? T_PATTERN_END : T_DRIFT_END;

    for (let i = 0; i < slots.length; i++) {
      const restPos = localPointToWorld(centroids[i], worldPos, shardQuat, shardScale);
      _quatA.copy(shardQuat).multiply(quatFaces[i]);
      const restQuat = _quatA;
      const vel = velocities[i];
      let pos;
      if (usePattern) {
        const g = globalSlotBase + i;
        _burstEnd.copy(restPos).addScaledVector(vel, 0.3);
        if (t < T_BURST_END) {
          const phase = t / T_BURST_END;
          const decay = 1 - phase * 0.7;
          _fragPos.copy(restPos).addScaledVector(vel, phase * decay);
        } else if (t < T_PATTERN_END) {
          const uP = (t - T_BURST_END) / (T_PATTERN_END - T_BURST_END);
          const orbitR =
            Number.isFinite(orbitTarget) && Number.isFinite(orbitBurst)
              ? orbitBurst + (orbitTarget - orbitBurst) * uP
              : orbitTarget;
          coord.getWorldTarget(_patternPos, g, orbitR);
          _fragPos.lerpVectors(_burstEnd, _patternPos, uP);
        } else {
          coord.getWorldTarget(_patternPos, g);
          const uR = (t - T_PATTERN_END) / (1 - T_PATTERN_END);
          _fragPos.lerpVectors(_patternPos, restPos, uR);
        }
        pos = _fragPos;
      } else {
        pos = computeFragmentPosition(restPos, vel, t);
      }
      quatFromTumbleVecInto(tumbles[i], ang, _quatB);
      let q;
      if (t <= tQuatSplit) {
        q = restQuat.clone().multiply(_quatB);
      } else {
        const u = (t - tQuatSplit) / (1 - tQuatSplit);
        quatFromTumbleVecInto(tumbles[i], angPeak, _quatB);
        const qAtPeak = restQuat.clone().multiply(_quatB);
        q = qAtPeak.slerp(restQuat, u);
      }
      pool.mesh.setMatrixAt(slots[i], buildFragmentMatrix(pos, q, radii[i]));
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  update(deltaTime, barDuration) {
    const coord = this.patternCoordinator;
    const usePattern =
      coord?.finalized
      && coord.totalFragmentCount > 0
      && coord.patternId !== PATTERN_DRIFT;
    const holdPattern = this.holdPatternPhase && usePattern;
    const driftWave =
      coord?.finalized
      && coord.totalFragmentCount > 0
      && coord.patternId === PATTERN_DRIFT;

    const completed = [];
    for (const [index, state] of this._shardStates) {
      state.t += deltaTime / barDuration;
      if (holdPattern) {
        state.t = Math.min(state.t, T_PATTERN_END);
      }
      if (driftWave) {
        state.t = Math.min(state.t, T_DRIFT_END);
      }
      if (state.t >= 1.0) {
        completed.push(index);
        this._freeSlots(state.levelIndex, state.slots);
      } else {
        this._applyTransforms(state);
      }
    }
    for (const index of completed) {
      this._shardStates.delete(index);
    }
  }

  isShattered(index) {
    return this._shardStates.has(index);
  }

  getReturnProgress(index) {
    const state = this._shardStates.get(index);
    if (!state) return 0;
    const coord = this.patternCoordinator;
    const usePattern =
      coord?.finalized
      && coord.totalFragmentCount > 0
      && coord.patternId !== PATTERN_DRIFT;
    const t0 = usePattern ? T_PATTERN_END : T_DRIFT_END;
    if (state.t <= t0) return 0;
    return (state.t - t0) / (1 - t0);
  }

  dispose() {
    this._shardStates.clear();
    for (const pool of this._pools) {
      pool.mesh.geometry.dispose();
      this.group.remove(pool.mesh);
    }
  }
}
