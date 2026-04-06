# Hold pattern phase (skip return-to-shard)

## Goal

When a shatter wave uses the **field-wide pattern phase** (burst → pattern → return), optionally **freeze the animation at the end of the pattern segment** so fragments **do not** lerp back to their shard rest pose. The hold lasts until the **next full shatter wave** replaces the shard state.

Applies to **all** pattern modes that use the coordinator path (`usePattern`): sphere shell, rings, and galaxy swirls — not only rings.

## Background

- [`ShardShatter`](../../../src/pyramid/shard-shatter.js) advances each active shard’s normalized time `t ∈ [0, 1]` over one cycle (`barDuration * SHATTER_CYCLE_BARS` from [`PyramidField.update`](../../../src/pyramid/pyramid-field.js)).
- With a finalized [`FragmentPatternCoordinator`](../../../src/pyramid/fragment-pattern-coordinator.js), fragment positions follow: burst → lerp to pattern target (`t < T_PATTERN_END`) → lerp to rest (`t ≥ T_PATTERN_END`). Constants: `T_BURST_END`, `T_PATTERN_END` in `shard-shatter.js`.
- At `t === T_PATTERN_END`, the return lerp has `uR = 0`, so the fragment is already at the **pattern** target; holding is implemented by **capping `t` at `T_PATTERN_END`** so `t` never enters the return segment.

## Behavior

| Item | Specification |
|------|----------------|
| **Config** | `holdPatternPhase: boolean`, default **`false`** (preserves current behavior). |
| **When it applies** | Only when the shard uses the pattern path: `patternCoordinator` is finalized and `totalFragmentCount > 0` (same condition as existing `usePattern` in `_applyTransforms`). |
| **Time integration** | After `state.t += deltaTime / barDuration`, if `holdPatternPhase` and `usePattern` for that state, set `state.t = Math.min(state.t, T_PATTERN_END)`. |
| **Completion** | Do **not** treat capped `t` as “completed”; `t >= 1` is the only completion condition. While held, the shard stays mid-shatter (fragments visible, parent shard hidden) until the next wave. |
| **Exit** | [`_triggerShatter`](../../../src/pyramid/pyramid-field.js) calls [`triggerShatter`](../../../src/pyramid/shard-shatter.js) per shard, which replaces state and reclaims slots — no separate “release” control for v1. |
| **`getReturnProgress`** | While `t ≤ t0` (`t0 === T_PATTERN_END` when `usePattern`), return progress stays **0**; no change to formula beyond natural consequence of capped `t`. |

## UI

- Add a **boolean** control in the **Shatter pattern** folder in [`PyramidField.setupGUI`](../../../src/pyramid/pyramid-field.js) (e.g. “Hold pattern (no return)”).
- **Optional follow-up:** mirror the same flag in [`screen-dials.js`](../../../src/ui/screen-dials.js) for HUD/mobile parity — **out of scope** for the minimal implementation unless requested.

## Testing

- Extend [`shard-shatter.test.js`](../../../src/pyramid/shard-shatter.test.js): with pattern coordinator finalized, `holdPatternPhase` true, advance `update` enough that unheld `t` would exceed `T_PATTERN_END`; assert fragment positions stay at pattern target (reuse `PATTERN_RING` or similar existing pattern test setup).

## Non-goals (v1)

- Manual “release” without a new shatter wave.
- Changing `barDuration` or cycle length to simulate hold.
- Auto-hold only for `PATTERN_RING` — product choice was **any pattern mode** using the pattern phase.

## References

- [2026-03-22-fragment-pattern-phase-design.md](./2026-03-22-fragment-pattern-phase-design.md) — pattern phase semantics.
- [2026-03-22-pyramid-shatter-design.md](./2026-03-22-pyramid-shatter-design.md) — shatter/recombine overview.
