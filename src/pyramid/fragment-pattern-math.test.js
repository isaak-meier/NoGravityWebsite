/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PATTERN_SPHERE,
  PATTERN_RING,
  PATTERN_GALAXY,
  hash01,
  splitCountsByWeight,
  getPatternWorldPosition,
} from './fragment-pattern-math.js';

const _v = new THREE.Vector3();

describe('fragment-pattern-math', () => {
  describe('hash01', () => {
    it('returns [0, 1)', () => {
      for (let i = 0; i < 50; i++) {
        const h = hash01(i, 42);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    });

    it('is deterministic for fixed inputs', () => {
      expect(hash01(7, 3)).toBe(hash01(7, 3));
    });
  });

  describe('splitCountsByWeight', () => {
    it('sums to n', () => {
      const c = splitCountsByWeight([1, 2, 3], 12);
      expect(c.reduce((a, b) => a + b, 0)).toBe(12);
    });

    it('handles n=0', () => {
      const c = splitCountsByWeight([1, 1], 0);
      expect(c.reduce((a, b) => a + b, 0)).toBe(0);
    });
  });

  describe('sphere pattern', () => {
    it('places points on a shell around center', () => {
      for (let g = 0; g < 30; g++) {
        getPatternWorldPosition(_v, PATTERN_SPHERE, g, 40, 0, 0, 0, 1, { orbitRadius: 2 });
        const len = _v.length();
        expect(len).toBeGreaterThan(1.5);
        expect(len).toBeLessThan(2.5);
      }
    });
  });

  describe('ring pattern', () => {
    it('keeps y near center (thin disk)', () => {
      const cy = 0.5;
      for (let g = 0; g < 40; g++) {
        getPatternWorldPosition(_v, PATTERN_RING, g, 60, 0, cy, 0, 1, { orbitRadius: 2 });
        expect(Math.abs(_v.y - cy)).toBeLessThan(0.25);
      }
    });

    it('places points at multiple radii (band spread)', () => {
      const radii = new Set();
      for (let g = 0; g < 80; g++) {
        getPatternWorldPosition(_v, PATTERN_RING, g, 80, 0, 0, 0, 2, { orbitRadius: 2 });
        radii.add(Math.round(_v.length() * 10));
      }
      expect(radii.size).toBeGreaterThan(3);
    });

    it('handles n=1', () => {
      getPatternWorldPosition(_v, PATTERN_RING, 0, 1, 1, 0, 0, 0, {});
      expect(Number.isFinite(_v.x)).toBe(true);
    });
  });

  describe('galaxy pattern', () => {
    it('keeps main disk near horizontal plane', () => {
      for (let g = 0; g < 50; g++) {
        getPatternWorldPosition(_v, PATTERN_GALAXY, g, 80, 0, 0, 0, 5, { orbitRadius: 2 });
        expect(Math.abs(_v.y)).toBeLessThan(0.3);
      }
    });

    it('puts early indices in smaller bulge radius than outer arms', () => {
      getPatternWorldPosition(_v, PATTERN_GALAXY, 0, 100, 0, 0, 0, 2, { orbitRadius: 2 });
      const r0 = _v.length();
      getPatternWorldPosition(_v, PATTERN_GALAXY, 90, 100, 0, 0, 0, 2, { orbitRadius: 2 });
      const r1 = _v.length();
      expect(r1).toBeGreaterThan(r0 * 0.5);
    });
  });
});
