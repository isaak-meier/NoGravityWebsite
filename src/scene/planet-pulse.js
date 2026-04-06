/** Weight applied to low-band average when computing target radius (world units). */
export const LOW_BAND_RADIUS_WEIGHT = 0.65;

/** Per-frame blend toward target scale (higher = snappier). */
export const PLANET_SCALE_SMOOTH_FACTOR = 0.08;

/**
 * Smooths planet mesh scale toward a target driven by low-frequency energy.
 * Callers should apply `smoothedScale` to the sphere and set `planetParams.radius`
 * to `displayRadius` so the GUI matches the mesh (avoid lil-gui `setValue`, which
 * would re-apply scale via onChange and cancel smoothing).
 *
 * @param {number} lowAvg - average low-band magnitude (typically 0..1)
 * @param {number} baseRadius - authored mesh radius
 * @param {number} currentScale - sphere.scale.x
 * @param {number} [smoothFactor=PLANET_SCALE_SMOOTH_FACTOR]
 * @returns {{ targetRadius: number, smoothedScale: number, displayRadius: number }}
 */
export function computeSmoothedPlanetScale(
  lowAvg,
  baseRadius,
  currentScale,
  smoothFactor = PLANET_SCALE_SMOOTH_FACTOR,
) {
  const targetRadius = baseRadius + lowAvg * LOW_BAND_RADIUS_WEIGHT;
  const targetScale = targetRadius / baseRadius;
  const smoothedScale = currentScale + (targetScale - currentScale) * smoothFactor;
  const displayRadius = smoothedScale * baseRadius;
  return { targetRadius, smoothedScale, displayRadius };
}
