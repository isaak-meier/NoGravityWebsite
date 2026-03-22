import * as THREE from 'three';

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
  return { centroid, vertices: [v0, v1, v2] };
}

function subdivideTrianglesOnce(triangles) {
  const next = [];
  for (const [a, b, c] of triangles) {
    next.push(...splitTriangleByCentroid(a, b, c));
  }
  return next;
}

export default class ShardShatter {
  constructor({ maxShards, material }) {
    this.maxShards = maxShards;
    this.material = material;
    this.group = new THREE.Group();
    this._shardStates = new Map();
    this._shardRegistry = new Map();
  }

  _subdivide(geometry, depth) {
    let triangles = extractTriangles(geometry);
    for (let pass = 0; pass < depth; pass++) {
      triangles = subdivideTrianglesOnce(triangles);
    }
    return triangles.map(triangleToFragment);
  }

  registerShard(index, geometry, worldPosition) {
    this._shardRegistry.set(index, { geometry, worldPosition });
  }

  triggerShatter(index, intensity) {
    const depth =
      intensity < 0.33 ? 1 : intensity < 0.66 ? 2 : 3;
    const entry = this._shardRegistry.get(index);
    if (!entry) return;
    const fragments = this._subdivide(entry.geometry, depth);
    this._shardStates.set(index, { fragments, depth });
  }

  isShattered(index) {
    return this._shardStates.has(index);
  }
}
