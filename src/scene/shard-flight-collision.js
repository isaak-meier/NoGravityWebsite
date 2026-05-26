/**
 * @param {import('three').Vector3} a
 * @param {number} rA
 * @param {import('three').Vector3} b
 * @param {number} rB
 * @returns {boolean}
 */
export function spheresOverlap(a, rA, b, rB) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  const s = rA + rB;
  return dx * dx + dy * dy + dz * dz < s * s;
}
