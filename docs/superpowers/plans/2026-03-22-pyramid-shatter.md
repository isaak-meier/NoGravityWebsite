# Pyramid Field Shatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluster-based PyramidField with freely scattered Fibonacci-sphere shards that shatter into fragments on detected beats and recombine over one musical bar.

**Architecture:** Three modules — `BeatDetector` (audio analysis), `ShardShatter` (fracture engine + InstancedMesh pool), and a rewritten `PyramidField` (orchestrator). BeatDetector is created in `three-scene.js` and injected into PyramidField. ShardShatter is owned by PyramidField internally.

**Tech Stack:** Three.js, `realtime-bpm-analyzer` (npm), Web Audio API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-pyramid-shatter-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/audio/beat-detector.js` | BPM detection + beat onset | Create |
| `src/audio/beat-detector.test.js` | Tests for BeatDetector | Create |
| `src/pyramid/shard-shatter.js` | Fracture engine, InstancedMesh pool, recombination | Create |
| `src/pyramid/shard-shatter.test.js` | Tests for ShardShatter | Create |
| `src/pyramid/pyramid-field.js` | Orchestrator: Fibonacci layout, breathing, drift, delegates to ShardShatter | Rewrite |
| `src/pyramid/pyramid-field.test.js` | Tests updated for new layout + shatter integration | Rewrite |
| `src/scene/three-scene.js` | Wire BeatDetector, pass to PyramidField | Modify |
| `src/scene/three-scene.test.js` | Update any PyramidField-related integration tests | Modify |
| `package.json` | Add `realtime-bpm-analyzer` dependency | Modify |

---

## Task 1: Install `realtime-bpm-analyzer`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install realtime-bpm-analyzer
```

- [ ] **Step 2: Verify it installed**

```bash
node -e "import('realtime-bpm-analyzer').then(() => console.log('OK'))"
```

Expected: prints `OK` without errors.

- [ ] **Step 3: Check ESM/AudioWorklet requirements**

Read the library's entry point to determine if it uses AudioWorklet (needs a separate `.js` file served) or ScriptProcessorNode. Document findings in a code comment in `beat-detector.js` (Task 2).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add realtime-bpm-analyzer dependency"
```

---

## Task 2: Build `BeatDetector`

**Files:**
- Create: `src/audio/beat-detector.js`
- Create: `src/audio/beat-detector.test.js`

### Step-by-step (TDD)

- [ ] **Step 1: Write failing test — constructor and defaults**

In `src/audio/beat-detector.test.js`:

```javascript
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BeatDetector from './beat-detector.js';

describe('BeatDetector', () => {
  describe('constructor', () => {
    it('initializes with default fallback values', () => {
      const bd = new BeatDetector();
      expect(bd.sensitivity).toBe(1.0);
      expect(bd.bpm).toBe(0);
      expect(bd.barDuration).toBe(2.0);
    });

    it('accepts a custom sensitivity', () => {
      const bd = new BeatDetector({ sensitivity: 1.5 });
      expect(bd.sensitivity).toBe(1.5);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal BeatDetector class**

In `src/audio/beat-detector.js`:

```javascript
export default class BeatDetector {
  constructor({ sensitivity = 1.0 } = {}) {
    this.sensitivity = sensitivity;
    this.bpm = 0;
    this.barDuration = 2.0; // fallback until BPM is detected
    this._lowEnergyAvg = 0;
    this._lowEnergyAlpha = 0.05;
    this._lastBeat = false;
    this._lastIntensity = 0;
    this._analyser = null;
    this._bpmAnalyzer = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: PASS

- [ ] **Step 5: Write failing test — `update()` returns beat info with fallback values when no audio**

```javascript
describe('update', () => {
  it('returns isBeat=false and intensity=0 with null fftData', () => {
    const bd = new BeatDetector();
    const result = bd.update(null);
    expect(result.isBeat).toBe(false);
    expect(result.intensity).toBe(0);
    expect(result.barDuration).toBe(2.0);
  });

  it('returns isBeat=false for silent spectrum', () => {
    const bd = new BeatDetector();
    const silent = new Float32Array(1024).fill(0);
    const result = bd.update(silent);
    expect(result.isBeat).toBe(false);
    expect(result.intensity).toBe(0);
  });
});
```

- [ ] **Step 6: Implement `update()` method**

Add to `BeatDetector`:

```javascript
update(fftData) {
  if (!fftData || fftData.length === 0) {
    this._lastBeat = false;
    this._lastIntensity = 0;
    return { isBeat: false, intensity: 0, barDuration: this.barDuration };
  }

  // Low-frequency energy: first ~10% of bins (~60-200Hz range for typical 2048 FFT)
  const lowEnd = Math.max(1, Math.floor(fftData.length * 0.1));
  let lowEnergy = 0;
  for (let i = 0; i < lowEnd; i++) lowEnergy += fftData[i];
  lowEnergy /= lowEnd;

  // Running average with exponential smoothing
  this._lowEnergyAvg += (lowEnergy - this._lowEnergyAvg) * this._lowEnergyAlpha;

  // Beat onset: current energy exceeds average by threshold
  const threshold = this._lowEnergyAvg * (1.0 + 0.5 * this.sensitivity);
  const isBeat = lowEnergy > threshold && lowEnergy > 0.05;

  // Intensity: how far above threshold, clamped 0-1
  let intensity = 0;
  if (isBeat && threshold > 0) {
    intensity = Math.min(1, (lowEnergy - threshold) / threshold);
  }

  this._lastBeat = isBeat;
  this._lastIntensity = intensity;
  return { isBeat, intensity, barDuration: this.barDuration };
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: PASS

- [ ] **Step 8: Write failing test — `setAnalyser()` resets BPM state**

```javascript
describe('setAnalyser', () => {
  it('resets bpm to 0 and barDuration to fallback', () => {
    const bd = new BeatDetector();
    bd.bpm = 90;
    bd._updateBarDuration(); // barDuration becomes (60/90)*4 ≈ 2.667
    expect(bd.barDuration).not.toBe(2.0);
    bd.setAnalyser(null);
    expect(bd.bpm).toBe(0);
    expect(bd.barDuration).toBe(2.0); // actually tests the reset
  });
});
```

- [ ] **Step 9: Implement `setAnalyser()`**

```javascript
setAnalyser(analyserNode) {
  this._analyser = analyserNode;
  this.bpm = 0;
  this.barDuration = 2.0;
  this._lowEnergyAvg = 0;
  // Reset/reconnect realtime-bpm-analyzer here (wired in integration step)
}
```

- [ ] **Step 10: Run tests**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: PASS

- [ ] **Step 11: Write failing test — BPM updates barDuration**

```javascript
describe('bpm-to-barDuration', () => {
  it('computes barDuration as (60/bpm)*4 when bpm is set', () => {
    const bd = new BeatDetector();
    bd.bpm = 120;
    bd._updateBarDuration();
    expect(bd.barDuration).toBe(2.0); // (60/120)*4 = 2.0
  });

  it('keeps fallback barDuration when bpm is 0', () => {
    const bd = new BeatDetector();
    bd.bpm = 0;
    bd._updateBarDuration();
    expect(bd.barDuration).toBe(2.0);
  });
});
```

- [ ] **Step 12: Implement `_updateBarDuration()`**

```javascript
_updateBarDuration() {
  if (this.bpm > 0) {
    this.barDuration = (60 / this.bpm) * 4;
  } else {
    this.barDuration = 2.0;
  }
}
```

- [ ] **Step 13: Run tests**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: PASS

- [ ] **Step 14: Wire `realtime-bpm-analyzer` integration**

Add the BPM analyzer connection in `setAnalyser()`. This integrates with the library's API to receive BPM candidates and update `this.bpm` + `this.barDuration`. The exact wiring depends on whether the library uses AudioWorklet or ScriptProcessorNode (determined in Task 1, Step 3).

Consult the library docs at `node_modules/realtime-bpm-analyzer/README.md` for the correct setup. The key integration point: when the library emits a BPM candidate, set `this.bpm = candidate` and call `this._updateBarDuration()`.

- [ ] **Step 15: Write failing test — `setupGUI` adds sensitivity slider**

```javascript
describe('setupGUI', () => {
  it('adds sensitivity slider to a Beat Detection folder', () => {
    const bd = new BeatDetector();
    const addCalls = [];
    const mockFolder = {
      add: vi.fn((...args) => {
        addCalls.push(args[1]);
        return { name: vi.fn().mockReturnThis(), min: vi.fn().mockReturnThis(), max: vi.fn().mockReturnThis(), step: vi.fn().mockReturnThis() };
      }),
      open: vi.fn(),
    };
    const mockGui = { addFolder: vi.fn(() => mockFolder) };
    bd.setupGUI(mockGui);
    expect(mockGui.addFolder).toHaveBeenCalledWith('Beat Detection');
    expect(addCalls).toContain('sensitivity');
  });
});
```

- [ ] **Step 16: Implement `setupGUI()`**

```javascript
setupGUI(gui) {
  const folder = gui.addFolder('Beat Detection');
  folder.add(this, 'sensitivity', 0.1, 3.0, 0.1).name('Sensitivity');
  folder.open();
  return folder;
}
```

- [ ] **Step 17: Run all BeatDetector tests**

```bash
npx vitest run src/audio/beat-detector.test.js
```

Expected: all PASS

- [ ] **Step 18: Commit**

```bash
git add src/audio/beat-detector.js src/audio/beat-detector.test.js
git commit -m "feat: add BeatDetector with onset detection, BPM integration, and GUI"
```

---

## Task 3: Build `ShardShatter` — Geometry Subdivision

**Files:**
- Create: `src/pyramid/shard-shatter.js`
- Create: `src/pyramid/shard-shatter.test.js`

This task covers the centroid subdivision algorithm and fragment state management. The InstancedMesh pool and animation come in Task 4.

### Step-by-step (TDD)

- [ ] **Step 1: Write failing test — `subdivide()` splits 6-triangle cone into 18 fragments at depth 1**

In `src/pyramid/shard-shatter.test.js`:

```javascript
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import ShardShatter from './shard-shatter.js';

describe('ShardShatter', () => {
  function makeConeGeo() {
    return new THREE.ConeGeometry(0.16, 0.4, 3);
  }

  describe('subdivide', () => {
    it('produces 18 fragment positions at depth 1', () => {
      const ss = new ShardShatter({ maxShards: 5, material: new THREE.MeshStandardMaterial() });
      const geo = makeConeGeo();
      const fragments = ss._subdivide(geo, 1);
      expect(fragments.length).toBe(18);
    });

    it('produces 54 fragments at depth 2', () => {
      const ss = new ShardShatter({ maxShards: 5, material: new THREE.MeshStandardMaterial() });
      const geo = makeConeGeo();
      const fragments = ss._subdivide(geo, 2);
      expect(fragments.length).toBe(54);
    });

    it('produces 162 fragments at depth 3', () => {
      const ss = new ShardShatter({ maxShards: 5, material: new THREE.MeshStandardMaterial() });
      const geo = makeConeGeo();
      const fragments = ss._subdivide(geo, 3);
      expect(fragments.length).toBe(162);
    });

    it('each fragment has a centroid position and triangle vertices', () => {
      const ss = new ShardShatter({ maxShards: 5, material: new THREE.MeshStandardMaterial() });
      const geo = makeConeGeo();
      const fragments = ss._subdivide(geo, 1);
      for (const frag of fragments) {
        expect(frag.centroid).toBeInstanceOf(THREE.Vector3);
        expect(frag.vertices).toHaveLength(3);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ShardShatter` class with `_subdivide()`**

In `src/pyramid/shard-shatter.js`:

The `_subdivide(geometry, depth)` method:
1. Extracts triangles from the BufferGeometry's position attribute (using index if present).
2. For each pass (up to `depth`): splits every triangle into 3 sub-triangles by connecting the centroid to each pair of vertices.
3. Returns an array of `{ centroid: Vector3, vertices: [Vector3, Vector3, Vector3] }` objects.

Implementation should be ~30 lines for the subdivision loop. The class constructor takes `{ maxShards, material }`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pyramid/shard-shatter.js src/pyramid/shard-shatter.test.js
git commit -m "feat: add ShardShatter with centroid subdivision algorithm"
```

---

## Task 4: Build `ShardShatter` — InstancedMesh Pool & Animation

**Files:**
- Modify: `src/pyramid/shard-shatter.js`
- Modify: `src/pyramid/shard-shatter.test.js`

### Step-by-step (TDD)

- [ ] **Step 1: Write failing test — `triggerShatter()` marks shard as shattered**

```javascript
describe('triggerShatter', () => {
  it('marks a shard as shattered', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    const geo = new THREE.ConeGeometry(0.16, 0.4, 3);
    ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0));
    ss.triggerShatter(0, 0.5);
    expect(ss.isShattered(0)).toBe(true);
  });

  it('non-shattered shard returns false', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    ss.registerShard(0, new THREE.ConeGeometry(0.16, 0.4, 3), new THREE.Vector3(1, 0, 0));
    expect(ss.isShattered(0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

- [ ] **Step 3: Implement `registerShard()`, `triggerShatter()`, `isShattered()`**

- `registerShard(index, geometry, worldPosition)` — stores reference to a shard's geometry and position for later subdivision.
- `triggerShatter(index, intensity)` — computes depth from intensity (0–0.33→1, 0.33–0.66→2, 0.66–1→3), runs `_subdivide()`, creates fragment state with randomized velocities, sets `t = 0`.
- `isShattered(index)` — returns whether the shard has an active shatter state.

- [ ] **Step 4: Run test, verify pass**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

- [ ] **Step 5: Write failing test — `update()` advances `t` and completes recombination**

```javascript
describe('update', () => {
  it('advances t toward 1.0 over barDuration', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    const geo = new THREE.ConeGeometry(0.16, 0.4, 3);
    ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0));
    ss.triggerShatter(0, 0.2);
    ss.update(1.0, 2.0); // 1s elapsed, 2s bar → t ≈ 0.5
    expect(ss.isShattered(0)).toBe(true);
  });

  it('completes recombination when t >= 1.0', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    const geo = new THREE.ConeGeometry(0.16, 0.4, 3);
    ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0));
    ss.triggerShatter(0, 0.2);
    ss.update(3.0, 2.0); // 3s elapsed, 2s bar → t >= 1.0
    expect(ss.isShattered(0)).toBe(false);
  });
});
```

- [ ] **Step 6: Implement `update(deltaTime, barDuration)`**

The update method:
1. For each active shatter state, advance `t += deltaTime / barDuration`.
2. For each fragment, compute position based on current phase (outward / drift / return) using the timeline from the spec.
3. When `t >= 1.0`, mark the shatter as complete (free pool slots).
4. Update the InstancedMesh instance matrices.

- [ ] **Step 7: Run test, verify pass**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

- [ ] **Step 8: Write failing test — re-shatter resets t and reallocates**

```javascript
describe('re-shatter', () => {
  it('resets t to 0 when re-shattered mid-recombination', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    const geo = new THREE.ConeGeometry(0.16, 0.4, 3);
    ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0));
    ss.triggerShatter(0, 0.2);
    ss.update(0.5, 2.0); // advance partially
    ss.triggerShatter(0, 0.8); // re-shatter at higher intensity
    expect(ss.isShattered(0)).toBe(true);
    // After a full bar it should complete
    ss.update(2.5, 2.0);
    expect(ss.isShattered(0)).toBe(false);
  });
});
```

- [ ] **Step 9: Implement re-shatter logic**

In `triggerShatter()`: if the shard is already shattered, free old fragment slots, recompute depth from new intensity, subdivide again, assign new velocities from current fragment positions, reset `t = 0`.

- [ ] **Step 10: Run tests**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

Expected: PASS

- [ ] **Step 11: Write failing test — InstancedMesh pool**

```javascript
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
    // Worst case: 5 shards × 162 fragments at depth 3
    const meshes = ss.group.children.filter(c => c.isInstancedMesh);
    const totalSlots = meshes.reduce((sum, m) => sum + m.count, 0);
    expect(totalSlots).toBeGreaterThanOrEqual(5 * 162);
  });
});
```

- [ ] **Step 12: Implement InstancedMesh pool in constructor**

Pre-allocate InstancedMesh instances per depth level in the constructor, sized for `maxShards × fragmentsAtDepth`. All instances start hidden (`count` set to 0 active, or via visibility). Store in `this.group` so PyramidField can add it to the scene.

- [ ] **Step 13: Run tests**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

Expected: PASS

- [ ] **Step 14: Write failing test — `dispose()` cleans up**

```javascript
describe('dispose', () => {
  it('clears all shatter states', () => {
    const mat = new THREE.MeshStandardMaterial();
    const ss = new ShardShatter({ maxShards: 5, material: mat });
    const geo = new THREE.ConeGeometry(0.16, 0.4, 3);
    ss.registerShard(0, geo, new THREE.Vector3(1, 0, 0));
    ss.triggerShatter(0, 0.5);
    ss.dispose();
    expect(ss.isShattered(0)).toBe(false);
  });
});
```

- [ ] **Step 15: Implement `dispose()`**

Clear all shatter states, dispose InstancedMesh geometries, remove InstancedMesh from parent group.

- [ ] **Step 16: Run all ShardShatter tests**

```bash
npx vitest run src/pyramid/shard-shatter.test.js
```

Expected: all PASS

- [ ] **Step 17: Commit**

```bash
git add src/pyramid/shard-shatter.js src/pyramid/shard-shatter.test.js
git commit -m "feat: add ShardShatter pool, animation timeline, re-shatter, and dispose"
```

---

## Task 5: Rewrite `PyramidField` — Fibonacci Layout

**Files:**
- Modify: `src/pyramid/pyramid-field.js`
- Modify: `src/pyramid/pyramid-field.test.js`

This task replaces the cluster/band layout with the Fibonacci sphere of individual shards. Shatter integration comes in Task 6.

### Step-by-step (TDD)

- [ ] **Step 1: Write new constructor tests**

Replace the existing constructor tests in `src/pyramid/pyramid-field.test.js`:

```javascript
describe('constructor', () => {
  it('creates with default config (count=60)', () => {
    const pf = new PyramidField();
    expect(pf.config.count).toBe(60);
    expect(pf.config.shardDrift).toBe(0.05);
    expect(pf._barDuration).toBe(2.0);
  });

  it('creates one Mesh per shard (no clusters)', () => {
    const pf = new PyramidField({ count: 10 });
    expect(pf._shards.length).toBe(10);
    pf._shards.forEach(s => expect(s.mesh).toBeInstanceOf(THREE.Mesh));
  });

  it('creates a single shared ConeGeometry', () => {
    const pf = new PyramidField({ count: 5 });
    expect(pf._geometry).toBeInstanceOf(THREE.ConeGeometry);
  });

  it('distributes shards on a Fibonacci sphere', () => {
    const pf = new PyramidField({ count: 20 });
    // All shards should be at orbitRadius distance from origin
    for (const s of pf._shards) {
      const d = s.mesh.position.length();
      expect(d).toBeCloseTo(pf.config.orbitRadius, 1);
    }
  });

  it('orients shards outward from center', () => {
    const pf = new PyramidField({ count: 10 });
    const up = new THREE.Vector3(0, 1, 0);
    for (const s of pf._shards) {
      const dir = s.mesh.position.clone().normalize();
      // The mesh's local Y should roughly align with dir
      const localUp = up.clone().applyQuaternion(s.mesh.quaternion);
      expect(localUp.dot(dir)).toBeGreaterThan(0.8);
    }
  });

  it('applies ±30% size variation', () => {
    const pf = new PyramidField({ count: 30, size: 0.4 });
    const scales = pf._shards.map(s => s.mesh.scale.x);
    const min = Math.min(...scales);
    const max = Math.max(...scales);
    expect(min).toBeGreaterThanOrEqual(0.7 * 0.9); // allow for random variance
    expect(max).toBeLessThanOrEqual(1.3 * 1.1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

- [ ] **Step 3: Rewrite `PyramidField` constructor and `rebuild()`**

Rewrite `src/pyramid/pyramid-field.js`:
- Remove `BANDS` constant, `_clusters`, `_geometries` array, `basePositions`.
- New internal structure: `_shards` array where each entry is `{ mesh, dir, baseRadius, sizeMult, driftDir, driftMult }`.
- Single shared `ConeGeometry` (size from config).
- `rebuild()` distributes shards on Fibonacci sphere using golden-angle algorithm. Each shard gets ±30% scale via `mesh.scale.setScalar(sizeMult)`.
- Config defaults: `count: 60`, `shardDrift: 0.05` (replaces `shardSpin: 0.25`).
- Initialize `this._barDuration = 2.0` (fallback until a beat arrives) and `this._shatter = null` (wired in Task 6).

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

- [ ] **Step 5: Write failing test — `update()` with orbit breathing and drift**

```javascript
describe('update', () => {
  it('rotates the group', () => {
    const pf = new PyramidField({ count: 5 });
    pf.update(1.0);
    expect(pf.group.rotation.y).toBeCloseTo(pf.config.rotationSpeed);
  });

  it('applies gentle drift rotation to each shard', () => {
    const pf = new PyramidField({ count: 5 });
    const rotBefore = pf._shards.map(s => s.mesh.rotation.y);
    pf.update(1.0);
    pf._shards.forEach((s, i) => {
      expect(s.mesh.rotation.y).not.toBe(rotBefore[i]);
    });
  });

  it('oscillates orbit radius (breathing)', () => {
    const pf = new PyramidField({ count: 5 });
    const r0 = pf._shards[0].mesh.position.length();
    pf.update(5.0); // advance significantly
    const r1 = pf._shards[0].mesh.position.length();
    expect(r1).not.toBeCloseTo(r0, 2);
  });
});
```

- [ ] **Step 6: Implement `update()` — rotation, drift, orbit breathing**

Port the existing orbit breathing logic (sine oscillation between `_orbitMin` and `_orbitMax`, intro lerp) and apply per-shard drift (much slower than old `shardSpin`). Remove the cluster-based iteration.

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: PASS

- [ ] **Step 8: Write failing test — `applySpectrum()` with per-shard frequency bands**

```javascript
describe('applySpectrum', () => {
  it('assigns frequency bands by shard index', () => {
    const pf = new PyramidField({ count: 10 });
    const spectrum = new Float32Array(64).fill(0.5);
    pf.applySpectrum(spectrum);
    // All shards should have slight scale increase
    for (const s of pf._shards) {
      expect(s.mesh.scale.x).toBeGreaterThan(s.sizeMult * 0.99);
    }
  });

  it('does not crash with null spectrum', () => {
    const pf = new PyramidField({ count: 5 });
    expect(() => pf.applySpectrum(null)).not.toThrow();
  });

  it('skips shattered shards', () => {
    // This test will be meaningful once ShardShatter is wired in Task 6.
    // For now, verify the code path doesn't crash.
    const pf = new PyramidField({ count: 5 });
    const spectrum = new Float32Array(64).fill(0.5);
    expect(() => pf.applySpectrum(spectrum)).not.toThrow();
  });
});
```

- [ ] **Step 9: Implement `applySpectrum()`**

New logic:
- Divide spectrum into bands based on shard count (or use a fixed number of bands and map shards to bands by index).
- Per-shard: scale pulse `1.0 + energy * 0.08`, positional push `energy * size * 0.3` outward.
- Skip shards where `this._shatter?.isShattered(i)` is true.
- Use lerp smoothing (existing `_spectrumSmoothing`).

- [ ] **Step 10: Run tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: PASS

- [ ] **Step 11: Write failing test — `dispose()`**

```javascript
describe('dispose', () => {
  it('clears shards and disposes geometry and material', () => {
    const pf = new PyramidField({ count: 5 });
    const geoSpy = vi.spyOn(pf._geometry, 'dispose');
    const matSpy = vi.spyOn(pf.material, 'dispose');
    pf.dispose();
    expect(pf._shards.length).toBe(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 12: Implement `dispose()` and `_disposeContents()`**

- [ ] **Step 13: Run all pyramid-field tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: all PASS

- [ ] **Step 14: Commit**

```bash
git add src/pyramid/pyramid-field.js src/pyramid/pyramid-field.test.js
git commit -m "feat: rewrite PyramidField with Fibonacci sphere layout, per-shard spectrum"
```

---

## Task 6: Integrate `ShardShatter` into `PyramidField`

**Files:**
- Modify: `src/pyramid/pyramid-field.js`
- Modify: `src/pyramid/pyramid-field.test.js`

### Step-by-step (TDD)

- [ ] **Step 1: Write failing test — PyramidField creates ShardShatter**

```javascript
import ShardShatter from './shard-shatter.js';

describe('shatter integration', () => {
  it('creates a ShardShatter instance internally', () => {
    const pf = new PyramidField({ count: 10 });
    expect(pf._shatter).toBeInstanceOf(ShardShatter);
  });
});
```

- [ ] **Step 2: Implement — instantiate ShardShatter in constructor**

In `pyramid-field.js` constructor, after building shards:
```javascript
this._shatter = new ShardShatter({ maxShards: this.config.maxSimultaneousShatter, material: this.material });
this._shards.forEach((s, i) => this._shatter.registerShard(i, this._geometry, s.mesh.position));
this.group.add(this._shatter.group);
```

- [ ] **Step 3: Run test, verify pass**

- [ ] **Step 4: Write failing test — `update()` passes beat info to ShardShatter**

```javascript
it('triggers shatters on beat and updates ShardShatter', () => {
  const pf = new PyramidField({ count: 10 });
  // Simulate a beat
  pf.onBeat({ isBeat: true, intensity: 0.5, barDuration: 2.0 });
  // At least one shard should be shattered
  const anyShattered = pf._shards.some((_, i) => pf._shatter.isShattered(i));
  expect(anyShattered).toBe(true);
});
```

- [ ] **Step 5: Implement `onBeat()` method**

```javascript
onBeat({ isBeat, intensity, barDuration }) {
  if (!isBeat || intensity <= 0) return;
  this._barDuration = barDuration;
  const eligible = [];
  for (let i = 0; i < this._shards.length; i++) {
    if (!this._shatter.isShattered(i)) eligible.push(i);
  }
  const cap = Math.min(this.config.maxSimultaneousShatter, this._shards.length);
  const n = Math.min(Math.ceil(intensity * cap), eligible.length);
  // Fisher-Yates partial shuffle for random selection
  for (let i = eligible.length - 1; i > 0 && eligible.length - 1 - i < n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const selected = eligible.slice(-n);
  for (const idx of selected) {
    this._shards[idx].mesh.visible = false;
    this._shatter.triggerShatter(idx, intensity);
  }
}
```

- [ ] **Step 6: Update `update()` to call `this._shatter.update(deltaTime, this._barDuration)`**

Also: after `_shatter.update()`, for any shard whose shatter just completed (`!isShattered(i)` and `mesh.visible === false`), set `mesh.visible = true`.

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: PASS

- [ ] **Step 8: Write failing test — `dispose()` chains to ShardShatter**

```javascript
it('disposes ShardShatter on dispose', () => {
  const pf = new PyramidField({ count: 5 });
  const spy = vi.spyOn(pf._shatter, 'dispose');
  pf.dispose();
  expect(spy).toHaveBeenCalled();
});
```

- [ ] **Step 9: Implement — call `this._shatter.dispose()` in `_disposeContents()`**

- [ ] **Step 10: Run all tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: all PASS

- [ ] **Step 11: Commit**

```bash
git add src/pyramid/pyramid-field.js src/pyramid/pyramid-field.test.js
git commit -m "feat: integrate ShardShatter into PyramidField with beat-driven shattering"
```

---

## Task 7: Wire `BeatDetector` into `three-scene.js`

**Files:**
- Modify: `src/scene/three-scene.js`
- Modify: `src/scene/three-scene.test.js`

### Step-by-step

- [ ] **Step 1: Import BeatDetector**

At the top of `three-scene.js`, add:
```javascript
import BeatDetector from "../audio/beat-detector.js";
```

- [ ] **Step 2: Instantiate BeatDetector in `initScene()`**

After `const audioState = createAudioState();`, add:
```javascript
const beatDetector = new BeatDetector();
if (gui) beatDetector.setupGUI(gui);
```

- [ ] **Step 3: Pass BeatDetector to `ensurePyramids()`**

Modify `ensurePyramids()` so PyramidField receives the BeatDetector (or store it so onSpectrum can use it):

```javascript
function ensurePyramids() {
  const world = worlds[0];
  if (!world.pyramidField) {
    world.pyramidField = new PyramidField();
    sphere.add(world.pyramidField.group);
    if (gui) world.pyramidField.setupGUI(gui);
  }
}
```

- [ ] **Step 4: Feed BeatDetector in `onSpectrum` callback**

In the `onSpectrum` callback, after existing logic, add:
```javascript
const beatInfo = beatDetector.update(spectrum);
if (worlds[0].pyramidField) {
  worlds[0].pyramidField.onBeat(beatInfo);
}
```

- [ ] **Step 5: Call `beatDetector.setAnalyser()` on audio source changes**

In `loadAudioSource()` and `startLiveAudio()`, after creating the FFT, call:
```javascript
beatDetector.setAnalyser(fft.analyser);
```

This requires passing `beatDetector` to those functions or making it accessible. The cleanest approach: add `beatDetector` to `audioState` or pass as a parameter to `loadAudioSource` and `startLiveAudio`.

- [ ] **Step 6: Update `three-scene.test.js`**

Update any tests that mock PyramidField instantiation or the audio pipeline to account for the new BeatDetector import and wiring. At minimum, verify no existing tests break.

- [ ] **Step 7: Run all tests**

```bash
npx vitest run
```

Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/scene/three-scene.js src/scene/three-scene.test.js
git commit -m "feat: wire BeatDetector into three-scene audio pipeline and PyramidField"
```

---

## Task 8: Update `setupGUI` and Config

**Files:**
- Modify: `src/pyramid/pyramid-field.js`

### Step-by-step

- [ ] **Step 1: Write failing test — GUI exposes new config properties**

```javascript
describe('setupGUI', () => {
  it('registers shardDrift, maxSimultaneousShatter, and count controls', () => {
    const pf = new PyramidField({ count: 10 });
    const addCalls = [];
    const mockFolder = {
      add: vi.fn((...args) => {
        addCalls.push(args[1]);
        return { name: vi.fn().mockReturnValue({ onChange: vi.fn() }) };
      }),
      open: vi.fn(),
    };
    const mockGui = { addFolder: vi.fn(() => mockFolder) };
    pf.setupGUI(mockGui);
    expect(addCalls).toContain('count');
    expect(addCalls).toContain('shardDrift');
    expect(addCalls).toContain('maxSimultaneousShatter');
  });
});
```

- [ ] **Step 2: Update `setupGUI()` in pyramid-field.js**

Replace old GUI bindings with new config properties. Remove references to `shardSpin`. Add `shardDrift`, `maxSimultaneousShatter`.

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pyramid/pyramid-field.js src/pyramid/pyramid-field.test.js
git commit -m "feat: update PyramidField GUI for new config properties"
```

---

## Task 9: Adapt Keyframe Tweening

**Files:**
- Modify: `src/pyramid/pyramid-field.js`
- Modify: `src/pyramid/pyramid-field.test.js`

### Step-by-step

- [ ] **Step 1: Write failing test — `setKeyframes()` stores per-shard state**

```javascript
describe('setKeyframes (new layout)', () => {
  it('stores per-shard target states', () => {
    const pf = new PyramidField({ count: 10 });
    const spectra = [new Float32Array(64).fill(0.5), new Float32Array(64).fill(1.0)];
    pf.setKeyframes(spectra);
    expect(pf._keyframes).not.toBeNull();
    expect(pf._keyframes.length).toBe(2);
    expect(pf._keyframes[0].length).toBe(10); // one entry per shard
  });

  it('skips shattered shards during tween', () => {
    const pf = new PyramidField({ count: 10 });
    const spectra = [new Float32Array(64).fill(0), new Float32Array(64).fill(1.0)];
    pf.setKeyframes(spectra, 6);
    // Shatter shard 0
    pf.onBeat({ isBeat: true, intensity: 1.0, barDuration: 2.0 });
    const posBefore = pf._shards[0].mesh.position.clone();
    pf.update(1.5);
    // If shattered, tween should not have moved it (mesh is hidden)
    if (pf._shatter.isShattered(0)) {
      expect(pf._shards[0].mesh.visible).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Rewrite `setKeyframes()` for per-shard layout**

Compute per-shard target positions/scales based on spectrum energy mapped to each shard's frequency band. No more per-cluster-per-band mapping.

- [ ] **Step 3: Update keyframe tween in `update()`**

Skip any shard where `this._shatter.isShattered(i)` is true.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/pyramid/pyramid-field.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pyramid/pyramid-field.js src/pyramid/pyramid-field.test.js
git commit -m "feat: adapt keyframe tweening to per-shard layout, skip shattered shards"
```

---

## Task 10: End-to-End Smoke Test & Cleanup

**Files:**
- All modified files

### Step-by-step

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all PASS. Fix any failures.

- [ ] **Step 2: Manual browser test**

```bash
npm start
```

Open http://localhost:3000. Verify:
- Shards appear scattered around the planet (not in clusters)
- Shards breathe in/out and rotate gently
- Play audio → beats trigger visible shatters
- Fragments recombine smoothly
- GUI controls work (count, shardDrift, sensitivity, maxSimultaneousShatter)
- No console errors

- [ ] **Step 3: Remove any dead code**

Check for leftover references to `BANDS`, `_clusters`, `basePositions`, `shardSpin` in all files. Remove them.

- [ ] **Step 4: Run tests one final time**

```bash
npx vitest run
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup dead code, verify full test suite passes"
```
