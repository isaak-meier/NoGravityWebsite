import * as THREE from "three";
import {
  PATTERN_RING,
  RING_PATTERN_BAND_FRACS,
  RING_PATTERN_INNER_BAND_FRAC,
  RING_PATTERN_OUTER_BAND_FRAC,
} from "../pyramid/fragment-pattern-math.js";

/** Goal distance ahead of the ship along the camera view (× mean shard diameter). */
export const BATTLE_GOAL_VIEW_DIST_MULT = 2.8;
/** Place the goal this many pyramid gaps ahead along the ring (inside the shard field). */
export const BATTLE_GOAL_SHARD_STEPS_AHEAD = 10;
/** Goal pickup sphere radius as a multiple of average shard collider radius (bigger = easier to spot/hit). */
export const GOAL_RADIUS_SHARD_MULT = 1.5;
/** Extra world-space gap between goal portal extent and shard collider surfaces. */
export const BATTLE_GOAL_SHARD_PAD_MULT = 0.4;
/** Route preview: extra clearance beyond ship radius when skirting shard colliders. */
export const BATTLE_ROUTE_CLEARANCE_SHARD_MULT = 0.42;
/** Spawn: clearance beyond ship radius when resolving entry position. */
export const BATTLE_SPAWN_CLEARANCE_MULT = 1.2;
/** Ring battle: spawn radius as a fraction of `patternOrbitRadius` (shell fallback only). */
export const BATTLE_SPAWN_RING_VOID_RADIUS_FRAC = 0.52;
/** Min spacing between pyramid anchors to spawn in the gap (× spawn margin). */
export const BATTLE_SPAWN_MIN_PYRAMID_GAP_MULT = 2.2;
/** Pull spawn from the gap midpoint toward the planet (0–1, fraction of radial distance). */
export const BATTLE_SPAWN_NEST_INWARD_FRAC = 0.28;
/** Prefer gaps on inner bands when picking a spawn pair (score weight). */
export const BATTLE_SPAWN_INNER_GAP_SCORE_WEIGHT = 0.35;
/** Inner arena fence (× inner band radius). */
export const BATTLE_RING_BOUNDARY_INNER_FRAC = 0.5;
/** Outer arena fence (× outer band radius). */
export const BATTLE_RING_BOUNDARY_OUTER_FRAC = 1.1;
/** Ship radius pad when testing ring boundary (XZ). */
export const BATTLE_RING_BOUNDARY_SHIP_PAD_MULT = 1.25;
/** Battle game-over hit test: shrink colliders below route/placement size. */
export const BATTLE_HIT_INTACT_RADIUS_MULT = 0.62;
export const BATTLE_HIT_FRAGMENT_RADIUS_MULT = 0.46;
export const BATTLE_HIT_SHIP_RADIUS_MULT = 0.85;
/** Golden-sphere samples on the orbit shell when picking a clear spawn. */
export const BATTLE_SPAWN_SHELL_SAMPLES = 44;
/**
 * Max recursive detours when planning a shard-aware route. Bounds the branching cost: each
 * blocked segment spawns two recursive calls, so worst-case nodes ≈ 2^depth. Kept low because
 * this only drives the cosmetic white preview line, not ship control — a high cap let the route
 * planner explode into per-frame spikes when the ship flew through dense ring shards.
 */
export const BATTLE_ROUTE_MAX_PLAN_DEPTH = 7;
/** Battle hull scale slider range (ship Group.scale; flight mode ≈ 1). */
export const BATTLE_SHIP_HULL_SCALE_MIN = 0.0002;
export const BATTLE_SHIP_HULL_SCALE_MAX = 0.0022;
export const BATTLE_SHIP_HULL_SCALE_DEFAULT = 0.0008;

// ─── Ring-tunnel battle (fly inside one shard ring) ──────────────────────────
/** Active tunnel level: 1 = outermost ring (easiest); higher levels step inward (harder). */
export const BATTLE_TUNNEL_LEVEL = 1;
/** Goal sits this many shard gaps along the ring from spawn (legacy gap-based placement). */
export const BATTLE_TUNNEL_GOAL_SHARD_STEPS = 1;
/**
 * Goal arc distance ahead of the ship along the ring centerline (planet-local units). This is how
 * far in front of the ship the goal spawns — small = right in front. Floor ≈ the goal radius, or
 * the ship overlaps it at spawn and instantly wins.
 */
export const BATTLE_TUNNEL_GOAL_ARC = 0.5;
/** Wall-tube ship clearance: shard enclosure + ship radius × this. Tight so the ship must thread
 *  azimuthal gaps rather than fly radially/vertically around a shard. */
export const SHIP_TUBE_CLEARANCE_MULT = 1.0;
/** Hazard membership pad (× avg shard radius) beyond the shard enclosure. Independent of the wall
 *  tube so tightening the wall never turns a visible ring shard into a non-lethal phantom. */
export const BATTLE_TUNNEL_HAZARD_PAD_MULT = 0.5;
/** Ship-radius pad when testing the lethal torus wall (planet-local units). */
export const BATTLE_TUNNEL_WALL_PAD_MULT = 1.0;
/** Per-level ship hull scale (index = level − 1); inner rings get a smaller ship for tighter gaps. */
export const BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL = [0.00031, 0.000275, 0.00024, 0.000215, 0.0002];

const _scratch = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _arenaOrigin = new THREE.Vector3(0, 0, 0);
const _radial = new THREE.Vector3();
const _toGoal = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _toShard = new THREE.Vector3();

const _worldUp = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _detourA = new THREE.Vector3();
const _detourB = new THREE.Vector3();
const _routeTangent = new THREE.Vector3();
const _fromCenter = new THREE.Vector3();
const _pairA = new THREE.Vector3();
const _pairB = new THREE.Vector3();
/** @type {ShardSpawnAnchor[]} */
const _goalAnchors = [];

/** @typedef {{ index: number, position: THREE.Vector3 }} ShardSpawnAnchor */

/**
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {ShardSpawnAnchor[]} out
 */
export function collectShardSpawnAnchors(pyramidField, out) {
  out.length = 0;
  if (typeof pyramidField.forEachShardSpawnAnchor === "function") {
    pyramidField.forEachShardSpawnAnchor((index, centerWorld) => {
      out.push({ index, position: centerWorld.clone() });
    });
    return;
  }
  pyramidField.forEachVisibleShardWorld((index, centerWorld) => {
    out.push({ index, position: centerWorld.clone() });
  });
}

/**
 * @param {import('three').Vector3} pos
 * @param {import('three').Vector3} planetCenter
 */
function anchorAzimuth(pos, planetCenter) {
  _fromCenter.subVectors(pos, planetCenter);
  return Math.atan2(_fromCenter.z, _fromCenter.x);
}

/**
 * @param {import('three').Vector3} point
 * @param {import('three').Vector3} planetCenter
 * @param {number} nestFrac — fraction of planet→point distance to move inward
 */
function nestBattleSpawnInward(point, planetCenter, nestFrac) {
  _radial.subVectors(point, planetCenter);
  const dist = _radial.length();
  if (dist < 1e-8) return;
  const nested = dist * (1 - THREE.MathUtils.clamp(nestFrac, 0, 0.85));
  point.copy(planetCenter).addScaledVector(_radial.multiplyScalar(1 / dist), nested);
}

/**
 * Midpoint between the best angularly adjacent pyramid pair with enough gap for the ship.
 * @param {ShardSpawnAnchor[]} anchors
 * @param {import('three').Vector3} planetCenter
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} margin
 * @param {import('three').Vector3} outMid
 * @param {import('three').Vector3} outA
 * @param {import('three').Vector3} outB
 */
export function findBestAdjacentPyramidMidpoint(
  anchors,
  planetCenter,
  obstacles,
  margin,
  outMid,
  outA,
  outB,
) {
  if (anchors.length < 2) return false;

  const sorted = anchors.slice().sort(
    (a, b) => anchorAzimuth(a.position, planetCenter) - anchorAzimuth(b.position, planetCenter),
  );

  let maxAnchorR = 0;
  for (const a of sorted) {
    _fromCenter.subVectors(a.position, planetCenter);
    maxAnchorR = Math.max(maxAnchorR, _fromCenter.length());
  }

  let bestScore = -Infinity;
  let found = false;
  const minSpan = margin * BATTLE_SPAWN_MIN_PYRAMID_GAP_MULT;

  for (let i = 0; i < sorted.length; i++) {
    const anchorA = sorted[i];
    const anchorB = sorted[(i + 1) % sorted.length];
    const span = anchorA.position.distanceTo(anchorB.position);
    if (span < minSpan) continue;

    outMid.copy(anchorA.position).add(anchorB.position).multiplyScalar(0.5);
    const clear = minClearanceAtPoint(outMid, obstacles, margin);
    const halfSpan = span * 0.5;
    const dA = outMid.distanceTo(anchorA.position);
    const dB = outMid.distanceTo(anchorB.position);
    const symmetry = 1 - Math.abs(dA - dB) / Math.max(halfSpan, 1e-6);
    _fromCenter.subVectors(outMid, planetCenter);
    const gapR = _fromCenter.length();
    const depthBonus =
      maxAnchorR > 1e-6
        ? ((maxAnchorR - gapR) / maxAnchorR) * BATTLE_SPAWN_INNER_GAP_SCORE_WEIGHT
        : 0;
    const score = clear + symmetry * 0.2 + depthBonus;

    if (score > bestScore) {
      bestScore = score;
      outA.copy(anchorA.position);
      outB.copy(anchorB.position);
      found = true;
    }
  }

  if (found) return true;

  let bestI = 0;
  let bestJ = 1;
  let bestSpan = sorted[0].position.distanceTo(sorted[1].position);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const span = sorted[i].position.distanceTo(sorted[j].position);
      if (span > bestSpan) {
        bestSpan = span;
        bestI = i;
        bestJ = j;
      }
    }
  }
  outA.copy(sorted[bestI].position);
  outB.copy(sorted[bestJ].position);
  outMid.copy(outA).add(outB).multiplyScalar(0.5);
  return true;
}

/**
 * @param {import('three').Vector3} point
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} margin
 */
function minClearanceAtPoint(point, obstacles, margin) {
  if (obstacles.length === 0) return Infinity;
  let minClear = Infinity;
  for (const o of obstacles) {
    const clear = point.distanceTo(o.center) - o.radius - margin;
    if (clear < minClear) minClear = clear;
  }
  return minClear;
}

/**
 * @param {import('three').Vector3} point
 * @param {import('three').Vector3} planetCenter
 * @param {number} shellR
 * @param {import('three').Vector3} out
 */
function projectPointToBattleShell(point, planetCenter, shellR, out) {
  _radial.subVectors(point, planetCenter);
  if (_radial.lengthSq() < 1e-8) _radial.set(0, 0, 1);
  out.copy(planetCenter).addScaledVector(_radial.normalize(), shellR);
}

/**
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {number} planetScale — mean planet mesh scale
 */
export function computeBattleSpawnShellRadius(pyramidField, planetScale) {
  const cfg = pyramidField.config;
  if (cfg.patternMode === PATTERN_RING) {
    const pattern = cfg.pattern ?? {};
    const ringScale = pattern.ringRadiusScale ?? 1;
    const patternR = cfg.patternOrbitRadius * planetScale * ringScale;
    const innerBandR = patternR * RING_PATTERN_INNER_BAND_FRAC;
    const voidR = patternR * BATTLE_SPAWN_RING_VOID_RADIUS_FRAC;
    return Math.min(voidR, innerBandR * 0.82);
  }
  return cfg.orbitRadius * planetScale;
}

/**
 * Pick the clearest point on the shard shell and separate from battle colliders (incl. fragments).
 * @param {import('three').Mesh} planetMesh
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {number} shipRadius — battle ship collision radius
 * @param {import('three').Vector3} outEntry
 * @param {import('three').Vector3} outFieldDir — unit vector along the field (ship nose)
 */
export function computeBattleSpawnInShardField(
  planetMesh,
  pyramidField,
  shipRadius,
  outEntry,
  outFieldDir,
) {
  planetMesh.updateWorldMatrix(true, true);
  planetMesh.getWorldPosition(_planetCenter);

  const scale =
    (planetMesh.scale.x + planetMesh.scale.y + planetMesh.scale.z) / 3;
  const shellR = computeBattleSpawnShellRadius(pyramidField, scale);
  const margin = shipRadius * BATTLE_SPAWN_CLEARANCE_MULT;

  /** @type {{ center: THREE.Vector3, radius: number }[]} */
  const obstacles = [];
  collectBattleShardObstacles(pyramidField, obstacles);

  /** @type {ShardSpawnAnchor[]} */
  const anchors = [];
  collectShardSpawnAnchors(pyramidField, anchors);

  const spawnBetweenPyramids = findBestAdjacentPyramidMidpoint(
    anchors,
    _planetCenter,
    obstacles,
    margin,
    outEntry,
    _pairA,
    _pairB,
  );

  if (spawnBetweenPyramids) {
    nestBattleSpawnInward(outEntry, _planetCenter, BATTLE_SPAWN_NEST_INWARD_FRAC);
  }

  if (!spawnBetweenPyramids) {
    let bestClear = -Infinity;
    _radial.set(0, 0, 1);
    outEntry.copy(_planetCenter).addScaledVector(_radial, shellR);

    const samples = Math.max(8, BATTLE_SPAWN_SHELL_SAMPLES);
    for (let k = 0; k < samples; k++) {
      const y = 1 - (k / Math.max(1, samples - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = Math.PI * (3 - Math.sqrt(5)) * k;
      _radial.set(Math.cos(phi) * ring, y, Math.sin(phi) * ring);
      _mid.copy(_planetCenter).addScaledVector(_radial, shellR);
      const clear = minClearanceAtPoint(_mid, obstacles, margin);
      if (clear > bestClear) {
        bestClear = clear;
        outEntry.copy(_mid);
      }
    }
  }

  /** @type {{ center: THREE.Vector3, radius: number }[]} */
  const nudgeObstacles = spawnBetweenPyramids
    ? [
        { center: _pairA, radius: pyramidField.estimateAverageShardColliderRadius() },
        { center: _pairB, radius: pyramidField.estimateAverageShardColliderRadius() },
      ]
    : obstacles;
  const nudgePasses = spawnBetweenPyramids ? 4 : 14;

  for (let pass = 0; pass < nudgePasses; pass++) {
    nudgePointClearOfShardObstacles(outEntry, nudgeObstacles, margin, _planetCenter);
    if (!spawnBetweenPyramids) {
      projectPointToBattleShell(outEntry, _planetCenter, shellR, outEntry);
    }
  }

  if (spawnBetweenPyramids) {
    _mid.copy(_pairA).add(_pairB).multiplyScalar(0.5);
    nestBattleSpawnInward(_mid, _planetCenter, BATTLE_SPAWN_NEST_INWARD_FRAC);
    if (minClearanceAtPoint(_mid, nudgeObstacles, margin) >= 0) {
      outEntry.copy(_mid);
    }
  }

  _radial.subVectors(outEntry, _planetCenter);
  if (_radial.lengthSq() < 1e-8) _radial.set(0, 0, 1);
  _radial.normalize();

  if (spawnBetweenPyramids) {
    _toGoal.subVectors(_pairB, _pairA);
  } else {
    _toGoal.copy(_worldUp).cross(_radial);
  }
  if (_toGoal.lengthSq() < 1e-8) {
    _toGoal.copy(_worldUp).cross(_radial);
  }
  outFieldDir.copy(_toGoal).addScaledVector(_radial, -_toGoal.dot(_radial));
  if (outFieldDir.lengthSq() < 1e-8) {
    outFieldDir.copy(_worldUp).cross(_radial);
  }
  outFieldDir.normalize();
}

/**
 * @param {import('three').Vector3} entryPos
 * @param {import('three').Vector3} fieldDir — unit vector along the shard field
 * @param {import('three').Quaternion} outQuat — ship nose (−Z local) along fieldDir
 */
export function computeBattleFieldOrientation(entryPos, fieldDir, outQuat) {
  const nose = new THREE.Vector3(0, 0, -1);
  const dir = fieldDir.lengthSq() > 1e-8 ? fieldDir : nose;
  outQuat.setFromUnitVectors(nose, dir);
}

/** @param {import('../pyramid/pyramid-field.js').default} pyramidField */
export function computeBattleShipMetrics(pyramidField) {
  const avgShardR = pyramidField.estimateAverageShardColliderRadius();
  const goalRadius = avgShardR * GOAL_RADIUS_SHARD_MULT;
  const goalViewDist = avgShardR * 2 * BATTLE_GOAL_VIEW_DIST_MULT;
  return {
    avgShardR,
    goalRadius,
    goalViewDist,
  };
}

/**
 * Push `outGoal` until it does not overlap any shard collider (portal + pickup clearance).
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Vector3} shipPos
 * @param {number} goalRadius — pickup sphere radius
 * @param {number} avgShardR — mean shard collider radius (fallback when collider API is empty)
 * @param {import('three').Vector3} outGoal
 */
export function separateBattleGoalFromShards(
  pyramidField,
  shipPos,
  goalRadius,
  avgShardR,
  outGoal,
) {
  const goalExtent = Math.max(goalRadius, avgShardR);
  const pad = avgShardR * BATTLE_GOAL_SHARD_PAD_MULT;
  const fallbackR = avgShardR;

  const pushFrom = (/** @type {import('three').Vector3} */ centerWorld, /** @type {number} */ shardRadius) => {
    _toShard.subVectors(outGoal, centerWorld);
    const dist = _toShard.length();
    const minDist = goalExtent + shardRadius + pad;
    if (dist >= minDist) return false;
    if (dist < 1e-6) {
      _toShard.subVectors(outGoal, shipPos);
      if (_toShard.lengthSq() < 1e-8) _toShard.set(0, 1, 0);
    }
    _toShard.normalize().multiplyScalar(minDist);
    outGoal.copy(centerWorld).add(_toShard);
    return true;
  };

  for (let pass = 0; pass < 16; pass++) {
    let moved = false;
    let colliderCount = 0;
    pyramidField.forEachBattleShardCollider(({ centerWorld, radius }) => {
      colliderCount += 1;
      if (pushFrom(centerWorld, radius)) moved = true;
    });
    if (colliderCount === 0) {
      pyramidField.forEachVisibleShardWorld((/** @type {number} */ _i, /** @type {THREE.Vector3} */ pos) => {
        if (pushFrom(pos, fallbackR)) moved = true;
      });
    }
    if (!moved) break;
  }
}

/**
 * Keep the goal in a pyramid gap (one sphere per shard), not every fragment.
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Vector3} shipPos
 * @param {number} goalRadius
 * @param {number} avgShardR
 * @param {import('three').Vector3} outGoal
 */
export function separateBattleGoalFromShardAnchors(
  pyramidField,
  shipPos,
  goalRadius,
  avgShardR,
  outGoal,
) {
  const goalExtent = Math.max(goalRadius, avgShardR);
  const pad = avgShardR * BATTLE_GOAL_SHARD_PAD_MULT;

  const pushFrom = (/** @type {import('three').Vector3} */ centerWorld) => {
    _toShard.subVectors(outGoal, centerWorld);
    const dist = _toShard.length();
    const minDist = goalExtent + avgShardR + pad;
    if (dist >= minDist) return false;
    if (dist < 1e-6) {
      _toShard.subVectors(outGoal, shipPos);
      if (_toShard.lengthSq() < 1e-8) _toShard.set(0, 1, 0);
    }
    _toShard.normalize().multiplyScalar(minDist);
    outGoal.copy(centerWorld).add(_toShard);
    return true;
  };

  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    collectShardSpawnAnchors(pyramidField, _goalAnchors);
    for (const a of _goalAnchors) {
      if (pushFrom(a.position)) moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Goal in a ring gap {@link BATTLE_GOAL_SHARD_STEPS_AHEAD} pyramids along from spawn (inside the field).
 * @param {import('three').Vector3} spawnPos
 * @param {import('three').Vector3} planetCenter
 * @param {ShardSpawnAnchor[]} anchors
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {number} goalRadius
 * @param {number} margin
 * @param {import('three').Vector3} outGoal
 * @param {number} [shardSteps]
 */
export function computeBattleGoalAlongRing(
  spawnPos,
  planetCenter,
  anchors,
  pyramidField,
  goalRadius,
  margin,
  outGoal,
  shardSteps = BATTLE_GOAL_SHARD_STEPS_AHEAD,
) {
  if (anchors.length < 2) {
    _radial.subVectors(spawnPos, planetCenter);
    if (_radial.lengthSq() < 1e-8) _radial.set(0, 0, 1);
    computeBattleGoalAhead(
      spawnPos,
      _radial.normalize(),
      pyramidField.estimateAverageShardColliderRadius() * 2 * BATTLE_GOAL_VIEW_DIST_MULT,
      goalRadius,
      pyramidField,
      outGoal,
    );
    return;
  }

  const sorted = anchors.slice().sort(
    (a, b) => anchorAzimuth(a.position, planetCenter) - anchorAzimuth(b.position, planetCenter),
  );
  const n = sorted.length;
  const steps = Math.max(1, Math.min(shardSteps, n - 1));

  let spawnPair = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < n; i++) {
    _mid
      .copy(sorted[i].position)
      .add(sorted[(i + 1) % n].position)
      .multiplyScalar(0.5);
    const dSq = _mid.distanceToSquared(spawnPos);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      spawnPair = i;
    }
  }

  const goalPair = (spawnPair + steps) % n;
  _pairA.copy(sorted[goalPair].position);
  _pairB.copy(sorted[(goalPair + 1) % n].position);
  outGoal.copy(_pairA).add(_pairB).multiplyScalar(0.5);

  const avgR = pyramidField.estimateAverageShardColliderRadius();
  const nudgeObstacles = [
    { center: _pairA, radius: avgR },
    { center: _pairB, radius: avgR },
  ];
  nudgePointClearOfShardObstacles(outGoal, nudgeObstacles, margin, spawnPos);
  separateBattleGoalFromShardAnchors(pyramidField, spawnPos, goalRadius, avgR, outGoal);
}

/** @deprecated Use {@link computeBattleGoalAlongRing} */
export const computeBattleGoalOppositeGap = computeBattleGoalAlongRing;

/**
 * Place the goal ahead of the ship along a world forward axis, then separate from shards.
 * @param {import('three').Vector3} shipPos
 * @param {import('three').Vector3} forward — unit (or near-unit) world direction
 * @param {number} goalViewDist
 * @param {number} goalRadius
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Vector3} outGoal
 */
export function computeBattleGoalAhead(
  shipPos,
  forward,
  goalViewDist,
  goalRadius,
  pyramidField,
  outGoal,
) {
  if (forward.lengthSq() > 1e-8) {
    _camForward.copy(forward).normalize();
  } else {
    _camForward.set(0, 0, -1);
  }
  outGoal.copy(shipPos).addScaledVector(_camForward, goalViewDist);
  const avgShardR = pyramidField.estimateAverageShardColliderRadius();
  separateBattleGoalFromShards(pyramidField, shipPos, goalRadius, avgShardR, outGoal);
}

/**
 * Ship nose (−Z local) toward {@link goalPos} from {@link shipPos}.
 * @param {import('three').Vector3} shipPos
 * @param {import('three').Vector3} goalPos
 * @param {import('three').Quaternion} outQuat
 */
export function computeBattleOrientationTowardGoal(shipPos, goalPos, outQuat) {
  _toGoal.subVectors(goalPos, shipPos);
  if (_toGoal.lengthSq() < 1e-8) return;
  _toGoal.normalize();
  const nose = new THREE.Vector3(0, 0, -1);
  outQuat.setFromUnitVectors(nose, _toGoal);
}

/**
 * Place the goal in the camera's forward view, then separate from shard colliders.
 * @param {import('three').Vector3} shipPos
 * @param {import('three').PerspectiveCamera} camera
 * @param {number} goalViewDist — world units ahead along the view axis
 * @param {number} goalRadius — pickup sphere radius
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Vector3} outGoal
 */
export function computeBattleGoalInView(
  shipPos,
  camera,
  goalViewDist,
  goalRadius,
  pyramidField,
  outGoal,
) {
  camera.getWorldDirection(_camForward);
  outGoal.copy(shipPos).addScaledVector(_camForward, goalViewDist);
  const avgShardR = pyramidField.estimateAverageShardColliderRadius();
  separateBattleGoalFromShards(pyramidField, shipPos, goalRadius, avgShardR, outGoal);
}

/**
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {{ center: THREE.Vector3, radius: number }[]} out
 */
/**
 * Tighter sphere for battle damage than {@link collectBattleShardObstacles} uses for routing.
 * @param {number} radius — from {@link PyramidField#forEachBattleShardCollider}
 * @param {number | undefined} fragmentIndex — set for shattered fragments only
 */
export function battleShardHitRadius(radius, fragmentIndex) {
  const mult =
    fragmentIndex !== undefined
      ? BATTLE_HIT_FRAGMENT_RADIUS_MULT
      : BATTLE_HIT_INTACT_RADIUS_MULT;
  return radius * mult;
}

export function collectBattleShardObstacles(pyramidField, out) {
  out.length = 0;
  let hasCollider = false;
  pyramidField.forEachBattleShardCollider(({ centerWorld, radius }) => {
    hasCollider = true;
    out.push({ center: centerWorld.clone(), radius });
  });
  if (!hasCollider) {
    const fallbackR = pyramidField.estimateAverageShardColliderRadius();
    pyramidField.forEachVisibleShardWorld((/** @type {number} */ _i, /** @type {THREE.Vector3} */ pos) => {
      out.push({ center: pos.clone(), radius: fallbackR });
    });
  }
}

/**
 * @param {import('three').Vector3} a
 * @param {import('three').Vector3} b
 * @param {import('three').Vector3} center
 * @param {number} radius
 */
export function segmentIntersectsSphere(a, b, center, radius) {
  _seg.subVectors(b, a);
  const lenSq = _seg.lengthSq();
  if (lenSq < 1e-12) {
    return _scratch.subVectors(a, center).length() < radius;
  }
  _scratch.subVectors(center, a);
  const t = THREE.MathUtils.clamp(_scratch.dot(_seg) / lenSq, 0, 1);
  _closest.copy(a).addScaledVector(_seg, t);
  return _closest.distanceTo(center) < radius;
}

/**
 * @param {import('three').Vector3} from
 * @param {import('three').Vector3} to
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} clearance
 * @returns {{ center: THREE.Vector3, radius: number } | null}
 */
export function findBattleRouteSegmentBlocker(from, to, obstacles, clearance) {
  let bestT = 2;
  /** @type {{ center: THREE.Vector3, radius: number } | null} */
  let best = null;
  for (const o of obstacles) {
    const r = o.radius + clearance;
    if (!segmentIntersectsSphere(from, to, o.center, r)) continue;
    _seg.subVectors(to, from);
    const lenSq = _seg.lengthSq();
    if (lenSq < 1e-12) return o;
    _scratch.subVectors(o.center, from);
    const t = THREE.MathUtils.clamp(_scratch.dot(_seg) / lenSq, 0, 1);
    if (t < bestT) {
      bestT = t;
      best = o;
    }
  }
  return best;
}

/**
 * Skirt point on an expanded shard sphere, biased toward `to`.
 * @param {import('three').Vector3} from
 * @param {import('three').Vector3} to
 * @param {import('three').Vector3} center
 * @param {number} radius — already includes clearance
 * @param {import('three').Vector3} out
 */
export function computeBattleRouteDetour(from, to, center, radius, out) {
  _fromCenter.subVectors(from, center);
  const dist = _fromCenter.length();
  _toGoal.subVectors(to, from);
  const toLen = _toGoal.length();
  if (toLen > 1e-6) _toGoal.multiplyScalar(1 / toLen);

  if (dist < radius) {
    if (dist < 1e-6) _fromCenter.set(1, 0, 0);
    else _fromCenter.multiplyScalar((radius * 1.08) / dist);
    out.copy(center).add(_fromCenter);
    return;
  }

  _fromCenter.multiplyScalar(1 / dist);
  _routeTangent.crossVectors(_fromCenter, _toGoal);
  if (_routeTangent.lengthSq() < 1e-10) {
    _routeTangent.crossVectors(_fromCenter, _worldUp);
  }
  if (_routeTangent.lengthSq() < 1e-10) {
    _routeTangent.set(0, 1, 0);
  }
  _routeTangent.normalize();
  _routeTangent.crossVectors(_routeTangent, _fromCenter).normalize();

  const skirtR = radius * 1.1;
  _detourA.copy(center).addScaledVector(_routeTangent, skirtR);
  _detourB.copy(center).addScaledVector(_routeTangent, -skirtR);

  const lenA = from.distanceTo(_detourA) + _detourA.distanceTo(to);
  const lenB = from.distanceTo(_detourB) + _detourB.distanceTo(to);
  out.copy(lenA <= lenB ? _detourA : _detourB);
}

/**
 * @param {import('three').Vector3} from
 * @param {import('three').Vector3} to
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} clearance
 * @param {number} depth
 * @param {THREE.Vector3[]} outWaypoints
 */
function appendBattleRouteSegment(from, to, obstacles, clearance, depth, outWaypoints) {
  if (depth > BATTLE_ROUTE_MAX_PLAN_DEPTH) {
    outWaypoints.push(to.clone());
    return;
  }
  const blocker = findBattleRouteSegmentBlocker(from, to, obstacles, clearance);
  if (!blocker) {
    outWaypoints.push(to.clone());
    return;
  }
  computeBattleRouteDetour(from, to, blocker.center, blocker.radius + clearance, _mid);
  appendBattleRouteSegment(from, _mid, obstacles, clearance, depth + 1, outWaypoints);
  appendBattleRouteSegment(_mid, to, obstacles, clearance, depth + 1, outWaypoints);
}

/**
 * Visibility-style detour waypoints from ship to goal around shard spheres.
 * @param {import('three').Vector3} shipPos
 * @param {import('three').Vector3} goalPos
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} clearance — added to each shard radius (ship size + pad)
 * @param {THREE.Vector3[]} outWaypoints — intermediate points ending at goal
 */
export function planBattleRouteWaypoints(shipPos, goalPos, obstacles, clearance, outWaypoints) {
  outWaypoints.length = 0;
  if (obstacles.length === 0) {
    outWaypoints.push(goalPos.clone());
    return;
  }
  appendBattleRouteSegment(shipPos, goalPos, obstacles, clearance, 0, outWaypoints);
  dedupeBattleWaypoints(outWaypoints, 0.25);
}

/**
 * @param {THREE.Vector3[]} waypoints
 * @param {number} minDist
 */
function dedupeBattleWaypoints(waypoints, minDist) {
  if (waypoints.length < 2) return;
  const minSq = minDist * minDist;
  for (let i = waypoints.length - 1; i > 0; i--) {
    if (waypoints[i].distanceToSquared(waypoints[i - 1]) < minSq) {
      waypoints.splice(i, 1);
    }
  }
}

/**
 * @param {import('three').Vector3} point — mutated
 * @param {{ center: THREE.Vector3, radius: number }[]} obstacles
 * @param {number} clearance
 * @param {import('three').Vector3} fallbackFrom
 */
export function nudgePointClearOfShardObstacles(point, obstacles, clearance, fallbackFrom) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const o of obstacles) {
      _toShard.subVectors(point, o.center);
      const dist = _toShard.length();
      const minDist = o.radius + clearance;
      if (dist >= minDist) continue;
      if (dist < 1e-6) {
        _toShard.subVectors(point, fallbackFrom);
        if (_toShard.lengthSq() < 1e-8) _toShard.set(0, 1, 0);
      }
      _toShard.normalize().multiplyScalar(minDist);
      point.copy(o.center).add(_toShard);
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Planet-local radii for the red arena mesh (parented to the planet mesh).
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @returns {{ innerR: number, outerR: number, wallHeight: number }}
 */
export function computeBattleRingBoundaryRadii(pyramidField) {
  const cfg = pyramidField.config;
  const ringScale = cfg.pattern?.ringRadiusScale ?? 1;
  const patternR = cfg.patternOrbitRadius * ringScale;
  const innerR = patternR * RING_PATTERN_INNER_BAND_FRAC * BATTLE_RING_BOUNDARY_INNER_FRAC;
  const outerR = patternR * RING_PATTERN_OUTER_BAND_FRAC * BATTLE_RING_BOUNDARY_OUTER_FRAC;
  const wallHeight = Math.max(patternR * 0.42, (outerR - innerR) * 1.6);
  return { innerR, outerR, wallHeight };
}

/**
 * @param {import('three').Vector3} shipPos
 * @param {import('three').Vector3} planetCenter
 * @param {number} innerR
 * @param {number} outerR
 * @param {number} shipRadius
 */
export function isOutsideBattleRingBoundary(
  shipPos,
  planetCenter,
  innerR,
  outerR,
  shipRadius,
) {
  _radial.subVectors(shipPos, planetCenter);
  const r = Math.hypot(_radial.x, _radial.z);
  const pad = shipRadius * BATTLE_RING_BOUNDARY_SHIP_PAD_MULT;
  return r < innerR - pad || r > outerR + pad;
}

/**
 * World-space ship vs planet-local fence radii (matches mesh parented to the planet).
 * @param {import('three').Vector3} shipWorldPos
 * @param {import('three').Mesh} planetMesh
 * @param {number} innerR
 * @param {number} outerR
 * @param {number} shipRadius
 */
export function isShipOutsideBattleRingBoundaryWorld(
  shipWorldPos,
  planetMesh,
  innerR,
  outerR,
  shipRadius,
) {
  planetMesh.updateWorldMatrix(true, true);
  _radial.copy(shipWorldPos);
  planetMesh.worldToLocal(_radial);
  return isOutsideBattleRingBoundary(_radial, _arenaOrigin, innerR, outerR, shipRadius);
}

function battleRingBoundaryMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xff2233,
    wireframe: true,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Red wireframe inner + outer cylinder walls for the battle arena.
 * @param {number} innerR
 * @param {number} outerR
 * @param {number} wallHeight
 */
export function buildBattleRingBoundaryMesh(innerR, outerR, wallHeight) {
  const g = new THREE.Group();
  g.name = "battleRingBoundary";
  const mat = battleRingBoundaryMaterial();
  const h = Math.max(wallHeight, 0.2);
  for (const r of [innerR, outerR]) {
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 56, 4, true),
      mat,
    );
    wall.frustumCulled = false;
    g.add(wall);
  }
  const ringMat = battleRingBoundaryMaterial();
  ringMat.opacity = 0.55;
  for (const ySign of [-1, 1]) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry((innerR + outerR) * 0.5, (outerR - innerR) * 0.5, 6, 48),
      ringMat,
    );
    torus.rotation.x = Math.PI / 2;
    torus.position.y = ySign * (h * 0.5);
    torus.frustumCulled = false;
    g.add(torus);
  }
  return g;
}

/** @param {import('three').Object3D | null} boundary */
export function disposeBattleRingBoundaryMesh(boundary) {
  if (!boundary) return;
  /** @type {Set<import('three').Material>} */
  const mats = new Set();
  boundary.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry.dispose();
    const m = obj.material;
    if (Array.isArray(m)) m.forEach((x) => mats.add(x));
    else mats.add(m);
  });
  for (const m of mats) m.dispose();
}

// ─── Ring-tunnel battle geometry ─────────────────────────────────────────────

const _localSpawn = new THREE.Vector3();
const _localTan = new THREE.Vector3();
const _spawnCandidate = new THREE.Vector3();
/** @type {{ center: THREE.Vector3, radius: number }[]} */
const _spawnObstacles = [];
/** Azimuth samples around the ring when picking the clearest spawn. */
const BATTLE_TUNNEL_SPAWN_SAMPLES = 240;

/**
 * Map a 1-based difficulty level to a shard band index. Level 1 = outermost band (last index),
 * each level steps inward. Clamped to the valid band range.
 * @param {number} level
 * @param {number[]} [fracs]
 */
export function levelToBandIndex(level, fracs = RING_PATTERN_BAND_FRACS) {
  const len = fracs?.length ?? RING_PATTERN_BAND_FRACS.length;
  return THREE.MathUtils.clamp(len - level, 0, len - 1);
}

/**
 * Ship hull scale for a battle level (inner rings get a smaller ship to fit tighter gaps).
 * @param {number} level
 */
export function battleHullScaleForLevel(level) {
  const i = THREE.MathUtils.clamp(
    level - 1,
    0,
    BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL.length - 1,
  );
  return BATTLE_TUNNEL_HULL_SCALE_BY_LEVEL[i] ?? BATTLE_SHIP_HULL_SCALE_DEFAULT;
}

/**
 * Planet-local torus geometry for a single-ring "tunnel" battle. The torus centerline follows
 * the chosen band's circle; the tube must enclose that band's shards (radial + vertical jitter +
 * shard radius + ship clearance) yet stay inside half the gap to the nearest neighbouring band
 * so other rings' shards remain outside the tunnel.
 *
 * All lengths are planet-local — callers divide world shard/ship radii by the mean planet scale.
 *
 * Returns two radii, decoupled on purpose:
 *  - `tubeRadius`   — the lethal wall: snug around the shards + a little ship room.
 *  - `hazardRadius` — collision membership (which shards are obstacles): generous, never smaller
 *    than the wall, so tightening the wall can't leave a visible ring shard non-lethal.
 *
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {number} bandIndex
 * @param {number} [avgShardRLocal]
 * @param {number} [shipRLocal]
 * @returns {{ ringRadius: number, tubeRadius: number, hazardRadius: number }}
 */
export function computeBattleTunnelGeometry(
  pyramidField,
  bandIndex,
  avgShardRLocal = 0,
  shipRLocal = 0,
) {
  const cfg = pyramidField.config;
  const pattern = cfg.pattern ?? {};
  const orbit = cfg.patternOrbitRadius;
  const ringScale = pattern.ringRadiusScale ?? 1;
  const fracs = pattern.ringBands ?? RING_PATTERN_BAND_FRACS;
  const jRadK = pattern.ringRadialJitter ?? 0.045;
  const jYK = pattern.ringVerticalJitter ?? 0.04;

  const bi = THREE.MathUtils.clamp(bandIndex, 0, fracs.length - 1);
  const ringRadius = orbit * fracs[bi] * ringScale;

  const radialHalf = jRadK * orbit * 0.5 + avgShardRLocal;
  const verticalHalf = jYK * orbit * 0.5 + avgShardRLocal;
  const shardEnclose = Math.hypot(radialHalf, verticalHalf);

  // Upper bound (band midline) so neither radius reaches the nearest neighbouring band's shards.
  let neighborFracGap = Infinity;
  if (bi - 1 >= 0) {
    neighborFracGap = Math.min(neighborFracGap, Math.abs(fracs[bi - 1] - fracs[bi]));
  }
  if (bi + 1 < fracs.length) {
    neighborFracGap = Math.min(neighborFracGap, Math.abs(fracs[bi + 1] - fracs[bi]));
  }
  const neighborCap = Number.isFinite(neighborFracGap)
    ? neighborFracGap * orbit * ringScale * 0.5 - jRadK * orbit * 0.5 - avgShardRLocal
    : Infinity;

  // Wall tube — snug, never collapsing below the shard envelope.
  const tubeFloor = shardEnclose + shipRLocal * 0.5;
  const desiredTube = shardEnclose + shipRLocal * SHIP_TUBE_CLEARANCE_MULT;
  const tubeRadius = Number.isFinite(neighborCap)
    ? Math.min(desiredTube, Math.max(neighborCap, tubeFloor))
    : desiredTube;

  // Hazard membership — generous, but never smaller than the wall and never past the neighbour band.
  const desiredHazard = Math.max(
    tubeRadius,
    shardEnclose + avgShardRLocal * BATTLE_TUNNEL_HAZARD_PAD_MULT,
  );
  const hazardRadius = Number.isFinite(neighborCap)
    ? Math.min(desiredHazard, Math.max(neighborCap, tubeRadius))
    : desiredHazard;

  return { ringRadius, tubeRadius, hazardRadius };
}

/**
 * Red wireframe torus wall wrapping one ring as a tunnel (planet-local radii, lies in XZ).
 * Touching it is lethal in gameplay; this just builds the mesh.
 * @param {number} ringRadius
 * @param {number} tubeRadius
 */
export function buildBattleTunnelMesh(ringRadius, tubeRadius) {
  const g = new THREE.Group();
  g.name = "battleTunnelBoundary";
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, Math.max(tubeRadius, 1e-4), 16, 96),
    battleRingBoundaryMaterial(),
  );
  torus.rotation.x = Math.PI / 2; // TorusGeometry lies in XY; rotate into the planet XZ plane
  torus.frustumCulled = false;
  g.add(torus);
  return g;
}

/** Teardown for {@link buildBattleTunnelMesh} (same generic disposal as the ring boundary). */
export function disposeBattleTunnelMesh(boundary) {
  disposeBattleRingBoundaryMesh(boundary);
}

/**
 * Planet-local torus wall test: is the point beyond the tube wall (lethal)?
 * @param {import('three').Vector3} localPos
 * @param {number} ringRadius
 * @param {number} tubeRadius
 * @param {number} shipRLocal
 */
export function isOutsideBattleTunnelLocal(localPos, ringRadius, tubeRadius, shipRLocal) {
  const planar = Math.hypot(localPos.x, localPos.z) - ringRadius;
  const d = Math.hypot(planar, localPos.y);
  return d > tubeRadius - shipRLocal * BATTLE_TUNNEL_WALL_PAD_MULT;
}

/**
 * World-space ship vs the planet-local tunnel wall (mesh is parented to the planet).
 * @param {import('three').Vector3} shipWorldPos
 * @param {import('three').Mesh} planetMesh
 * @param {number} ringRadius
 * @param {number} tubeRadius
 * @param {number} shipRLocal — battle ship radius in planet-local units
 */
export function isShipOutsideBattleTunnelWorld(
  shipWorldPos,
  planetMesh,
  ringRadius,
  tubeRadius,
  shipRLocal,
) {
  planetMesh.updateWorldMatrix(true, true);
  _radial.copy(shipWorldPos);
  planetMesh.worldToLocal(_radial);
  return isOutsideBattleTunnelLocal(_radial, ringRadius, tubeRadius, shipRLocal);
}

/**
 * Planet-local ring-tunnel membership (inside the tube around the band's centerline).
 * @param {import('three').Vector3} localPos
 * @param {number} ringRadius
 * @param {number} tubeRadius
 */
export function isInRingTunnelLocal(localPos, ringRadius, tubeRadius) {
  const planar = Math.hypot(localPos.x, localPos.z) - ringRadius;
  return Math.hypot(planar, localPos.y) <= tubeRadius;
}

/**
 * Shard spawn anchors (world positions) limited to those inside the ring tunnel tube.
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Mesh} planetMesh
 * @param {number} ringRadius
 * @param {number} tubeRadius
 * @param {ShardSpawnAnchor[]} out
 */
export function collectRingTunnelShardAnchors(
  pyramidField,
  planetMesh,
  ringRadius,
  tubeRadius,
  out,
) {
  planetMesh.updateWorldMatrix(true, true);
  out.length = 0;
  const consider = (/** @type {number} */ index, /** @type {THREE.Vector3} */ centerWorld) => {
    _scratch.copy(centerWorld);
    planetMesh.worldToLocal(_scratch);
    if (isInRingTunnelLocal(_scratch, ringRadius, tubeRadius)) {
      out.push({ index, position: centerWorld.clone() });
    }
  };
  if (typeof pyramidField.forEachShardSpawnAnchor === "function") {
    pyramidField.forEachShardSpawnAnchor(consider);
  } else {
    pyramidField.forEachVisibleShardWorld(consider);
  }
}

/**
 * Shard colliders (world) limited to the ring tunnel tube — obstacles for routing / hit tests.
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {import('three').Mesh} planetMesh
 * @param {number} ringRadius
 * @param {number} tubeRadius
 * @param {{ center: THREE.Vector3, radius: number }[]} out
 */
export function collectRingTunnelShardObstacles(
  pyramidField,
  planetMesh,
  ringRadius,
  tubeRadius,
  out,
) {
  planetMesh.updateWorldMatrix(true, true);
  out.length = 0;
  pyramidField.forEachBattleShardCollider(({ centerWorld, radius }) => {
    _scratch.copy(centerWorld);
    planetMesh.worldToLocal(_scratch);
    if (isInRingTunnelLocal(_scratch, ringRadius, tubeRadius)) {
      out.push({ center: centerWorld.clone(), radius });
    }
  });
}

/**
 * Place the ship on the ring centerline at the azimuth with the most clearance from the band's
 * shard colliders, facing tangent toward increasing azimuth. Clearance is measured against the
 * *same* colliders the damage test uses ({@link collectRingTunnelShardObstacles}, i.e. shattered
 * fragments) — anchor centroids hide fragments that splay into a gap and cause instant death.
 * Centerline placement also keeps the ship off the lethal tube wall.
 * @param {import('three').Mesh} planetMesh
 * @param {import('../pyramid/pyramid-field.js').default} pyramidField
 * @param {number} ringRadius — planet-local centerline radius
 * @param {number} membershipRadius — planet-local hazard radius (which shards count as obstacles)
 * @param {number} shipRadius — battle ship collision radius (world units)
 * @param {import('three').Vector3} outEntry
 * @param {import('three').Vector3} outFieldDir
 */
export function computeBattleTunnelSpawn(
  planetMesh,
  pyramidField,
  ringRadius,
  membershipRadius,
  shipRadius,
  outEntry,
  outFieldDir,
) {
  planetMesh.updateWorldMatrix(true, true);
  collectRingTunnelShardObstacles(
    pyramidField,
    planetMesh,
    ringRadius,
    membershipRadius,
    _spawnObstacles,
  );

  const margin = shipRadius * BATTLE_SPAWN_CLEARANCE_MULT;
  let bestTheta = 0;
  let bestClear = -Infinity;
  for (let i = 0; i < BATTLE_TUNNEL_SPAWN_SAMPLES; i++) {
    const theta = (i / BATTLE_TUNNEL_SPAWN_SAMPLES) * Math.PI * 2;
    _spawnCandidate.set(Math.cos(theta) * ringRadius, 0, Math.sin(theta) * ringRadius);
    planetMesh.localToWorld(_spawnCandidate);
    const clear = minClearanceAtPoint(_spawnCandidate, _spawnObstacles, margin);
    if (clear > bestClear) {
      bestClear = clear;
      bestTheta = theta;
    }
  }

  const theta = bestTheta;
  _localSpawn.set(Math.cos(theta) * ringRadius, 0, Math.sin(theta) * ringRadius);
  outEntry.copy(_localSpawn);
  planetMesh.localToWorld(outEntry);

  // Tangent toward +azimuth: transform a local offset point and subtract (keeps rotation + scale).
  _localTan
    .set(-Math.sin(theta) * ringRadius, 0, Math.cos(theta) * ringRadius)
    .add(_localSpawn);
  planetMesh.localToWorld(_localTan);
  outFieldDir.subVectors(_localTan, outEntry);
  if (outFieldDir.lengthSq() < 1e-8) outFieldDir.set(0, 0, -1);
  outFieldDir.normalize();
}

/**
 * Place the goal a short arc ahead of the ship along the ring centerline (planet-local), in the
 * +azimuth travel direction (matching the spawn heading). Keeps the goal right in front of the
 * ship rather than a full shard gap away. Outputs a world position.
 * @param {import('three').Mesh} planetMesh
 * @param {number} ringRadius — planet-local centerline radius
 * @param {import('three').Vector3} shipWorldPos
 * @param {number} arcDistance — planet-local arc length ahead of the ship
 * @param {import('three').Vector3} outGoal
 */
export function computeBattleTunnelGoalAhead(planetMesh, ringRadius, shipWorldPos, arcDistance, outGoal) {
  planetMesh.updateWorldMatrix(true, true);
  _scratch.copy(shipWorldPos);
  planetMesh.worldToLocal(_scratch);
  const theta = Math.atan2(_scratch.z, _scratch.x) + arcDistance / Math.max(ringRadius, 1e-6);
  outGoal.set(Math.cos(theta) * ringRadius, 0, Math.sin(theta) * ringRadius);
  planetMesh.localToWorld(outGoal);
}

function portalLayerMaterial(color, opacity, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** @param {number} avgShardRadius */
export function buildBattleGoalMarker(avgShardRadius) {
  const g = new THREE.Group();
  /** Visual extent ≈ one shard collider diameter (2× avgShardRadius). */
  const portalR = Math.max(0.012, avgShardRadius);
  const spinRings = [];

  const voidDisc = new THREE.Mesh(
    new THREE.CircleGeometry(portalR * 0.42, 32),
    portalLayerMaterial(0x020806, 0.88),
  );
  g.add(voidDisc);

  const layers = [
    { inner: 0.52, outer: 0.88, color: 0x4ade80, opacity: 0.95, additive: false },
    { inner: 0.42, outer: 0.5, color: 0xbbf7d0, opacity: 0.7, additive: false },
    { inner: 0.9, outer: 1.02, color: 0x22c55e, opacity: 0.28, additive: true },
  ];
  for (const layer of layers) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(portalR * layer.inner, portalR * layer.outer, 48),
      portalLayerMaterial(layer.color, layer.opacity, layer.additive),
    );
    g.add(ring);
    spinRings.push(ring);
  }

  const rimTube = Math.max(0.002, avgShardRadius * 0.06);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(portalR * 0.68, rimTube, 10, 40),
    portalLayerMaterial(0x6ee7b7, 0.9),
  );
  g.add(rim);
  spinRings.push(rim);

  g.userData.pulsePhase = Math.random() * Math.PI * 2;
  g.userData.spinRings = spinRings;
  return g;
}
