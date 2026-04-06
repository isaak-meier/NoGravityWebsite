# Session change list

Rolling checklist for the **active chunk session**. Lines are appended when you say **`change: …`** (see **Session change note** in `.cursor/rules/explainer-mode.mdc`).

At **session end**, run **`execute change note`** / **`implement the session list`** to implement unchecked items, then mark done or run **`session: reset`** to clear.

**Related:** Longer context for the Bloom explainer lives in [`../changes-from-bloom-dial-explainer.md`](../changes-from-bloom-dial-explainer.md).

---

## Changes — Bloom explainer (seed)

- [ ] Decide bloom UX: document whether strength is reactive while music plays vs manual override (tooltip / label).
- [ ] Option A: combine user dial with spectrum — e.g. `effective_strength = user_strength * f(mid)` or additive.
- [ ] Option B: toggle Manual bloom vs Audio-reactive (skip spectrum writes in manual mode).
- [ ] Option C: expose `threshold` (and optionally `radius`) on cockpit or hide duplicate lil-gui bloom controls.
- [ ] Comment ownership: who may write `bloomPass.strength` / `threshold` and when (`setupPostProcessing` / `applySpectrumToParams`).
- [ ] Optional refactor: extract spectrum-driven bloom helpers if modes grow.
- [ ] Contributor docs: prefer `vscode://file/` links for file references where applicable.
- [ ] Tests: extend `applySpectrumToParams` tests if new modes; manual QA bloom dial during playback.

---

## Appended (`change:`)

<!-- New items appear below this line -->

- [x] Bloom dial adjusts **baseline multiplier** (`bloomBaseline.multiplier`); `applySpectrumToParams` sets `strength = midAvg * 3 * multiplier` so the dial is not overwritten each frame.
