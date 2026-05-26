import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { spheresOverlap } from './shard-flight-collision.js';

describe('spheresOverlap', () => {
  it('returns true when centers coincide and radii overlap', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(0, 0, 0);
    expect(spheresOverlap(a, 1, b, 0.5)).toBe(true);
  });

  it('returns false when separated beyond sum of radii', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(3, 0, 0);
    expect(spheresOverlap(a, 1, b, 1)).toBe(false);
  });

  it('returns true when touching inside sum of radii', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(1.4, 0, 0);
    expect(spheresOverlap(a, 1, b, 0.5)).toBe(true);
  });
});
