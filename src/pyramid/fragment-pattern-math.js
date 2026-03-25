/**
 * Pure world-space layout for field-wide shatter patterns (pyramid local space; Y up).
 * @module
 */

/** Field-wide pattern modes (match PyramidField `patternMode`). */
export const PATTERN_SPHERE = 0;
export const PATTERN_RING = 1;
export const PATTERN_GALAXY = 2;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** @param {number} n
 * @param {number} seed */
export function hash01(n, seed) {
  const x = Math.sin(n * 12.9898 + seed * 78.233 + n * 0.001) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * @param {number[]} weights
 * @param {number} n count to distribute
 * @returns {number[]} integer counts per bucket, sum === n
 */
export function splitCountsByWeight(weights, n) {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0 || n <= 0) return weights.map(() => 0);
  const raw = weights.map(w => (n * w) / wsum);
  const floors = raw.map(x => Math.floor(x));
  let rem = n - floors.reduce((a, b) => a + b, 0);
  const frac = raw.map((x, i) => ({ i, f: x - floors[i] }));
  frac.sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem; k++) floors[frac[k % frac.length].i]++;
  return floors;
}

/**
 * @param {import('three').Vector3} out
 * @param {number} patternId PATTERN_SPHERE | PATTERN_RING | PATTERN_GALAXY
 * @param {number} globalIndex
 * @param {number} fragmentCount
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} seed
 * @param {object} [params]
 */
export function getPatternWorldPosition(
  out,
  patternId,
  globalIndex,
  fragmentCount,
  cx,
  cy,
  cz,
  seed,
  params = {},
) {
  if (fragmentCount <= 0) {
    out.set(cx, cy, cz);
    return out;
  }
  const g = ((globalIndex % fragmentCount) + fragmentCount) % fragmentCount;
  if (patternId === PATTERN_SPHERE) {
    return spherePosition(out, g, fragmentCount, cx, cy, cz, seed, params);
  }
  if (patternId === PATTERN_RING) {
    return ringPosition(out, g, fragmentCount, cx, cy, cz, seed, params);
  }
  return galaxyPosition(out, g, fragmentCount, cx, cy, cz, seed, params);
}

/**
 * Fibonacci sphere shell (same construction as the pyramid shard field).
 * @param {import('three').Vector3} out
 */
function spherePosition(out, g, n, cx, cy, cz, seed, params) {
  const orbit = params.orbitRadius ?? 1.46;
  const scale = params.spherePatternScale ?? 1;
  const R = orbit * scale;
  if (n <= 1) {
    out.set(cx + R, cy, cz);
    return out;
  }
  const y = 1 - (g / (n - 1)) * 2;
  const rY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * g;
  const jx = (hash01(g, seed + 2) - 0.5) * 0.06 * orbit;
  const jy = (hash01(g, seed + 4) - 0.5) * 0.06 * orbit;
  const jz = (hash01(g, seed + 6) - 0.5) * 0.06 * orbit;
  out.set(
    cx + rY * Math.cos(theta) * R + jx,
    cy + y * R + jy,
    cz + rY * Math.sin(theta) * R + jz,
  );
  return out;
}

/**
 * @param {import('three').Vector3} out
 * @param {number} g
 * @param {number} n
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} seed
 * @param {object} params
 */
function ringPosition(out, g, n, cx, cy, cz, seed, params) {
  const orbit = params.orbitRadius ?? 1.46;
  const ringScale = params.ringRadiusScale ?? 1;
  /** Relative radii — gaps between bands read as Saturn-like divisions */
  const bands = params.ringBands ?? [0.72, 0.88, 1.05, 1.22, 1.38];
  const R = bands.map(b => orbit * b * ringScale);
  const jAzK = params.ringAzimuthJitter ?? 0.14;
  const jRadK = params.ringRadialJitter ?? 0.045;
  const jYK = params.ringVerticalJitter ?? 0.04;
  const weights = R.map(r => Math.max(0.05, r * 2 * Math.PI));
  const counts = splitCountsByWeight(weights, n);
  let cum = 0;
  let band = 0;
  for (let b = 0; b < counts.length; b++) {
    if (counts[b] <= 0) continue;
    if (g < cum + counts[b]) {
      band = b;
      break;
    }
    cum += counts[b];
  }
  cum = 0;
  for (let b = 0; b < band; b++) cum += counts[b];
  const slot = g - cum;
  const sb = Math.max(1, counts[band]);
  const jAz = (hash01(g, seed + 11) - 0.5) * jAzK;
  const jRad = (hash01(g, seed + 17) - 0.5) * jRadK * orbit;
  const jY = (hash01(g, seed + 23) - 0.5) * jYK * orbit;
  const theta = (2 * Math.PI * (slot + 0.5 + jAz)) / sb;
  const r = R[band] + jRad;
  out.set(
    cx + r * Math.cos(theta),
    cy + jY,
    cz + r * Math.sin(theta),
  );
  return out;
}

/**
 * @param {import('three').Vector3} out
 * @param {number} g
 * @param {number} n
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} seed
 * @param {object} params
 */
function galaxyPosition(out, g, n, cx, cy, cz, seed, params) {
  const orbit = params.orbitRadius ?? 1.46;
  const bulgeFrac = params.galaxyBulgeFrac ?? 0.12;
  const nBulge = Math.min(n, Math.max(n >= 1 ? 1 : 0, Math.floor(n * bulgeFrac)));
  const nBulgeClamped = Math.min(nBulge, n);
  const rBulge = orbit * (params.galaxyBulgeRadius ?? 0.22);
  const rMin = orbit * (params.galaxyArmInner ?? 0.28);
  const rMax = orbit * (params.galaxyArmOuter ?? 1.15);
  const bSpiral = params.galaxySpiralTightness ?? 0.11;
  const sweepTurns = params.galaxyArmSweepTurns ?? 5.2;

  if (g < nBulgeClamped) {
    const u = hash01(g, seed + 41);
    const v = hash01(g, seed + 43);
    const r = rBulge * Math.sqrt(u) * (0.85 + 0.3 * hash01(g, seed + 47));
    const theta = 2 * Math.PI * v + hash01(g, seed + 53) * 0.4;
    const jY = (hash01(g, seed + 59) - 0.5) * 0.035 * orbit;
    out.set(
      cx + r * Math.cos(theta),
      cy + jY,
      cz + r * Math.sin(theta),
    );
    return out;
  }

  const idx = g - nBulgeClamped;
  const nArm = n - nBulgeClamped;
  const half = Math.ceil(nArm / 2);
  const arm1 = idx < half;
  const localIdx = arm1 ? idx : idx - half;
  const nOn = arm1 ? half : nArm - half;
  const t = nOn <= 1 ? 0.5 : localIdx / (nOn - 1);
  const theta0 = arm1 ? 0 : Math.PI;
  const sweep = t * sweepTurns * Math.PI;
  const theta = theta0 + sweep + (hash01(g, seed + 61) - 0.5) * 0.35;
  const r = rMin * Math.exp(bSpiral * sweep) * (0.92 + 0.16 * hash01(g, seed + 67));
  const rClamped = Math.min(rMax, Math.max(rMin * 0.5, r));
  const jR = (hash01(g, seed + 71) - 0.5) * 0.06 * orbit;
  const jT = (hash01(g, seed + 73) - 0.5) * 0.12;
  const jY = (hash01(g, seed + 79) - 0.5) * 0.045 * orbit;
  const rr = rClamped + jR;
  const tt = theta + jT;
  out.set(
    cx + rr * Math.cos(tt),
    cy + jY,
    cz + rr * Math.sin(tt),
  );
  return out;
}
