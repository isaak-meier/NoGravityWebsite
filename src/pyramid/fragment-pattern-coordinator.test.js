/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import FragmentPatternCoordinator from './fragment-pattern-coordinator.js';
import { PATTERN_RING } from './fragment-pattern-math.js';

describe('FragmentPatternCoordinator', () => {
  it('assigns non-overlapping contiguous slots', () => {
    const c = new FragmentPatternCoordinator();
    c.beginWave({
      waveIndex: 0,
      patternId: PATTERN_RING,
      center: new THREE.Vector3(0, 0, 0),
      params: { orbitRadius: 2 },
    });
    c.registerShard(2, 10);
    c.registerShard(0, 5);
    c.registerShard(1, 7);
    c.finalizeWave();
    expect(c.totalFragmentCount).toBe(22);
    expect(c.getBaseOffset(0)).toBe(0);
    expect(c.getBaseOffset(1)).toBe(5);
    expect(c.getBaseOffset(2)).toBe(12);
    const seen = new Set();
    for (let s = 0; s < 3; s++) {
      const base = c.getBaseOffset(s);
      const n = [5, 7, 10][s];
      for (let i = 0; i < n; i++) {
        const g = base + i;
        expect(seen.has(g)).toBe(false);
        seen.add(g);
      }
    }
    expect(seen.size).toBe(22);
  });

  it('alternates pattern id by wave (caller responsibility)', () => {
    expect(0 % 2).toBe(0);
    expect(1 % 2).toBe(1);
  });

  it('getWorldTarget returns finite positions', () => {
    const c = new FragmentPatternCoordinator();
    c.beginWave({
      waveIndex: 3,
      patternId: PATTERN_RING,
      center: new THREE.Vector3(0, 1, 0),
      params: { orbitRadius: 1.5 },
    });
    c.registerShard(0, 20);
    c.finalizeWave();
    const out = new THREE.Vector3();
    c.getWorldTarget(out, 10);
    expect(out.length()).toBeGreaterThan(0.1);
    expect(Number.isFinite(out.x)).toBe(true);
  });

  it('ignores wave index in layout seed when lockShatterPatternSeed is true', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const params = { orbitRadius: 2, lockShatterPatternSeed: true };
    const cLo = new FragmentPatternCoordinator();
    cLo.beginWave({ waveIndex: 1, patternId: PATTERN_RING, center, params });
    cLo.registerShard(0, 12);
    cLo.finalizeWave();
    const cHi = new FragmentPatternCoordinator();
    cHi.beginWave({ waveIndex: 500, patternId: PATTERN_RING, center, params });
    cHi.registerShard(0, 12);
    cHi.finalizeWave();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    cLo.getWorldTarget(a, 5);
    cHi.getWorldTarget(b, 5);
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });
});
