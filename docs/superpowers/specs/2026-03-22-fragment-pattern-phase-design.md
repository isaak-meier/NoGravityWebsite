# Fragment pattern phase (Saturn ring & galaxy swirl)

## Overview

Extend the shatter animation with a **middle phase** between the initial burst and the existing return-to-shard motion. During this phase, **all fragments from the current wave** participate in **one field-wide structure** in world space: either a **Saturn-like ring** built from shards, or a **galaxy-like swirl**. Pattern kind alternates wave-by-wave (e.g. ring → swirl → ring → …).

This document builds on [2026-03-22-pyramid-shatter-design.md](./2026-03-22-pyramid-shatter-design.md) and assumes **Approach 1**: a **unified pattern coordinator** supplies target positions (and optional orientation hints) in **world space**; `ShardShatter` continues to own instancing and matrices but **defers** fragment positions during the pattern segment to that coordinator.

**Non-goals for v1:** audio-driven pattern morphing, per-shard independent patterns, or replacing instancing with a single merged mesh.

---

## Visual targets

### Saturn ring (horizontal, multi-band)

- **Read as:** a **thin disk of debris** around the planet—**not** a single wire-circle of points.
- **Layout:** **multiple concentric annuli** (inspired by A/B/C ring structure): several bands at different radii, with **gaps** or **lower density** between bands so the eye reads separate rings.
- **Plane:** **Horizontal** in world space: ring center at the planet origin (or configurable offset), **normal ≈ world up** (Y), same “equator” framing as prior decisions.
- **Shard feel:** fragments sit **on** or **near** each annulus with small **azimuthal jitter** and slight **radial spread** so it reads as **chunky particles** in a belt, not a perfect line.
- **Optional polish (later):** mild **vertical thickness** (few % of radius) so the disk has a hint of volume when viewed obliquely.

### Galaxy swirl (face-on spiral)

- **Read as:** a **spiral galaxy** in the **same horizontal disk** as the ring (consistent “orbital plane” around the planet).
- **Layout:** **two (or four) logarithmic spiral arms** emanating from a small **central bulge** region (few fragments with smaller radius), **arm** fragments following **r ∝ e^(k·θ)** (or similar) with **inter-arm** spacing and **jitter** so it does not look like a single curve.
- **Density:** more fragments toward the center in the bulge, **thinning** along the arms toward larger radius (optional exponential falloff) so it reads as **galactic** rather than uniform.
- **Shard feel:** same as ring—**deterministic slot + jitter** per fragment index so motion stays stable frame-to-frame.

---

## Architecture (Approach 1, logic isolated + tested)

### Module split

| Piece | Responsibility | Testability |
|--------|----------------|-------------|
| **`fragment-pattern-math.js`** (name TBD) | **Pure functions only:** given `(patternId, fragmentIndex, fragmentCount, params, u)` output **world-space** target position (and optional **facing** data). No Three.js scene graph, no pools. Uses plain numbers or tiny vector types as needed. | **Unit tests** cover ring bands, spiral arms, edge cases (N=1, large N), and invariants (points lie in horizontal plane within epsilon unless thickness enabled). |
| **`FragmentPatternCoordinator`** (class or namespace in same file or `fragment-pattern-coordinator.js`) | Holds **wave index** → `patternId`, **global params** (radii, arm count, jitter seed), and **`assignFragmentSlot(shardIndex, localIndex, waveId)`** so every active fragment has a **stable global index** for the wave. Exposes `getWorldTargetForSlot(globalIndex, u)` delegating to math. | Tests with **mock** shard lists; verify **no duplicate slots**, **full coverage** of `[0, N)`. |
| **`PyramidField`** | On each shatter **wave**, increments wave index, registers participating shards / fragment counts with the coordinator, passes coordinator (or callbacks) into `ShardShatter` update path. | Integration / scene tests optional after unit coverage. |
| **`ShardShatter`** | For `t` in the **pattern** sub-range, **does not** use legacy `computeFragmentPosition` return segment; instead queries coordinator for **lerp source** (end of burst pose) and **pattern target** at normalized **u ∈ [0,1]** inside the pattern phase, then blends; **return phase** unchanged from current behavior relative to new peak end. | Existing tests updated; new tests for **phase boundaries**. |

**Rule:** All **geometric** choices for “Saturn” vs “galaxy” live in **`fragment-pattern-math`**; the coordinator only **indexes** and **stores** wave-level settings.

### Data flow (one frame)

1. `PyramidField` has determined **patternId** for this wave and ensured **coordinator** knows **N** = total fragments and each fragment’s **global slot**.
2. For each active shard state, `ShardShatter` maps local fragment `i` → **global slot** `g`.
3. For current `t`, map to segment: **burst** | **pattern** | **return**.
4. In **pattern**, compute `uPattern = (t - tPatternStart) / (tPatternEnd - tPatternStart)` and ask math for **P(g, uPattern)** in world space; **slerp/lerp** from burst end pose to **P** (and optional orientation) over the pattern segment; hand off at `tPatternEnd` to existing return logic from **pattern end pose** (or from canonical rest—see **Open decision** below).

---

## Timeline (normalized `t ∈ [0,1]` per shard)

Replace the current implicit **two-segment** timeline (burst+drift `[0,0.5]`, return `(0.5,1]`) with **three** segments:

| Segment | Range (example defaults) | Behavior |
|---------|---------------------------|----------|
| **Burst** | `[0, tBurstEnd)` | Current burst + early drift (existing or lightly adjusted). |
| **Pattern** | `[tPatternStart, tPatternEnd)` | Field-wide Saturn or galaxy targets from coordinator. |
| **Return** | `[tReturnStart, 1]` | Existing recombination toward shard rest pose. |

**Defaults (tunable in config):** e.g. `tBurstEnd = 0.15`, `tPatternStart = 0.15`, `tPatternEnd = 0.50`, `tReturnStart = 0.50`—so **burst ~15%**, **pattern ~35%**, **return ~50%** of the bar. Exact numbers are **not** fixed until implementation tuning; the spec only requires **three explicit breakpoints** and **no overlap**.

**Synchronization:** All shards in a wave share the same **`t`** advance (same `barDuration`); **patternId** is fixed for the wave. v1 assumes **simultaneous** triggers per wave so **N** and slots are stable for the whole pattern phase.

---

## Indexing: global fragment slot

- **Stable ordering:** `globalIndex = baseOffset[shardIndex] + localIndex`, where `baseOffset` is computed from **shard sort order** (e.g. ascending shard index) and each shard’s **fragment count** for this shatter (depends on depth).
- **Wave-level N:** `N = sum of fragment counts` for all shards in the wave.
- Coordinator assigns **one** `(patternId, params)` for the wave and uses **globalIndex ∈ [0, N)`** for all math.

---

## Ring pattern (math sketch)

- **Center** `C` = planet world position; **plane** spanned by **X** and **Z**; **Y** up.
- **Bands:** radii `R₁, R₂, …, Rₖ` with optional **gaps** `[gap_j]` between annuli. Each band has a **target count** proportional to **circumference** × **density** (or equal split of N across bands with remainder handling).
- For fragment with index `g`, map to **band b** and **slot within band** via deterministic splitting (e.g. cumulative counts per band).
- **Azimuth** `θ = 2π * (s + φ(g)) / S_b` where `S_b` is slots in band, `φ` is seeded jitter in `[−η, η]`.
- **Radius** `r = R_b + ε(g)` with small radial jitter.
- **Position** `(C_x + r cos θ, C_y + h_thickness(g), C_z + r sin θ)` with optional small `h_thickness` for volume.

**Tests:** all points satisfy `|y - C_y| ≤ ε_flat`; radial bins match band assignments; jitter bounded.

---

## Galaxy pattern (math sketch)

- **Same plane** as ring (horizontal disk around planet).
- **Bulge:** first `N_bulge` indices (or fraction of N) placed in a small disk `r ≤ r_bulge` with optional **2D Gaussian** radial sampling (deterministic from `g`).
- **Arms:** remaining indices along **two** logarithmic spirals: `r = r₀ * exp(k * (θ - θ₀_{arm}))`, with `θ` stepped by arm length, **two arms** separated by **π** (or four arms if needed later).
- **Jitter:** tangential and radial noise per fragment so arms read as **shard clouds**, not a line.
- **Tests:** monotonic radius along arm for increasing slot order (within jitter bounds); arm separation ~π for the two main arms.

---

## Orientation (optional v1)

- **Minimum:** reuse existing **tumble / face quat** blend; pattern phase may **slerp** toward **tangent** of ring (velocity along annulus) or **radial** for galaxy arms for extra readability—**optional** if timeboxed.
- Spec allows **position-only** v1 if orientation changes risk visual glitches.

---

## Open decisions (resolve during implementation)

1. **Return phase start pose:** Lerp from **pattern exit pose** vs **fixed rest**—default to **pattern exit** for continuity.
2. **Peak time:** Whether “peak” for tumble alignment moves from `t=0.5` to **`tPatternEnd`** so return phase matches current `getReturnProgress` semantics—**yes** recommended for consistency.
3. **GUI:** Expose pattern phase fraction and ring/galaxy scale sliders under a small “Shatter pattern” folder.

---

## Testing strategy

- **`fragment-pattern-math.test.js`:** property and snapshot-style checks for Saturn (multi-band, in-plane) and galaxy (two arms, bulge region).
- **`fragment-pattern-coordinator.test.js`:** slot assignment across multiple fake shards; wave index → pattern alternation.
- **`shard-shatter.test.js` (updates):** mock coordinator injects known positions; assert matrix positions at `t` just before/after segment boundaries.

---

## File layout (planned)

- `src/pyramid/fragment-pattern-math.js` — pure geometry.
- `src/pyramid/fragment-pattern-math.test.js`
- `src/pyramid/fragment-pattern-coordinator.js` — wave/slot state (minimal Three.js: may use `Vector3` for output compatibility).
- `src/pyramid/fragment-pattern-coordinator.test.js`
- Wire: `pyramid-field.js`, `shard-shatter.js` (narrow edits).

---

## Approval

This spec is ready for **implementation planning** after product sign-off on: **three-phase timeline**, **Saturn multi-band + galaxy spiral** aesthetics, and **strict separation** of math vs coordinator vs shatter integration.
