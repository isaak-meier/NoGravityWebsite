import * as THREE from 'three';

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

function triangleToFragment([v0, v1, v2]) {
  const centroid = new THREE.Vector3().copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);
  const radius = Math.max(
    centroid.distanceTo(v0), centroid.distanceTo(v1), centroid.distanceTo(v2),
  );
  return { centroid, vertices: [v0, v1, v2], radius };
}

function subdivideTrianglesOnce(triangles) {
  const next = [];
  for (const [a, b, c] of triangles) {
    next.push(...splitTriangleByCentroid(a, b, c));
  }
  return next;
}

// --- Pool & animation helpers ---

const FRAGMENTS_PER_LEVEL = [18, 54, 162];

function makeFragmentGeometry() {
  const verts = new Float32Array([
     0,                1,  0,
    -Math.sqrt(3) / 2, -0.5, 0,
     Math.sqrt(3) / 2, -0.5, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

function intensityToDepth(intensity) {
  if (intensity < 0.33) return 1;
  if (intensity < 0.66) return 2;
  return 3;
}

function generateVelocity(centroid, intensity) {
  const dir = centroid.clone().normalize();
  const speed = 0.5 + intensity * 2.0;
  dir.x += (Math.random() - 0.5) * 0.3;
  dir.y += (Math.random() - 0.5) * 0.3;
  dir.z += (Math.random() - 0.5) * 0.3;
  return dir.normalize().multiplyScalar(speed);
}

function generateTumble() {
  return new THREE.Vector3(
    (Math.random() - 0.5) * Math.PI * 4,
    (Math.random() - 0.5) * Math.PI * 4,
    (Math.random() - 0.5) * Math.PI * 4,
  );
}

function computeFragmentPosition(origin, velocity, t) {
  if (t <= 0.15) {
    const phase = t / 0.15;
    const decay = 1 - phase * 0.7;
    return origin.clone().addScaledVector(velocity, phase * decay);
  }
  const outwardOffset = 0.3;
  if (t <= 0.5) {
    const driftT = (t - 0.15) / 0.35;
    return origin.clone().addScaledVector(velocity, outwardOffset + driftT * 0.05);
  }
  const driftEndOffset = outwardOffset + 0.05;
  const returnT = (t - 0.5) / 0.5;
  const eased = returnT * returnT;
  const driftEnd = origin.clone().addScaledVector(velocity, driftEndOffset);
  return driftEnd.lerp(origin, eased);
}

function computeTumbleAngle(t) {
  if (t <= 0.15) return t / 0.15;
  if (t <= 0.5) return 1.0 + ((t - 0.15) / 0.35) * 0.3;
  const returnT = (t - 0.5) / 0.5;
  return 1.3 * (1 - returnT * returnT);
}

const _euler = new THREE.Euler();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function buildFragmentMatrix(position, tumble, tumbleAngle, scale) {
  _euler.set(tumble.x * tumbleAngle, tumble.y * tumbleAngle, tumble.z * tumbleAngle);
  _quat.setFromEuler(_euler);
  _scaleVec.setScalar(scale);
  _mat4.compose(position, _quat, _scaleVec);
  return _mat4;
}

// --- ShardShatter class ---

export default class ShardShatter {
  constructor({ maxShards, material }) {
    this.maxShards = maxShards;
    this.material = material;
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

  registerShard(index, geometry, worldPosition) {
    this._shardRegistry.set(index, { geometry, worldPosition: worldPosition.clone() });
  }

  updateShardPosition(index, worldPosition) {
    const entry = this._shardRegistry.get(index);
    if (entry) entry.worldPosition.copy(worldPosition);
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
    const origins = fragments.map(f => f.centroid.clone().add(entry.worldPosition));
    const velocities = fragments.map(f => generateVelocity(f.centroid, intensity));
    const tumbles = fragments.map(() => generateTumble());
    const radii = fragments.map(f => f.radius);
    const slots = this._claimSlots(levelIndex, fragments.length);

    const state = { depth, levelIndex, t: 0, origins, velocities, tumbles, radii, slots };
    this._shardStates.set(index, state);
    this._applyTransforms(state);
  }

  _applyTransforms(state) {
    const { levelIndex, slots, origins, velocities, tumbles, radii, t } = state;
    const pool = this._pools[levelIndex];
    const angle = computeTumbleAngle(t);
    for (let i = 0; i < slots.length; i++) {
      const pos = computeFragmentPosition(origins[i], velocities[i], t);
      pool.mesh.setMatrixAt(slots[i], buildFragmentMatrix(pos, tumbles[i], angle, radii[i]));
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  update(deltaTime, barDuration) {
    const completed = [];
    for (const [index, state] of this._shardStates) {
      state.t += deltaTime / barDuration;
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

  dispose() {
    this._shardStates.clear();
    for (const pool of this._pools) {
      pool.mesh.geometry.dispose();
      this.group.remove(pool.mesh);
    }
  }
}
