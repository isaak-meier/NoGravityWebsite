import * as THREE from 'three';
import { getPatternWorldPosition } from './fragment-pattern-math.js';

/**
 * Wave-level slotting for field-wide patterns. Call `beginWave` → `registerShard` (each shard) → `finalizeWave`.
 */
export default class FragmentPatternCoordinator {
  constructor() {
    /** @type {Map<number, { fragmentCount: number, baseOffset: number }>} */
    this._shardMap = new Map();
    this._waveIndex = 0;
    this._patternId = 0;
    this._center = new THREE.Vector3();
    /** @type {Record<string, unknown>} */
    this._params = {};
    this._seed = 0;
    this._totalN = 0;
    this._finalized = false;
  }

  /**
   * @param {object} opts
   * @param {number} opts.waveIndex
   * @param {number} opts.patternId
   * @param {import('three').Vector3} opts.center
   * @param {Record<string, unknown>} [opts.params] — `orbitRadius` = locked pattern scale; optional `orbitRadiusBurst` = scale at the start of the pattern lerp.
   */
  beginWave({ waveIndex, patternId, center, params }) {
    this._waveIndex = waveIndex;
    this._patternId = patternId;
    this._center.copy(center);
    this._params = params ? { ...params } : {};
    this._seed = waveIndex * 7919 + patternId * 31;
    this._shardMap.clear();
    this._totalN = 0;
    this._finalized = false;
  }

  /** @param {number} shardIndex
   * @param {number} fragmentCount */
  registerShard(shardIndex, fragmentCount) {
    this._shardMap.set(shardIndex, { fragmentCount, baseOffset: -1 });
  }

  finalizeWave() {
    const entries = [...this._shardMap.entries()].sort((a, b) => a[0] - b[0]);
    let offset = 0;
    for (const [, entry] of entries) {
      entry.baseOffset = offset;
      offset += entry.fragmentCount;
      this._totalN += entry.fragmentCount;
    }
    this._finalized = true;
  }

  get totalFragmentCount() {
    return this._totalN;
  }

  get patternId() {
    return this._patternId;
  }

  /** Wave params from the last {@link beginWave} (read-only for callers). */
  get params() {
    return this._params;
  }

  /** @param {number} shardIndex */
  getBaseOffset(shardIndex) {
    const e = this._shardMap.get(shardIndex);
    return e ? e.baseOffset : 0;
  }

  /**
   * @param {import('three').Vector3} out
   * @param {number} globalIndex
   * @param {number} [orbitRadiusOverride] — per-frame effective orbit (e.g. burst → pattern ramp)
   */
  getWorldTarget(out, globalIndex, orbitRadiusOverride) {
    const params =
      orbitRadiusOverride != null
        ? { ...this._params, orbitRadius: orbitRadiusOverride }
        : this._params;
    return getPatternWorldPosition(
      out,
      this._patternId,
      globalIndex,
      this._totalN,
      this._center.x,
      this._center.y,
      this._center.z,
      this._seed,
      params,
    );
  }

  get finalized() {
    return this._finalized;
  }
}
