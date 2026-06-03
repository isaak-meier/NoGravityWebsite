import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PATTERN_RING } from '../pyramid/fragment-pattern-math.js';
import {
  separateBattleGoalFromShards,
  planBattleRouteWaypoints,
  segmentIntersectsSphere,
  computeBattleSpawnInShardField,
  computeBattleSpawnShellRadius,
  findBestAdjacentPyramidMidpoint,
  computeBattleGoalAhead,
  computeBattleGoalAlongRing,
  BATTLE_GOAL_SHARD_STEPS_AHEAD,
  computeBattleOrientationTowardGoal,
  isOutsideBattleRingBoundary,
  isShipOutsideBattleRingBoundaryWorld,
  computeBattleRingBoundaryRadii,
  battleShardHitRadius,
  BATTLE_HIT_FRAGMENT_RADIUS_MULT,
  BATTLE_SPAWN_RING_VOID_RADIUS_FRAC,
  levelToBandIndex,
  battleHullScaleForLevel,
  computeBattleTunnelGeometry,
  isOutsideBattleTunnelLocal,
  isInRingTunnelLocal,
  BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL,
} from './shard-battle-helpers.js';
import { RING_PATTERN_BAND_FRACS } from '../pyramid/fragment-pattern-math.js';

describe('separateBattleGoalFromShards', () => {
  it('pushes the goal out of an overlapping shard collider', () => {
    const shardCenter = new THREE.Vector3(0, 0, 0);
    const goal = new THREE.Vector3(0.2, 0, 0);
    const shipPos = new THREE.Vector3(-5, 0, 0);
    const shardR = 1;
    const goalR = 0.5;

    const field = {
      forEachBattleShardCollider(fn) {
        fn({ centerWorld: shardCenter, radius: shardR });
      },
      forEachVisibleShardWorld() {},
    };

    separateBattleGoalFromShards(field, shipPos, goalR, shardR, goal);

    const minDist = Math.max(goalR, shardR) + shardR + shardR * 0.4;
    expect(goal.distanceTo(shardCenter)).toBeGreaterThanOrEqual(minDist - 1e-5);
  });
});

describe('battleShardHitRadius', () => {
  it('uses a smaller multiplier for shattered fragments', () => {
    const r = 1;
    expect(battleShardHitRadius(r, 0)).toBeCloseTo(r * BATTLE_HIT_FRAGMENT_RADIUS_MULT);
    expect(battleShardHitRadius(r, undefined)).toBeGreaterThan(
      battleShardHitRadius(r, 0),
    );
  });
});

describe('computeBattleSpawnShellRadius', () => {
  it('uses the ring void inside the inner band when pattern is ring', () => {
    const field = {
      config: {
        patternMode: PATTERN_RING,
        orbitRadius: 1.46,
        patternOrbitRadius: 5,
        pattern: {},
      },
    };
    const shellR = computeBattleSpawnShellRadius(field, 1);
    const innerBandR = 5 * 0.72;
    expect(shellR).toBeLessThan(innerBandR);
    expect(shellR).toBeCloseTo(5 * BATTLE_SPAWN_RING_VOID_RADIUS_FRAC, 5);
  });
});

describe('computeBattleOrientationTowardGoal', () => {
  it('aligns ship nose toward the goal', () => {
    const ship = new THREE.Vector3(0, 0, 0);
    const goal = new THREE.Vector3(0, 0, -10);
    const quat = new THREE.Quaternion();
    computeBattleOrientationTowardGoal(ship, goal, quat);
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    expect(nose.z).toBeLessThan(-0.99);
  });
});

describe('findBestAdjacentPyramidMidpoint', () => {
  it('returns the midpoint between angularly adjacent pyramids', () => {
    const planet = new THREE.Vector3(0, 0, 0);
    const a = new THREE.Vector3(5, 0, 0);
    const b = new THREE.Vector3(0, 0, 5);
    const anchors = [
      { index: 0, position: a },
      { index: 1, position: b },
    ];
    const mid = new THREE.Vector3();
    const outA = new THREE.Vector3();
    const outB = new THREE.Vector3();
    const obstacles = [
      { center: a.clone(), radius: 0.35 },
      { center: b.clone(), radius: 0.35 },
    ];
    expect(
      findBestAdjacentPyramidMidpoint(anchors, planet, obstacles, 0.06, mid, outA, outB),
    ).toBe(true);
    expect(mid.distanceTo(new THREE.Vector3(2.5, 0, 2.5))).toBeLessThan(1e-5);
  });
});

describe('battle ring boundary', () => {
  it('detects ship outside inner or outer fence in XZ', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const innerR = 2;
    const outerR = 5;
    expect(isOutsideBattleRingBoundary(new THREE.Vector3(6, 0, 0), center, innerR, outerR, 0.05)).toBe(true);
    expect(isOutsideBattleRingBoundary(new THREE.Vector3(1, 0, 0), center, innerR, outerR, 0.05)).toBe(true);
    expect(isOutsideBattleRingBoundary(new THREE.Vector3(3.5, 1, 0), center, innerR, outerR, 0.05)).toBe(false);
  });

  it('sizes fences from pattern orbit radius (planet-local)', () => {
    const field = {
      config: { patternOrbitRadius: 5, pattern: {} },
    };
    const { innerR, outerR } = computeBattleRingBoundaryRadii(field);
    expect(innerR).toBeCloseTo(5 * 0.72 * 0.5, 5);
    expect(outerR).toBeGreaterThan(innerR);
    expect(outerR).toBeCloseTo(5 * 1.38 * 1.1, 5);
  });

  it('matches the red mesh when the planet is scaled', () => {
    const field = { config: { patternOrbitRadius: 5, pattern: {} } };
    const { outerR } = computeBattleRingBoundaryRadii(field);
    const planetMesh = new THREE.Mesh();
    planetMesh.scale.setScalar(2);
    planetMesh.updateMatrixWorld(true);
    const center = new THREE.Vector3(10, 0, 0);
    planetMesh.position.copy(center);
    planetMesh.updateMatrixWorld(true);
    const justOutside = new THREE.Vector3(center.x + outerR * 2 + 0.2, 0, center.z);
    expect(
      isShipOutsideBattleRingBoundaryWorld(justOutside, planetMesh, 0, outerR, 0.01),
    ).toBe(true);
    const justInside = new THREE.Vector3(center.x + outerR * 2 - 0.2, 0, center.z);
    expect(
      isShipOutsideBattleRingBoundaryWorld(justInside, planetMesh, 0, outerR, 0.01),
    ).toBe(false);
  });
});

describe('computeBattleGoalAlongRing', () => {
  it('places the goal N shard gaps ahead on the ring, inside the field', () => {
    const planet = new THREE.Vector3(0, 0, 0);
    const spawn = new THREE.Vector3(2.5, 0, 2.5);
    const anchors = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      anchors.push({
        index: i,
        position: new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5),
      });
    }
    const field = {
      forEachShardSpawnAnchor(fn) {
        for (const a of anchors) fn(a.index, a.position);
      },
      estimateAverageShardColliderRadius: () => 0.35,
    };
    const goal = new THREE.Vector3();
    computeBattleGoalAlongRing(
      spawn,
      planet,
      anchors,
      field,
      0.35,
      0.06,
      goal,
      BATTLE_GOAL_SHARD_STEPS_AHEAD,
    );
    expect(goal.length()).toBeGreaterThan(2.5);
    expect(goal.length()).toBeLessThan(5.5);
    expect(goal.distanceTo(spawn)).toBeGreaterThan(1.2);
    expect(goal.distanceTo(spawn)).toBeLessThan(5.5);
  });
});

describe('computeBattleSpawnInShardField', () => {
  it('spawns at the midpoint between two pyramid anchors', () => {
    const planet = new THREE.Mesh();
    planet.position.set(0, 0, 0);
    const a = new THREE.Vector3(5, 0, 0);
    const b = new THREE.Vector3(0, 0, 5);
    const expectedMid = new THREE.Vector3(2.5, 0, 2.5);
    const field = {
      config: { orbitRadius: 5, patternMode: PATTERN_RING, patternOrbitRadius: 5, pattern: {} },
      forEachShardSpawnAnchor(fn) {
        fn(0, a);
        fn(1, b);
      },
      forEachBattleShardCollider(fn) {
        fn({ centerWorld: a, radius: 0.35 });
        fn({ centerWorld: b, radius: 0.35 });
      },
      forEachVisibleShardWorld() {},
      estimateAverageShardColliderRadius: () => 0.35,
    };
    const entry = new THREE.Vector3();
    const dir = new THREE.Vector3();
    computeBattleSpawnInShardField(planet, field, 0.05, entry, dir);
    expect(entry.length()).toBeLessThan(expectedMid.length());
    expect(entry.distanceTo(expectedMid)).toBeLessThan(1.2);
    expect(dir.length()).toBeCloseTo(1, 5);
  });

  it('spawns outside a blocking shard collider', () => {
    const planet = new THREE.Mesh();
    planet.position.set(0, 0, 0);
    const shardCenter = new THREE.Vector3(0, 0, 5);
    const field = {
      config: { orbitRadius: 5 },
      forEachShardSpawnAnchor() {},
      forEachBattleShardCollider(fn) {
        fn({ centerWorld: shardCenter, radius: 1.5 });
      },
      forEachVisibleShardWorld() {},
      estimateAverageShardColliderRadius: () => 1.5,
    };
    const entry = new THREE.Vector3();
    const dir = new THREE.Vector3();
    computeBattleSpawnInShardField(planet, field, 0.05, entry, dir);
    expect(entry.distanceTo(shardCenter)).toBeGreaterThan(1.5 + 0.05 * 1.2 - 1e-4);
  });
});

describe('ring-tunnel levels', () => {
  it('maps level 1 to the outermost band and steps inward', () => {
    const len = RING_PATTERN_BAND_FRACS.length;
    expect(levelToBandIndex(1)).toBe(len - 1); // outermost
    expect(levelToBandIndex(len)).toBe(0); // innermost
    // clamps out-of-range levels into the valid band span
    expect(levelToBandIndex(0)).toBe(len - 1);
    expect(levelToBandIndex(len + 5)).toBe(0);
  });

  it('shrinks the ship on inner (harder) levels', () => {
    expect(battleHullScaleForLevel(1)).toBe(BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL[0]);
    expect(battleHullScaleForLevel(2)).toBeLessThan(battleHullScaleForLevel(1));
    // out-of-range clamps to the ends
    expect(battleHullScaleForLevel(99)).toBe(
      BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL[BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL.length - 1],
    );
  });
});

describe('computeBattleTunnelGeometry', () => {
  const field = { config: { patternOrbitRadius: 5, pattern: {} } };

  it('puts the centerline on the chosen band circle', () => {
    const band = levelToBandIndex(1); // outermost, frac 1.38
    const { ringRadius } = computeBattleTunnelGeometry(field, band);
    expect(ringRadius).toBeCloseTo(5 * RING_PATTERN_BAND_FRACS[band] * 1, 5);
  });

  it('keeps the tube inside half the gap to the neighbouring band', () => {
    const band = levelToBandIndex(1);
    const { tubeRadius } = computeBattleTunnelGeometry(field, band, 0.05, 0.01);
    // nearest neighbour band gap (planet-local)
    const neighborGap = Math.abs(
      RING_PATTERN_BAND_FRACS[band] - RING_PATTERN_BAND_FRACS[band - 1],
    ) * 5;
    expect(tubeRadius).toBeGreaterThan(0);
    expect(tubeRadius).toBeLessThanOrEqual(neighborGap * 0.5 + 1e-9);
  });

  it('grows the tube to enclose larger shards', () => {
    const band = levelToBandIndex(1);
    const small = computeBattleTunnelGeometry(field, band, 0.02, 0).tubeRadius;
    const big = computeBattleTunnelGeometry(field, band, 0.12, 0).tubeRadius;
    expect(big).toBeGreaterThan(small);
  });
});

describe('torus tunnel membership + wall', () => {
  const ringRadius = 6.9;
  const tubeRadius = 0.5;

  it('treats the band centerline as inside and the neighbour band as outside', () => {
    expect(isInRingTunnelLocal(new THREE.Vector3(ringRadius, 0, 0), ringRadius, tubeRadius)).toBe(true);
    // a neighbour ring 0.8 in toward the planet sits well outside this tube
    expect(isInRingTunnelLocal(new THREE.Vector3(6.1, 0, 0), ringRadius, tubeRadius)).toBe(false);
  });

  it('flags the ship as outside only past the tube wall (minus ship pad)', () => {
    const shipR = 0.05; // WALL_PAD_MULT defaults to 1.0
    // dead-center on the ring: safely inside
    expect(
      isOutsideBattleTunnelLocal(new THREE.Vector3(ringRadius, 0, 0), ringRadius, tubeRadius, shipR),
    ).toBe(false);
    // just inside the wall (d = 0.4 < 0.5 - 0.05)
    expect(
      isOutsideBattleTunnelLocal(new THREE.Vector3(ringRadius, 0.4, 0), ringRadius, tubeRadius, shipR),
    ).toBe(false);
    // past the wall (d = 0.49 > 0.45)
    expect(
      isOutsideBattleTunnelLocal(new THREE.Vector3(ringRadius, 0.49, 0), ringRadius, tubeRadius, shipR),
    ).toBe(true);
    // far outside radially
    expect(
      isOutsideBattleTunnelLocal(new THREE.Vector3(8, 0, 0), ringRadius, tubeRadius, shipR),
    ).toBe(true);
  });
});

describe('planBattleRouteWaypoints', () => {
  it('does not cut through a shard on the direct line', () => {
    const ship = new THREE.Vector3(-4, 0, 0);
    const goal = new THREE.Vector3(4, 0, 0);
    const obstacles = [{ center: new THREE.Vector3(0, 0, 0), radius: 1.2 }];
    const clearance = 0.15;
    const waypoints = [];

    planBattleRouteWaypoints(ship, goal, obstacles, clearance, waypoints);

    expect(waypoints.length).toBeGreaterThan(0);
    const path = [ship, ...waypoints];
    for (let i = 0; i < path.length - 1; i++) {
      expect(
        segmentIntersectsSphere(path[i], path[i + 1], obstacles[0].center, obstacles[0].radius + clearance),
      ).toBe(false);
    }
  });
});
