# Pyramid Field Shatter Redesign

## Overview

Redesign the PyramidField to scatter individual shards freely around the planet in a mathematically pleasing Fibonacci sphere distribution, and add a beat-reactive shatter mechanic where shards fracture into sub-fragments on loud beats and recombine over one musical bar.

## 1. Shard Layout

Replace the current cluster-based system (groups of cones arranged in 8 bands per anchor point) with individual shards distributed directly on a Fibonacci sphere.

- **Distribution**: golden-angle algorithm places each shard on the sphere surface, oriented outward from the planet center via `Quaternion.setFromUnitVectors`.
- **Count**: configurable (default ~60). Current system produces ~180 total meshes across 12 clusters; the new layout uses fewer but more prominent individual cones.
- **Size variation**: each shard's size varies ±30% from the base `size` config value (randomized at build time) to break visual uniformity.
- **No band system**: each shard is one cone, one mesh. The `BANDS` constant and per-band geometry arrays are removed.
- **Group rotation**: the whole field still rotates slowly (`rotationSpeed` config).
- **Shard drift**: each shard rotates gently on its local Y axis — much slower than the current `shardSpin` speed. Subtle drift rather than active spinning.
- **Orbit breathing**: the sphere radius oscillates between `_orbitMin` and `_orbitMax` via a sine wave (unchanged). The intro-lerp-from-far-away animation also stays.

## 2. Beat Detection & BPM

A new `BeatDetector` module in `src/audio/beat-detector.js` using the `realtime-bpm-analyzer` npm package.

- **BPM detection**: `realtime-bpm-analyzer` wired into the existing Web Audio API pipeline (connects to the `AnalyserNode` already in place for FFT). Provides real-time BPM candidates.
- **Beat onset detection**: lightweight energy-threshold check (~10 lines) on low-frequency FFT bins (~60–200 Hz). Compares current frame's low-end energy to a running average. When the energy exceeds the average by a configurable threshold, a beat is detected.
- **Beat intensity**: normalized 0–1 value based on how far the onset exceeded the threshold. Drives fracture depth.
- **Bar duration**: derived as `(60 / BPM) * 4` seconds (assumes 4/4 time).
- **API**: exposes `{ isBeat: boolean, intensity: number, barDuration: number }` polled each frame.
- **GUI**: sensitivity threshold slider for tuning what counts as a beat.
- **Location**: `src/audio/beat-detector.js`, alongside existing `src/audio/audio-fft.js`.

## 3. Fracture Mechanic

Runtime geometry subdivision managed by a new `ShardShatter` engine in `src/pyramid/shard-shatter.js`.

### Subdivision

When a beat triggers a shatter, the shard's cone geometry is subdivided by splitting each triangle face along edge midpoints into smaller triangles, then separating them into individual fragments.

- **Depth scales with intensity**:
  - Intensity 0–0.33 → 1 pass (~6 fragments per shard)
  - Intensity 0.33–0.66 → 2 passes (~18 fragments)
  - Intensity 0.66–1.0 → 3 passes (~40 fragments)
- Each fragment gets a randomized outward velocity plus slight tumble rotation.

### Performance

- **Simultaneous shatter cap**: max ~15 shards mid-shatter at once (randomly selected from beat-affected shards). Worst case: 15 × 40 = 600 fragment instances.
- **InstancedMesh batching**: all active fragments share a single `InstancedMesh` per subdivision depth level. 3 draw calls instead of hundreds. Instance transforms updated each frame via the instance matrix buffer.
- **Object pool**: fragment instance slots pre-allocated at build time (sized for max simultaneous shatter cap). Slots claimed on beat, returned on recombination. Zero runtime allocation.

### API

- `triggerShatter(shardIndex, intensity)` — initiate a shatter on a specific shard.
- `update(deltaTime, barDuration)` — advance all active shatter/recombination animations.
- `isShattered(shardIndex)` — query whether a shard is currently mid-shatter.

## 4. Recombination Animation

Fragments recombine over exactly one musical bar (derived from detected BPM).

### Timeline

Each shattered shard tracks `t` from 0 to 1 where `t = elapsed / barDuration`.

- **Outward phase** (t = 0–0.15): fragments fly outward with initial random velocity + tumble. Velocity decays quickly.
- **Drift phase** (t = 0.15–0.5): fragments float loosely, slowing, slight continued tumble.
- **Return phase** (t = 0.5–1.0): fragments lerp back toward origin positions with ease-in curve. Tumble dampens. Converge to reform the cone shape.
- **t = 1.0**: fragments hidden, original shard mesh reappears.

### Easing

Ease-in on the return path — fragments linger outward for the first half, then accelerate back. Creates a "magnetic snap" feel as they reform.

### Re-shatter

If a new beat lands while a shard is mid-recombination:
- Fragments shatter again from their current positions (no snap-home).
- `t` timer resets; current positions become new shatter origin.
- Fresh outward velocities added.
- If not already at max depth and new intensity warrants it, existing fragments subdivide further.

## 5. Spectrum Reactivity & Keyframes (Adapted)

### Spectrum Reactivity

- Each shard is assigned a frequency band based on its Fibonacci index (low index → low frequency, high index → high frequency).
- Energy in the assigned band drives a gentle scale pulse and slight positional push outward from planet center.
- Much subtler than the current behavior — the shatter mechanic handles dramatic moments.

### Keyframe Tweening

- Conceptually unchanged but simplified: each keyframe stores per-shard target positions/scales (not per-cluster-per-band).
- Tween interpolates shard positions between keyframes with smooth ease.
- During active shatter, the tween target is ignored for that shard until recombination completes, then it lerps to the current keyframe position.

### Interaction with Shatter

- Both spectrum reactivity and keyframe tweening pause for any shard that is mid-shatter.
- Once recombined, the shard resumes from its current position. No hard snaps.

## 6. Module Structure

### `src/pyramid/pyramid-field.js` (modified)

Main orchestrator. Owns the shard array, Fibonacci layout, orbit breathing, slow rotation, and update loop. Delegates fracture/recombination to `ShardShatter` and receives beat info from `BeatDetector`. Maintains the same external API (`applySpectrum`, `setKeyframes`, `update`, `setupGUI`, `dispose`) so `three-scene.js` needs minimal changes.

### `src/pyramid/shard-shatter.js` (new)

Fracture and recombination engine. Handles geometry subdivision, InstancedMesh pool, per-shard shatter state (t timer, phase, velocity, depth), and return animation.

### `src/audio/beat-detector.js` (new)

Thin wrapper around `realtime-bpm-analyzer` plus onset energy check. Takes an `AnalyserNode`, exposes `{ isBeat, intensity, barDuration }`. Owns the sensitivity threshold. Instantiated in `three-scene.js` (where audio nodes live) and passed into `PyramidField`.

## 7. Config Changes

Existing config properties that stay:
- `count` (now means individual shard count, default ~60)
- `orbitRadius`, `rotationSpeed`, `orbitPulseSpeed`
- `tweenSpeed`

Modified:
- `shardSpin` → renamed to `shardDrift`, default much lower (~0.05 vs current 0.25)
- `size` stays but now applies per-shard with ±30% random variation

New:
- `maxSimultaneousShatter` (default 15)
- `beatSensitivity` (default 1.0, GUI-tunable)

Removed:
- `BANDS` constant
- Per-band geometry arrays
- Cluster-based data structures (`_clusters`, `basePositions`, band assignments)
