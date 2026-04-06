/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ShardShatter, { T_DRIFT_END, T_PATTERN_END } from './shard-shatter.js';
import FragmentPatternCoordinator from './fragment-pattern-coordinator.js';
import { PATTERN_DRIFT, PATTERN_RING } from './fragment-pattern-math.js';

const ID_QUAT = new THREE.Quaternion();

function makeConeGeo() {
  // Task growth (6 → 18 → 54 → 162): three.js ConeGeometry(0.16,0.4,3) is 9 triangles capped;
  // six independent triangles match the spec’s “6 base triangles” for subdivision counts.
  const verts = new Float32Array(6 * 9);
  let o = 0;
  for (let i = 0; i < 6; i++) {
    const z = i * 0.001;
    verts[o++] = 0;
    verts[o++] = 0;
    verts[o++] = z;
    verts[o++] = 1;
    verts[o++] = 0;
    verts[o++] = z;
    verts[o++] = 0.5;
    verts[o++] = 1;
    verts[o++] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  return g;
}

describe('ShardShatter', () => {
  describe('_subdivide', () => {
    it('depth 1 produces 18 fragments', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const out = ss._subdivide(geo, 1);
      expect(out.length).toBe(18);
    });

    it('depth 2 produces 54 fragments', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const out = ss._subdivide(geo, 2);
      expect(out.length).toBe(54);
    });

    it('depth 3 produces 162 fragments', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 500, material: mat });
      const geo = makeConeGeo();
      const out = ss._subdivide(geo, 3);
      expect(out.length).toBe(162);
    });

    it('each fragment has centroid (Vector3) and vertices length 3', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const out = ss._subdivide(geo, 1);
      for (const frag of out) {
        expect(frag.centroid).toBeInstanceOf(THREE.Vector3);
        expect(Array.isArray(frag.vertices)).toBe(true);
        expect(frag.vertices.length).toBe(3);
        frag.vertices.forEach((v) => {
          expect(v).toBeInstanceOf(THREE.Vector3);
        });
      }
    });
  });

  describe('triggerShatter / isShattered', () => {
    it('marks shard as shattered after trigger', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const pos = new THREE.Vector3(1, 2, 3);
      ss.registerShard(0, geo, pos, ID_QUAT, 1);
      ss.triggerShatter(0, 0.5);
      expect(ss.isShattered(0)).toBe(true);
    });

    it('non-triggered shard returns false for isShattered', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(), ID_QUAT, 1);
      expect(ss.isShattered(1)).toBe(false);
    });
  });

  describe('registerShard', () => {
    it('stores shard info in registry', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const pos = new THREE.Vector3(4, 5, 6);
      ss.registerShard(7, geo, pos, ID_QUAT, 1);
      expect(ss._shardRegistry.has(7)).toBe(true);
      const entry = ss._shardRegistry.get(7);
      expect(entry.geometry).toBe(geo);
      expect(entry.position.equals(pos)).toBe(true);
    });
  });

  describe('update', () => {
    it('advances t toward 1.0 over barDuration', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      ss.update(1.0, 2.0);
      expect(ss.isShattered(0)).toBe(true);
    });

    it('completes recombination when t >= 1.0', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      ss.update(3.0, 2.0);
      expect(ss.isShattered(0)).toBe(false);
    });
  });

  describe('re-shatter', () => {
    it('resets t to 0 when re-shattered mid-recombination', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      ss.update(0.5, 2.0);
      ss.triggerShatter(0, 0.8);
      expect(ss.isShattered(0)).toBe(true);
      ss.update(2.5, 2.0);
      expect(ss.isShattered(0)).toBe(false);
    });
  });

  describe('InstancedMesh pool', () => {
    it('exposes a group containing InstancedMesh children', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      expect(ss.group).toBeInstanceOf(THREE.Group);
      const meshes = ss.group.children.filter(c => c.isInstancedMesh);
      expect(meshes.length).toBeGreaterThan(0);
    });

    it('pre-allocates instance slots for worst-case capacity', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      const meshes = ss.group.children.filter(c => c.isInstancedMesh);
      expect(meshes.length).toBe(3);
    });
  });

  describe('pattern coordinator', () => {
    it('lerps toward ring target during pattern phase', () => {
      const mat = new THREE.MeshStandardMaterial();
      const coord = new FragmentPatternCoordinator();
      coord.beginWave({
        waveIndex: 1,
        patternId: PATTERN_RING,
        center: new THREE.Vector3(0, 0, 0),
        params: { orbitRadius: 2 },
      });
      coord.registerShard(0, 18);
      coord.finalizeWave();
      const ss = new ShardShatter({
        maxShards: 5,
        material: mat,
        patternCoordinator: coord,
      });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(0, 0, 1), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      const state = ss._shardStates.get(0);
      state.t = T_PATTERN_END * 0.75;
      ss._applyTransforms(state);
      const pool = ss._pools[state.levelIndex];
      const m = new THREE.Matrix4();
      pool.mesh.getMatrixAt(state.slots[0], m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(p.length()).toBeGreaterThan(0.5);
    });

    it('caps t at T_PATTERN_END when holdPatternPhase is true', () => {
      const mat = new THREE.MeshStandardMaterial();
      const coord = new FragmentPatternCoordinator();
      coord.beginWave({
        waveIndex: 1,
        patternId: PATTERN_RING,
        center: new THREE.Vector3(0, 0, 0),
        params: { orbitRadius: 2 },
      });
      coord.registerShard(0, 18);
      coord.finalizeWave();
      const ss = new ShardShatter({
        maxShards: 5,
        material: mat,
        patternCoordinator: coord,
      });
      ss.holdPatternPhase = true;
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(0, 0, 1), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      const barDuration = 2;
      ss.update(1.0, barDuration);
      const state = ss._shardStates.get(0);
      expect(state.t).toBeCloseTo(T_PATTERN_END, 5);
      const pool = ss._pools[state.levelIndex];
      const m0 = new THREE.Matrix4();
      pool.mesh.getMatrixAt(state.slots[0], m0);
      const p0 = new THREE.Vector3().setFromMatrixPosition(m0);
      ss.update(50.0, barDuration);
      expect(ss._shardStates.get(0).t).toBeCloseTo(T_PATTERN_END, 5);
      expect(ss.isShattered(0)).toBe(true);
      const m1 = new THREE.Matrix4();
      pool.mesh.getMatrixAt(state.slots[0], m1);
      const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
      expect(p0.distanceTo(p1)).toBeLessThan(1e-5);
    });

    it('uses non-pattern motion and caps t at T_DRIFT_END for PATTERN_DRIFT (no return)', () => {
      const mat = new THREE.MeshStandardMaterial();
      const coord = new FragmentPatternCoordinator();
      coord.beginWave({
        waveIndex: 1,
        patternId: PATTERN_DRIFT,
        center: new THREE.Vector3(0, 0, 0),
        params: { orbitRadius: 2 },
      });
      coord.registerShard(0, 18);
      coord.finalizeWave();
      const ss = new ShardShatter({
        maxShards: 5,
        material: mat,
        patternCoordinator: coord,
      });
      ss.holdPatternPhase = true;
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(0, 0, 1), ID_QUAT, 1);
      ss.triggerShatter(0, 0.2);
      const barDuration = 2;
      ss.update(10.0, barDuration);
      expect(ss.isShattered(0)).toBe(true);
      expect(ss._shardStates.get(0).t).toBeCloseTo(T_DRIFT_END, 5);
    });
  });

  describe('dispose', () => {
    it('clears all shatter states', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 5, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0), ID_QUAT, 1);
      ss.triggerShatter(0, 0.5);
      ss.dispose();
      expect(ss.isShattered(0)).toBe(false);
    });
  });
});
