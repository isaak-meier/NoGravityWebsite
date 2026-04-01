/**
 * Pointer rotation (CSS `rotate`, 0 = to the right): min value → 45° left of up;
 * max value → 45° right of up (90° sweep through 12 o’clock).
 */
export const AN_MIN = (-Math.PI * 3) / 4;
export const AN_MAX = -Math.PI / 4;
export const AN_SPAN = AN_MAX - AN_MIN;
export const TWO_PI = Math.PI * 2;

export function unwrapAngleDelta(from, to) {
  let d = to - from;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

export function valueToKnobAngle(v, min, max) {
  const t = (Math.min(max, Math.max(min, v)) - min) / (max - min || 1);
  return AN_MIN + t * AN_SPAN;
}

/** Pixels of vertical drag (down = positive dy) to span the full [min, max] range. */
export const VERTICAL_DRAG_PIXELS_PER_RANGE = 200;

/**
 * Map vertical drag to a clamped stepped value: drag up (negative dy) increases value.
 * @param {number} startVal - value at drag start
 * @param {number} dy - clientY - startY (positive = moved down)
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {number} [pxPerRange=VERTICAL_DRAG_PIXELS_PER_RANGE]
 */
export function valueFromVerticalDragOffset(
  startVal,
  dy,
  min,
  max,
  step,
  pxPerRange = VERTICAL_DRAG_PIXELS_PER_RANGE,
) {
  const range = max - min;
  const raw = startVal + (-dy / pxPerRange) * range;
  const stepped = step > 0 ? Math.round(raw / step) * step : raw;
  return Math.min(max, Math.max(min, stepped));
}
