# Follow-up changes from Bloom dial explainer

Started: 2026-03-29  
Context: explainer-mode walkthrough of how the cockpit **Bloom** dial relates to `UnrealBloomPass`, the effect composer, and audio-driven parameters.

**Executable checklist:** The same items are tracked for implementation in [`sessions/current-session.md`](sessions/current-session.md) (session protocol: **`change: …`** → append there).

This note tracks **rationale and touchpoints** — not committed work until implemented.

---

## 1. Spectrum vs cockpit dial (behavior / UX)

**Finding:** On every audio spectrum callback, `applySpectrumToParams` sets `bloomPass.strength` and `bloomPass.threshold` from FFT bands (`midAvg * 3`, `highAvg`). The dial only edits **`strength`**. While audio is active, **user dial changes to strength are overwritten** on the next spectrum frame; **`threshold` is not on the dial** but is still driven by audio.

**Candidate changes:**

- [ ] **Decide intended behavior** and document it in UI (tooltip or short label): e.g. “Bloom strength is reactive while music plays” vs “Manual override.”
- [ ] **Option A — Additive / scaled:** `effective_strength = user_strength * f(mid)` or `user_strength + k * midAvg` so the dial remains meaningful during playback.
- [ ] **Option B — Modes:** Toggle “Manual bloom” vs “Audio-reactive bloom” (skip spectrum writes to `strength`/`threshold` in manual mode).
- [ ] **Option C — Threshold on HUD:** Expose `threshold` (and optionally `radius`) on cockpit dials for parity with lil-gui, or hide lil-gui bloom folder when using cockpit-only UX.

**Code touchpoints:** [`applySpectrumToParams`](../../src/scene/three-scene.js) (~903+), [`mountScreenDials` / Bloom row](../../src/ui/screen-dials.js), optional [`setupGUI` effects folder](../../src/scene/three-scene.js) (~234+).

---

## 2. Composer / bloom architecture (docs only unless you refactor)

**Finding:** `EffectComposer` → `RenderPass` → `UnrealBloomPass`; `composer.render()` each frame. Dial mutates the same `bloomPass` instance created in `setupPostProcessing`.

**Candidate changes:**

- [ ] **Comment block** above `setupPostProcessing` or `applySpectrumToParams` describing ownership: who may write `strength`/`threshold` and when.
- [ ] (Optional) **Extract** `spectrumDrivenBloom` into a named helper or small module if behavior grows (manual vs reactive).

---

## 3. Explainer / docs hygiene

**Finding:** Project rules now prefer **`vscode://file/`** markdown links for “open in editor” in explanations.

**Candidate changes:**

- [ ] When editing contributor docs, prefer the same link pattern for file references.
- [ ] No code change required for the app itself.

---

## 4. Testing ideas (if behavior changes)

- [ ] Unit test: `applySpectrumToParams` with mock `bloomPass` — already partially covered in [`three-scene.test.js`](../../src/scene/three-scene.test.js); extend if new modes (manual vs reactive) are added.
- [ ] Manual QA: with music playing, move Bloom dial — confirm expected strength behavior per chosen option in §1.

---

## Chunks covered in explainer (for traceability)

1. Dial → `bloomPass.strength` via canvas knob (`object`, `key`).
2. `UnrealBloomPass` on `EffectComposer`; `strength` scales added bloom.
3. *(Next in explainer series)* Spectrum callback overwrites `strength` / `threshold` — summarized above in §1.
