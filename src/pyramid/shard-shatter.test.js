/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import ShardShatter from './shard-shatter.js';

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
      ss.registerShard(0, geo, pos);
      ss.triggerShatter(0, 0.5);
      expect(ss.isShattered(0)).toBe(true);
    });

    it('non-triggered shard returns false for isShattered', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      ss.registerShard(0, geo, new THREE.Vector3());
      expect(ss.isShattered(1)).toBe(false);
    });
  });

  describe('registerShard', () => {
    it('stores shard info in registry', () => {
      const mat = new THREE.MeshStandardMaterial();
      const ss = new ShardShatter({ maxShards: 100, material: mat });
      const geo = makeConeGeo();
      const pos = new THREE.Vector3(4, 5, 6);
      ss.registerShard(7, geo, pos);
      expect(ss._shardRegistry.has(7)).toBe(true);
      const entry = ss._shardRegistry.get(7);
      expect(entry.geometry).toBe(geo);
      expect(entry.worldPosition.equals(pos)).toBe(true);
    });
  });
});
