/**
 * Discrete-time exponential drag (“first-order lag”) toward a moving target.
 *
 * If each frame you set `current = lerp(current, target, exponentialDragBlend(dt, tau))`,
 * you approximate the continuous system ẋ = (target − x) / τ — a low-pass with time constant τ.
 *
 * @param {number} deltaTime - Step in seconds (> 0 for motion).
 * @param {number} tau - Time constant in seconds; smaller τ → snappier follow.
 * @returns {number} Blend factor in [0, 1] for linear/quaternion lerp toward the target.
 */
export function exponentialDragBlend(deltaTime, tau) {
  if (!Number.isFinite(deltaTime) || !Number.isFinite(tau)) return 0;
  if (tau <= 0) return 1;
  if (deltaTime <= 0) return 0;
  return 1 - Math.exp(-deltaTime / tau);
}

/** Default τ (seconds) for shatter attachment following the live pyramid mesh. */
export const DEFAULT_EXPONENTIAL_DRAG_TAU = 0.12;
