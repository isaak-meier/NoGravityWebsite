import * as THREE from "three";
import { attachPlanetInteriorGoop } from "./planet-goop-material.js";
import { createGraphLaserLineMaterial } from "./graph-laser-line-material.js";
import { PlanetHalvesEffect, RED_PLANET_INDEX } from "./planet-shatter.js";
import {
  PLANET_GROWTH_PALETTE,
  PLANET_GROWTH_PALETTE_SIZE,
} from "../ui/green-planet-fade-handles.js";

const PLANET_GROWTH_VERTEX_COMMON_INSERT = `#include <common>
varying vec3 vGreenWorldNormal;`;

const PLANET_GROWTH_VERTEX_NORMAL_INSERT = `#include <beginnormal_vertex>
vGreenWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`;

const PLANET_GROWTH_FRAG_COMMON_INSERT = `#include <common>
const int PLANET_GROWTH_PALETTE_SIZE = ${PLANET_GROWTH_PALETTE_SIZE};
uniform vec3 uColors[PLANET_GROWTH_PALETTE_SIZE];
uniform vec3 uAxes[PLANET_GROWTH_PALETTE_SIZE];
uniform float uSoftness;
varying vec3 vGreenWorldNormal;`;

const PLANET_GROWTH_FRAG_COLOR_INSERT = `#include <color_fragment>
vec3 pgNormal = normalize(vGreenWorldNormal);
vec3 pgColorSum = vec3(0.0);
float pgWeightSum = 0.0;
for (int pgi = 0; pgi < PLANET_GROWTH_PALETTE_SIZE; pgi++) {
  vec3 pgAxis = uAxes[pgi];
  float pgAxisLen = length(pgAxis);
  if (pgAxisLen < 1e-4) continue;
  float pgAlign = clamp(dot(pgNormal, pgAxis / pgAxisLen) * 0.5 + 0.5, 0.0, 1.0);
  float pgW = pow(pgAlign, uSoftness);
  pgColorSum += uColors[pgi] * pgW;
  pgWeightSum += pgW;
}
if (pgWeightSum > 1e-4) diffuseColor.rgb = pgColorSum / pgWeightSum;`;

/** World-space radius of the sun mesh (visual anchor at +X; larger reads stronger in bloom). */
const SUN_WORLD_RADIUS = 12;
/** Smooth sphere — not the comet-head mesh helper — so the traveling comet stays visually unique. */
const SUN_SPHERE_WIDTH_SEGMENTS = 40;
const SUN_SPHERE_HEIGHT_SEGMENTS = 28;
/** Warm highlight — slightly lifted toward white vs older cream for a brighter disk. */
const SUN_HEAD_COLOR = 0xfff9ec;

/**
 * Per-planet star cluster shape: identical to the original global starfield in {@link SolarSystem._createStars}
 * (radius 200–800, 3000 desktop / 1200 mobile, white size-0.6 points). Each planet gets its own copy
 * translated to its `def.position`, so every cluster matches every other.
 */
const PLANET_CLUSTER_OUTER_RADIUS = 800;
const PLANET_CLUSTER_INNER_RADIUS = 200;
const PLANET_CLUSTER_COUNT_DESKTOP = 3000;
const PLANET_CLUSTER_COUNT_MOBILE = 1200;

/** Extra points scattered outside cluster shells to fill voids between planet clusters (graph view). */
const INTERSTITIAL_STAR_COUNT_DESKTOP = 4500;
const INTERSTITIAL_STAR_COUNT_MOBILE = 1800;
/**
 * Minimum distance from any planet center for interstitial stars — slightly past the cluster outer
 * radius so these points sit in “deep space” between shells, not on top of existing cluster stars.
 */
const INTERSTITIAL_CLEARANCE = PLANET_CLUSTER_OUTER_RADIUS + 40;

/** Wind interstitial stars along a logarithmic spiral (multiple arms) in a plane fit to the constellation. */
const INTERSTITIAL_SPIRAL_ARMS = 3;
/** How many full turns the spiral parameter spans from inner to outer radius. */
const INTERSTITIAL_SPIRAL_TURNS = 4;
/** Perpendicular jitter (along spiral plane normal) — scaled so arms stay as thick as the old blue-cluster spirals read. */
const INTERSTITIAL_SPIRAL_JITTER_NORMAL = 275;
/** Small in-plane jitter so stars do not sit exactly on the analytic curve. */
const INTERSTITIAL_SPIRAL_JITTER_INPLANE = 175;

/** Number of nearest neighbors per planet used to build the constellation graph edges. */
const PLANET_GRAPH_K = 2;
/** Pick-proxy radius for graph-mode clicking (matches cluster outer radius for forgiving hits). */
const PLANET_PICK_PROXY_RADIUS = PLANET_CLUSTER_OUTER_RADIUS;

/**
 * Line segments per undirected graph edge: several beams share the source planet and fan slightly
 * toward the neighbor (laser-split look). Must be ≥ 1.
 */
const GRAPH_LASER_FAN_BEAMS = 5;
/**
 * Hub–hub edges where blue (index 0) is the lower endpoint: one true chord to the neighbor,
 * plus extra beams that skim past then continue into open space.
 */
const GRAPH_BLUE_HUB_BEAM_COUNT = 8;
/** Half of the fan sweep in radians (beams distributed in the plane ⊥ to the chord). */
const GRAPH_LASER_FAN_HALF_ANGLE = 0.16;
/** Target-end ring radius as a fraction of edge length (world units scale with spacing). */
const GRAPH_LASER_FAN_SPREAD_FRAC = 0.026;
/** Cap fan offset so beam tips stay near neighbor cores (planet radii are ~1 world unit). */
const GRAPH_LASER_FAN_MAX_ENDPOINT_OFFSET = 26;
/** Number of EQ bands that gate laser visibility (matches FFT grouping in {@link spectrumToGraphEqBands}). */
const GRAPH_EQ_BAR_COUNT = 8;

/** Loose star points hugging each graph laser beam (same k-NN edges as line geometry). */
const GRAPH_EDGE_STAR_COUNT_DESKTOP = 2800;
const GRAPH_EDGE_STAR_COUNT_MOBILE = 1000;
/** Max perpendicular offset from the beam as a fraction of edge length. */
const GRAPH_EDGE_STAR_CLOUD_FRAC = 0.068;
/** Max extra slack along the beam as a fraction of edge length. */
const GRAPH_EDGE_STAR_ALONG_FRAC = 0.042;

/**
 * Planet positions are hand-picked 3D points so the constellation is visible
 * from the planet-graph view (~15–20k camera distance). Blue stays at the origin
 * so the pyramid field, intro orbit, and inside-planet HUD keep working unchanged.
 */
const PLANET_DEFS = [
  { color: 0x60a5fa, radius: 0.9,  position: [    0,     0,     0], speed: 0.3,  label: "Blue"   },
  { color: 0xf87171, radius: 0.6,  position: [ 3500,   800, -1200], speed: 0.2,  label: "Red"    },
  { color: 0x4ade80, radius: 1.1,  position: [-2200,  1500,  4800], speed: 0.12, label: "Green"  },
  { color: 0xfbbf24, radius: 0.5,  position: [ 4200, -1800,  2000], speed: 0.08, label: "Gold"   },
  { color: 0xa78bfa, radius: 0.75, position: [-3800, -1200, -2500], speed: 0.05, label: "Violet" },
];

/**
 * Unit-length axes (right, up) spanning the plane perpendicular to chord direction (dx,dy,dz).
 * @returns {{ rx: number, ry: number, rz: number, ux: number, uy: number, uz: number }}
 */
function perpendicularPlaneBasis(dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  let wx = 0;
  let wy = 1;
  let wz = 0;
  let rx = wy * nz - wz * ny;
  let ry = wz * nx - wx * nz;
  let rz = wx * ny - wy * nx;
  let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl < 1e-8) {
    wx = 1;
    wy = 0;
    wz = 0;
    rx = wy * nz - wz * ny;
    ry = wz * nx - wx * nz;
    rz = wx * ny - wy * nx;
    rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  }
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ny * rz - nz * ry;
  const uy = nz * rx - nx * rz;
  const uz = nx * ry - ny * rx;
  return { rx, ry, rz, ux, uy, uz };
}

/**
 * For each planet, return the indices of its k nearest neighbors as a deduplicated set
 * of canonical "min-max" edge keys. Pure function — exported for tests.
 *
 * @param {Array<[number, number, number]>} positions
 * @param {number} k
 * @returns {Set<string>}
 */
function computeKnnEdges(positions, k) {
  const n = positions.length;
  const edges = new Set();
  if (n < 2 || k <= 0) return edges;
  for (let i = 0; i < n; i++) {
    const dists = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = positions[i][0] - positions[j][0];
      const dy = positions[i][1] - positions[j][1];
      const dz = positions[i][2] - positions[j][2];
      dists.push({ idx: j, d2: dx * dx + dy * dy + dz * dz });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    const take = Math.min(k, dists.length);
    for (let m = 0; m < take; m++) {
      const j = dists[m].idx;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      edges.add(`${a}-${b}`);
    }
  }
  return edges;
}

/**
 * Collapse a normalised FFT frame into {@link GRAPH_EQ_BAR_COUNT} contiguous band averages (0..1 each).
 * @param {ArrayLike<number>} spectrum
 * @returns {Float32Array}
 */
function spectrumToGraphEqBands(spectrum) {
  const n = spectrum.length;
  const out = new Float32Array(GRAPH_EQ_BAR_COUNT);
  for (let b = 0; b < GRAPH_EQ_BAR_COUNT; b++) {
    const i0 = Math.floor((b * n) / GRAPH_EQ_BAR_COUNT);
    const i1 = Math.floor(((b + 1) * n) / GRAPH_EQ_BAR_COUNT);
    let s = 0;
    const hi = Math.max(i0 + 1, i1);
    for (let i = i0; i < hi; i++) s += spectrum[i];
    out[b] = hi > i0 ? s / (hi - i0) : 0;
  }
  return out;
}

function maxRadiusFromPoint(origin, points) {
  const [ox, oy, oz] = origin;
  let maxR = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - ox;
    const dy = points[i][1] - oy;
    const dz = points[i][2] - oz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

function minDistSqToCenters(px, py, pz, centers) {
  let min = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const dx = px - centers[i][0];
    const dy = py - centers[i][1];
    const dz = pz - centers[i][2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < min) min = d2;
  }
  return min;
}

/**
 * Planet centers are `def.position * spacingScale`; recover scale for radius/cap scaling.
 */
function inferSpacingScaleFromCenters(centers) {
  for (let i = 0; i < centers.length; i++) {
    const [px, py, pz] = PLANET_DEFS[i].position;
    const cx = centers[i][0];
    const cy = centers[i][1];
    const cz = centers[i][2];
    if (Math.abs(px) > 1e-6 && Math.abs(cx) > 1e-6) return cx / px;
    if (Math.abs(py) > 1e-6 && Math.abs(cy) > 1e-6) return cy / py;
    if (Math.abs(pz) > 1e-6 && Math.abs(cz) > 1e-6) return cz / pz;
  }
  return 1;
}

/**
 * One graph laser beam segment for a **hub–hub** edge (lower index → neighbor fan). Leaf edges use
 * {@link graphLeafRaySegment}; stars use {@link resolveGraphBeamSegment}.
 * @param {number} beamIndex 0 .. {@link GRAPH_LASER_FAN_BEAMS} - 1
 * @param {number} [spacingScale]
 */
function graphBeamSegment(centers, i, j, beamIndex, spacingScale = 1) {
  const ax = centers[i][0];
  const ay = centers[i][1];
  const az = centers[i][2];
  const bx = centers[j][0];
  const by = centers[j][1];
  const bz = centers[j][2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const nx = dx / chordLen;
  const ny = dy / chordLen;
  const nz = dz / chordLen;
  const ri = PLANET_DEFS[i].radius * spacingScale;
  const rj = PLANET_DEFS[j].radius * spacingScale;
  const axSurf = ax + nx * ri;
  const aySurf = ay + ny * ri;
  const azSurf = az + nz * ri;
  const bxSurf = bx - nx * rj;
  const bySurf = by - ny * rj;
  const bzSurf = bz - nz * rj;
  const spreadR = Math.min(
    chordLen * GRAPH_LASER_FAN_SPREAD_FRAC,
    GRAPH_LASER_FAN_MAX_ENDPOINT_OFFSET * spacingScale,
  );
  const { rx, ry, rz, ux, uy, uz } = perpendicularPlaneBasis(dx, dy, dz);
  const beams = GRAPH_LASER_FAN_BEAMS;
  const u = beams <= 1 ? 0 : beamIndex / (beams - 1);
  const tf = u * 2 - 1;
  const ang = tf * GRAPH_LASER_FAN_HALF_ANGLE;
  const co = Math.cos(ang);
  const sn = Math.sin(ang);
  const ox = (rx * co + ux * sn) * spreadR;
  const oy = (ry * co + uy * sn) * spreadR;
  const oz = (rz * co + uz * sn) * spreadR;
  const ex = bxSurf + ox;
  const ey = bySurf + oy;
  const ez = bzSurf + oz;
  const edgeLen = Math.hypot(ex - axSurf, ey - aySurf, ez - azSurf) || 1;
  return {
    ax: axSurf,
    ay: aySurf,
    az: azSurf,
    ex,
    ey,
    ez,
    edgeLen,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
  };
}

/**
 * Hub–hub edge from blue (always canonical `i === 0`) toward planet `j`: beam 0 hits the neighbor
 * surface; beams 1..7 share the same blue-surface start and extend on near-miss rays into space.
 * @param {number} beamIndex 0 .. {@link GRAPH_BLUE_HUB_BEAM_COUNT} - 1
 */
function graphBlueHubFanBeam(centers, j, beamIndex, spacingScale = 1) {
  const i = 0;
  const ax = centers[i][0];
  const ay = centers[i][1];
  const az = centers[i][2];
  const bx = centers[j][0];
  const by = centers[j][1];
  const bz = centers[j][2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const nx = dx / chordLen;
  const ny = dy / chordLen;
  const nz = dz / chordLen;
  const ri = PLANET_DEFS[i].radius * spacingScale;
  const rj = PLANET_DEFS[j].radius * spacingScale;
  const axSurf = ax + nx * ri;
  const aySurf = ay + ny * ri;
  const azSurf = az + nz * ri;
  const bxSurf = bx - nx * rj;
  const bySurf = by - ny * rj;
  const bzSurf = bz - nz * rj;
  const basisChord = perpendicularPlaneBasis(dx, dy, dz);
  if (beamIndex === 0) {
    const ex = bxSurf;
    const ey = bySurf;
    const ez = bzSurf;
    const edgeLen = Math.hypot(ex - axSurf, ey - aySurf, ez - azSurf) || 1;
    return {
      ax: axSurf,
      ay: aySurf,
      az: azSurf,
      ex,
      ey,
      ez,
      edgeLen,
      rx: basisChord.rx,
      ry: basisChord.ry,
      rz: basisChord.rz,
      ux: basisChord.ux,
      uy: basisChord.uy,
      uz: basisChord.uz,
    };
  }
  const { rx, ry, rz, ux, uy, uz } = basisChord;
  const sx = bxSurf - axSurf;
  const sy = bySurf - aySurf;
  const sz = bzSurf - azSurf;
  const sLen = Math.hypot(sx, sy, sz) || 1;
  const uxSurf = sx / sLen;
  const uySurf = sy / sLen;
  const uzSurf = sz / sLen;
  const ang = ((beamIndex - 1) / 7) * Math.PI * 2 * 0.42 + beamIndex * 0.09;
  const co = Math.cos(ang);
  const sn = Math.sin(ang);
  const mix = 0.052 + (beamIndex % 4) * 0.014;
  const ox = (rx * co + ux * sn) * mix;
  const oy = (ry * co + uy * sn) * mix;
  const oz = (rz * co + uz * sn) * mix;
  let dlx = uxSurf + ox;
  let dly = uySurf + oy;
  let dlz = uzSurf + oz;
  const dlen = Math.hypot(dlx, dly, dlz) || 1;
  dlx /= dlen;
  dly /= dlen;
  dlz /= dlen;
  const rayMult = 1.72 + beamIndex * 0.085;
  const rayLen = chordLen * rayMult;
  const ex = axSurf + dlx * rayLen;
  const ey = aySurf + dly * rayLen;
  const ez = azSurf + dlz * rayLen;
  const rdx = ex - axSurf;
  const rdy = ey - aySurf;
  const rdz = ez - azSurf;
  const basisRay = perpendicularPlaneBasis(rdx, rdy, rdz);
  return {
    ax: axSurf,
    ay: aySurf,
    az: azSurf,
    ex,
    ey,
    ez,
    edgeLen: rayLen,
    rx: basisRay.rx,
    ry: basisRay.ry,
    rz: basisRay.rz,
    ux: basisRay.ux,
    uy: basisRay.uy,
    uz: basisRay.uz,
  };
}

/**
 * Ray from a leaf planet’s center in a pseudo-random direction (open end in space). Directions are
 * stable for a given (edgeIdx, beamIndex, leafIdx) so rebuilds stay consistent until spacing changes.
 * @param {Array<[number, number, number]>} centers
 * @param {number} leafIdx
 * @param {number} chordLen — length scale (typically graph edge length to the neighbor)
 * @param {number} edgeIdx
 * @param {number} beamIndex
 */
function graphLeafRaySegment(centers, leafIdx, chordLen, edgeIdx, beamIndex) {
  const ax = centers[leafIdx][0];
  const ay = centers[leafIdx][1];
  const az = centers[leafIdx][2];
  let h =
    ((edgeIdx + 1) * 73856093) ^
    ((beamIndex + 1) * 19349663) ^
    ((leafIdx + 1) * 83492791);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  const u = (((h >>> 0) & 0xfffffff) / 0x10000000) * 2 - 1;
  h = Math.imul(h + 374761393, 2654435761);
  const th = (((h >>> 0) & 0xfffffff) / 0x10000000) * (Math.PI * 2);
  const r = Math.sqrt(Math.max(1e-8, 1 - u * u));
  const ddx = r * Math.cos(th);
  const ddy = r * Math.sin(th);
  const ddz = u;
  h = Math.imul(h + 674761393, 1685539717);
  const lenF = 0.78 + (((h >>> 0) & 0xfffffff) / 0x10000000) * 0.38;
  const rayLen = chordLen * lenF;
  const rdx = ddx * rayLen;
  const rdy = ddy * rayLen;
  const rdz = ddz * rayLen;
  const ex = ax + rdx;
  const ey = ay + rdy;
  const ez = az + rdz;
  const { rx, ry, rz, ux, uy, uz } = perpendicularPlaneBasis(rdx, rdy, rdz);
  return {
    ax,
    ay,
    az,
    ex,
    ey,
    ez,
    edgeLen: rayLen,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
  };
}

/**
 * @param {string[]} edgeList — canonical "i-j" keys
 * @param {number} nPlanets
 * @returns {Int32Array}
 */
function computePlanetDegrees(edgeList, nPlanets) {
  const deg = new Int32Array(nPlanets);
  for (const key of edgeList) {
    const [a, b] = key.split("-").map(Number);
    deg[a]++;
    deg[b]++;
  }
  return deg;
}

/**
 * @param {string[]} edgeList
 * @param {Int32Array} deg
 * @param {number} beams
 * @returns {number}
 */
function countGraphLaserSegments(edgeList, deg, beams) {
  let n = 0;
  for (const key of edgeList) {
    const [i, j] = key.split("-").map(Number);
    const di = deg[i];
    const dj = deg[j];
    if (di > 1 && dj > 1) n += i === 0 ? GRAPH_BLUE_HUB_BEAM_COUNT : beams;
    else if (di === 1 && dj === 1) n += beams * 2;
    else n += beams;
  }
  return n;
}

/**
 * Total LineSegments vertex count (two vertices per segment) for graph lasers.
 * @param {Iterable<string>} edgeKeysIterable
 * @param {number} nPlanets
 * @param {number} beams
 * @returns {number}
 */
function countGraphLineVertices(edgeKeysIterable, nPlanets, beams) {
  const edgeList = [...edgeKeysIterable];
  const deg = computePlanetDegrees(edgeList, nPlanets);
  return countGraphLaserSegments(edgeList, deg, beams) * 2;
}

/**
 * Geometry for one beam (lines + edge stars): hub–hub fan, or random space rays from a leaf.
 */
function resolveGraphBeamSegment(centers, i, j, di, dj, edgeIdx, subBeamIndex) {
  const ax = centers[i][0];
  const ay = centers[i][1];
  const az = centers[i][2];
  const bx = centers[j][0];
  const by = centers[j][1];
  const bz = centers[j][2];
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const sInf = inferSpacingScaleFromCenters(centers);

  if (di > 1 && dj > 1) {
    if (i === 0) return graphBlueHubFanBeam(centers, j, subBeamIndex, sInf);
    return graphBeamSegment(centers, i, j, subBeamIndex, sInf);
  }
  if (di === 1 && dj > 1) {
    return graphLeafRaySegment(centers, i, chordLen, edgeIdx, subBeamIndex);
  }
  if (dj === 1 && di > 1) {
    return graphLeafRaySegment(centers, j, chordLen, edgeIdx, subBeamIndex);
  }
  if (subBeamIndex < GRAPH_LASER_FAN_BEAMS) {
    return graphLeafRaySegment(centers, i, chordLen, edgeIdx, subBeamIndex);
  }
  return graphLeafRaySegment(centers, j, chordLen, edgeIdx, subBeamIndex - GRAPH_LASER_FAN_BEAMS);
}

function graphBeamSegmentSubCount(di, dj, i, j) {
  if (di > 1 && dj > 1) return i === 0 ? GRAPH_BLUE_HUB_BEAM_COUNT : GRAPH_LASER_FAN_BEAMS;
  if (di === 1 && dj === 1) return GRAPH_LASER_FAN_BEAMS * 2;
  return GRAPH_LASER_FAN_BEAMS;
}

/**
 * @param {{ ptr: number, globalSeg: number }} state
 */
function pushHubHubGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, centers, i, j, beams, spacingScale) {
  const phase = Math.random() * Math.PI * 2;
  for (let b = 0; b < beams; b++) {
    const g = graphBeamSegment(centers, i, j, b, spacingScale);
    verts[state.ptr++] = g.ax;
    verts[state.ptr++] = g.ay;
    verts[state.ptr++] = g.az;
    verts[state.ptr++] = g.ex;
    verts[state.ptr++] = g.ey;
    verts[state.ptr++] = g.ez;
    const seg = state.globalSeg++;
    const phaseB = phase + b * 0.07;
    lineProgress[seg * 2] = 0;
    lineProgress[seg * 2 + 1] = 1;
    edgePhase[seg * 2] = phaseB;
    edgePhase[seg * 2 + 1] = phaseB;
    const bi = seg % GRAPH_EQ_BAR_COUNT;
    barIndex[seg * 2] = bi;
    barIndex[seg * 2 + 1] = bi;
    blueFanBeam[seg * 2] = -1;
    blueFanBeam[seg * 2 + 1] = -1;
  }
}

/**
 * @param {{ ptr: number, globalSeg: number }} state
 */
function pushBlueHubGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, centers, j, spacingScale) {
  const phase = Math.random() * Math.PI * 2;
  for (let b = 0; b < GRAPH_BLUE_HUB_BEAM_COUNT; b++) {
    const g = graphBlueHubFanBeam(centers, j, b, spacingScale);
    verts[state.ptr++] = g.ax;
    verts[state.ptr++] = g.ay;
    verts[state.ptr++] = g.az;
    verts[state.ptr++] = g.ex;
    verts[state.ptr++] = g.ey;
    verts[state.ptr++] = g.ez;
    const seg = state.globalSeg++;
    const phaseB = phase + b * 0.07;
    lineProgress[seg * 2] = 0;
    lineProgress[seg * 2 + 1] = 1;
    edgePhase[seg * 2] = phaseB;
    edgePhase[seg * 2 + 1] = phaseB;
    const bi = seg % GRAPH_EQ_BAR_COUNT;
    barIndex[seg * 2] = bi;
    barIndex[seg * 2 + 1] = bi;
    blueFanBeam[seg * 2] = b;
    blueFanBeam[seg * 2 + 1] = b;
  }
}

/**
 * @param {{ ptr: number, globalSeg: number }} state
 */
function pushLeafGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, centers, leafIdx, chordLen, edgeIdx, beams) {
  for (let b = 0; b < beams; b++) {
    const g = graphLeafRaySegment(centers, leafIdx, chordLen, edgeIdx, b);
    verts[state.ptr++] = g.ax;
    verts[state.ptr++] = g.ay;
    verts[state.ptr++] = g.az;
    verts[state.ptr++] = g.ex;
    verts[state.ptr++] = g.ey;
    verts[state.ptr++] = g.ez;
    const seg = state.globalSeg++;
    const phaseB = Math.random() * Math.PI * 2 + b * 0.07;
    lineProgress[seg * 2] = 0;
    lineProgress[seg * 2 + 1] = 1;
    edgePhase[seg * 2] = phaseB;
    edgePhase[seg * 2 + 1] = phaseB;
    const bi = seg % GRAPH_EQ_BAR_COUNT;
    barIndex[seg * 2] = bi;
    barIndex[seg * 2 + 1] = bi;
    blueFanBeam[seg * 2] = -1;
    blueFanBeam[seg * 2 + 1] = -1;
  }
}

/**
 * Rejection-sample stars in a thick cloud around each graph beam, outside planet cluster shells.
 * @param {Array<[number, number, number]>} centers
 * @param {number} count
 * @param {number} clearance
 * @returns {Float32Array}
 */
function buildGraphEdgeStarPositions(centers, count, clearance) {
  const out = new Float32Array(count * 3);
  if (count <= 0 || centers.length < 2) return out;
  const edgeKeys = [...computeKnnEdges(centers, PLANET_GRAPH_K)];
  if (edgeKeys.length === 0) return out;
  const deg = computePlanetDegrees(edgeKeys, centers.length);
  const minD2 = clearance * clearance;
  const maxAttempts = count * 220;
  let placed = 0;
  let attempt = 0;
  while (placed < count && attempt < maxAttempts) {
    attempt++;
    const ki = Math.floor(Math.random() * edgeKeys.length);
    const key = edgeKeys[ki];
    const [iStr, jStr] = key.split("-");
    const ia = Number(iStr);
    const ja = Number(jStr);
    const di = deg[ia];
    const dja = deg[ja];
    const nSub = graphBeamSegmentSubCount(di, dja, ia, ja);
    const sub = Math.floor(Math.random() * nSub);
    const seg = resolveGraphBeamSegment(centers, ia, ja, di, dja, ki, sub);
    const t = Math.random();
    let px = seg.ax + t * (seg.ex - seg.ax);
    let py = seg.ay + t * (seg.ey - seg.ay);
    let pz = seg.az + t * (seg.ez - seg.az);
    const cloudR = seg.edgeLen * GRAPH_EDGE_STAR_CLOUD_FRAC * (0.45 + Math.random());
    const j1 = (Math.random() - 0.5) * 2 * cloudR;
    const j2 = (Math.random() - 0.5) * 2 * cloudR;
    const invLen = 1 / seg.edgeLen;
    const vx = (seg.ex - seg.ax) * invLen;
    const vy = (seg.ey - seg.ay) * invLen;
    const vz = (seg.ez - seg.az) * invLen;
    const jAlong = (Math.random() - 0.5) * 2 * (seg.edgeLen * GRAPH_EDGE_STAR_ALONG_FRAC);
    px += j1 * seg.rx + j2 * seg.ux + jAlong * vx;
    py += j1 * seg.ry + j2 * seg.uy + jAlong * vy;
    pz += j1 * seg.rz + j2 * seg.uz + jAlong * vz;
    if (minDistSqToCenters(px, py, pz, centers) >= minD2) {
      out[placed * 3] = px;
      out[placed * 3 + 1] = py;
      out[placed * 3 + 2] = pz;
      placed++;
    }
  }
  if (placed > 0 && placed < count) {
    edgeStarFillTail(out, placed, count, centers, edgeKeys, deg, minD2);
  }
  return out;
}

/**
 * Pad remaining slots with tighter clouds along random beams (avoids zeroed verts inside planet shells).
 */
function edgeStarFillTail(out, placed, count, centers, edgeKeys, deg, minD2) {
  let bx = out[(placed - 1) * 3];
  let by = out[(placed - 1) * 3 + 1];
  let bz = out[(placed - 1) * 3 + 2];
  let i = placed;
  let guard = 0;
  const keys = edgeKeys;
  while (i < count && guard < count * 500) {
    guard++;
    const ki = Math.floor(Math.random() * keys.length);
    const key = keys[ki];
    const [iStr, jStr] = key.split("-");
    const ia = Number(iStr);
    const ja = Number(jStr);
    const di = deg[ia];
    const dja = deg[ja];
    const nSub = graphBeamSegmentSubCount(di, dja, ia, ja);
    const sub = Math.floor(Math.random() * nSub);
    const seg = resolveGraphBeamSegment(centers, ia, ja, di, dja, ki, sub);
    const t = Math.random();
    let px = seg.ax + t * (seg.ex - seg.ax);
    let py = seg.ay + t * (seg.ey - seg.ay);
    let pz = seg.az + t * (seg.ez - seg.az);
    const cloudR = seg.edgeLen * GRAPH_EDGE_STAR_CLOUD_FRAC * 0.38 * (0.4 + Math.random());
    const j1 = (Math.random() - 0.5) * 2 * cloudR;
    const j2 = (Math.random() - 0.5) * 2 * cloudR;
    const invLen = 1 / seg.edgeLen;
    const vx = (seg.ex - seg.ax) * invLen;
    const vy = (seg.ey - seg.ay) * invLen;
    const vz = (seg.ez - seg.az) * invLen;
    const jAlong = (Math.random() - 0.5) * 2 * (seg.edgeLen * GRAPH_EDGE_STAR_ALONG_FRAC * 0.5);
    px += j1 * seg.rx + j2 * seg.ux + jAlong * vx;
    py += j1 * seg.ry + j2 * seg.uy + jAlong * vy;
    pz += j1 * seg.rz + j2 * seg.uz + jAlong * vz;
    if (minDistSqToCenters(px, py, pz, centers) >= minD2) {
      out[i * 3] = px;
      out[i * 3 + 1] = py;
      out[i * 3 + 2] = pz;
      bx = px;
      by = py;
      bz = pz;
      i++;
      continue;
    }
    bx += (Math.random() - 0.5) * 420;
    by += (Math.random() - 0.5) * 420;
    bz += (Math.random() - 0.5) * 420;
    if (minDistSqToCenters(bx, by, bz, centers) >= minD2) {
      out[i * 3] = bx;
      out[i * 3 + 1] = by;
      out[i * 3 + 2] = bz;
      i++;
    }
  }
}

/**
 * Orthonormal basis (e1, e2) for the spiral plane and plane normal (n), derived from the
 * direction from the spiral hub (innermost planet) to the farthest planet so the spiral hugs the graph layout.
 * @param {Array<[number, number, number]>} centers
 * @param {[number, number, number]} hub
 */
function spiralPlaneBasis(centers, hub) {
  const [cx, cy, cz] = hub;
  let maxD2 = -1;
  let fx = 1;
  let fy = 0;
  let fz = 0;
  for (let i = 0; i < centers.length; i++) {
    const dx = centers[i][0] - cx;
    const dy = centers[i][1] - cy;
    const dz = centers[i][2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxD2) {
      maxD2 = d2;
      fx = dx;
      fy = dy;
      fz = dz;
    }
  }
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let ax = 0;
  let ay = 1;
  let az = 0;
  let rx = fy * az - fz * ay;
  let ry = fz * ax - fx * az;
  let rz = fx * ay - fy * ax;
  let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl < 1e-6) {
    ax = 1;
    ay = 0;
    az = 0;
    rx = fy * az - fz * ay;
    ry = fz * ax - fx * az;
    rz = fx * ay - fy * ax;
    rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  }
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  return {
    e1: /** @type {[number, number, number]} */ ([rx, ry, rz]),
    e2: /** @type {[number, number, number]} */ ([ux, uy, uz]),
    n: /** @type {[number, number, number]} */ ([fx, fy, fz]),
  };
}

function jitterSpiralPoint(px, py, pz, basis, jN, jP) {
  const jn = (Math.random() - 0.5) * 2 * jN;
  const jp1 = (Math.random() - 0.5) * 2 * jP;
  const jp2 = (Math.random() - 0.5) * 2 * jP;
  const [nx, ny, nz] = basis.n;
  const [e1x, e1y, e1z] = basis.e1;
  const [e2x, e2y, e2z] = basis.e2;
  return [
    px + jn * nx + jp1 * e1x + jp2 * e2x,
    py + jn * ny + jp1 * e1y + jp2 * e2y,
    pz + jn * nz + jp1 * e1z + jp2 * e2z,
  ];
}

/**
 * Rejection-sample star positions outside all planet cluster shells, biased along a logarithmic spiral
 * (r = r₀·e^(bθ)) with multiple rotated arms in a plane through the innermost planet (index 0).
 * @param {Array<[number, number, number]>} centers Scaled planet centers in world space.
 * @param {number} count
 * @param {number} clearance Minimum distance from any center (same units as positions).
 * @returns {Float32Array}
 */
function buildInterstitialStarPositions(centers, count, clearance) {
  const out = new Float32Array(count * 3);
  if (count <= 0 || centers.length === 0) return out;

  const hub = centers[0];
  const extent = maxRadiusFromPoint(hub, centers) + clearance + 2800;
  const minD2 = clearance * clearance;
  const maxTotalAttempts = count * 12000;
  const basis = spiralPlaneBasis(centers, hub);
  const rMin = clearance * 1.08;
  const rMax = extent * 0.94;
  const thetaMax = Math.PI * 2 * INTERSTITIAL_SPIRAL_TURNS;
  const b = Math.log(rMax / rMin) / thetaMax;
  const arms = Math.max(1, INTERSTITIAL_SPIRAL_ARMS);

  let placed = 0;
  let attempt = 0;

  while (placed < count && attempt < maxTotalAttempts) {
    attempt++;
    const arm = Math.floor(Math.random() * arms);
    const theta = Math.random() * thetaMax;
    const phi = theta + (arm / arms) * Math.PI * 2;
    const spiralR = rMin * Math.exp(b * theta);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const [e1x, e1y, e1z] = basis.e1;
    const [e2x, e2y, e2z] = basis.e2;
    let px = hub[0] + spiralR * (cp * e1x + sp * e2x);
    let py = hub[1] + spiralR * (cp * e1y + sp * e2y);
    let pz = hub[2] + spiralR * (cp * e1z + sp * e2z);
    const jittered = jitterSpiralPoint(px, py, pz, basis, INTERSTITIAL_SPIRAL_JITTER_NORMAL, INTERSTITIAL_SPIRAL_JITTER_INPLANE);
    px = jittered[0];
    py = jittered[1];
    pz = jittered[2];
    if (minDistSqToCenters(px, py, pz, centers) >= minD2) {
      out[placed * 3] = px;
      out[placed * 3 + 1] = py;
      out[placed * 3 + 2] = pz;
      placed++;
    }
  }

  if (placed > 0 && placed < count) {
    spiralFillTail(out, placed, count, hub, centers, basis, minD2, rMin, thetaMax, b, arms);
  }

  return out;
}

/**
 * Finish remaining slots with spiral-biased proposals (tighter jitter) so we avoid zeros at origin.
 */
function spiralFillTail(out, placed, count, hub, centers, basis, minD2, rMin, thetaMax, b, arms) {
  let bx = out[(placed - 1) * 3];
  let by = out[(placed - 1) * 3 + 1];
  let bz = out[(placed - 1) * 3 + 2];
  const tightN = INTERSTITIAL_SPIRAL_JITTER_NORMAL * 0.35;
  const tightP = INTERSTITIAL_SPIRAL_JITTER_INPLANE * 0.35;
  let i = placed;
  let guard = 0;
  while (i < count && guard < count * 400) {
    guard++;
    const theta = Math.random() * thetaMax;
    const arm = Math.floor(Math.random() * arms);
    const phi = theta + (arm / arms) * Math.PI * 2;
    const spiralR = rMin * Math.exp(b * theta);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const [e1x, e1y, e1z] = basis.e1;
    const [e2x, e2y, e2z] = basis.e2;
    let px = hub[0] + spiralR * (cp * e1x + sp * e2x);
    let py = hub[1] + spiralR * (cp * e1y + sp * e2y);
    let pz = hub[2] + spiralR * (cp * e1z + sp * e2z);
    const jittered = jitterSpiralPoint(px, py, pz, basis, tightN, tightP);
    px = jittered[0];
    py = jittered[1];
    pz = jittered[2];
    if (minDistSqToCenters(px, py, pz, centers) >= minD2) {
      out[i * 3] = px;
      out[i * 3 + 1] = py;
      out[i * 3 + 2] = pz;
      bx = px;
      by = py;
      bz = pz;
      i++;
      continue;
    }
    bx += (Math.random() - 0.5) * 280;
    by += (Math.random() - 0.5) * 280;
    bz += (Math.random() - 0.5) * 280;
    if (minDistSqToCenters(bx, by, bz, centers) >= minD2) {
      out[i * 3] = bx;
      out[i * 3 + 1] = by;
      out[i * 3 + 2] = bz;
      i++;
    }
  }
}

class SolarSystem {
  constructor(isMobile = false) {
    this.isMobile = isMobile;
    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._spectrumResponse = 1.35;
    /**
     * Multiplier applied to each planet's base `def.position` for runtime spread tuning
     * (see {@link setPlanetSpacing} and {@link setupGUI}). 1 = unmodified PLANET_DEFS layout.
     */
    this._spacingScale = 1;
    this.sun = this._createSun();
    this.sunLight = null;
    this.planets = PLANET_DEFS.map((def) => this._createPlanet(def));
    this._attachGreenPlanetFade(this.planets[2]);
    this.starField = this._createStars();
    this.planetClusters = this.planets.map((p) => this._createPlanetCluster(p));
    this._clusterPickProxies = this.planets.map((p) => this._createClusterPickProxy(p));
    this.graphLines = this._createGraphEdges();
    this.interstitialStars = this._createInterstitialStars();
    this.graphEdgeStars = this._createGraphEdgeStars();
    /** Smoothed 0..1 drive for graph laser shader (FFT loudness). */
    this._graphPulse = 0;
    this._graphPulseTarget = 0;
    /** Smoothed bass band for extra beam speed / brightness. */
    this._graphBassSm = 0;
    this._graphBassTarget = 0;
    /** Smoothed 0..1 levels per EQ bar for laser on/off gating. */
    this._graphEqSm = new Float32Array(GRAPH_EQ_BAR_COUNT);
    this._graphEqTarget = new Float32Array(GRAPH_EQ_BAR_COUNT);
    /**
     * Decoded-track laser windows: distinct 16-bar chunk indices (0-based) with highest RMS.
     * `null` = file not analyzed yet (lasers stay off). `[]` = failed / no chunks → legacy 8-bar blink.
     * Ignored for live/mic (`audioCurrentTime` null in {@link #setGraphLaserEightBarPhase}).
     */
    this._graphLaserHotChunkIndices = null;
    /** `null` = follow music analysis; `'on'` / `'off'` = user override (see {@link #setGraphLaserManualOverride}). */
    this._graphLaserManualOverride = null;
    this._redPlanetHalves = new PlanetHalvesEffect(this.planets[RED_PLANET_INDEX]);
    /** Re-opens after a non-beat frame so each onset triggers at most one bounce. */
    this._redPlanetBeatGateOpen = true;
  }

  get primary() {
    return this.planets[0];
  }

  /** Red planet — dev default follow target when {@link DEV_START_ON_RED_PLANET} is on. */
  get redPlanet() {
    return this.planets[RED_PLANET_INDEX];
  }

  /** Split the red planet in half; halves bounce apart and reunite. */
  triggerRedPlanetShatter() {
    this._redPlanetHalves?.trigger();
  }

  /**
   * Beat-reactive bounce: one split animation per detected onset (not every frame `isBeat` stays true).
   * @param {boolean} isBeat
   */
  tryTriggerRedPlanetOnBeat(isBeat) {
    if (!isBeat) {
      this._redPlanetBeatGateOpen = true;
      return;
    }
    if (!this._redPlanetBeatGateOpen) return;
    this._redPlanetBeatGateOpen = false;
    this.triggerRedPlanetShatter();
  }

  /**
   * Centroid of all planet positions in world space, including the current {@link _spacingScale}.
   * Used by the planet-graph view as a fallback orbit pivot when no planet is captured.
   * @returns {THREE.Vector3}
   */
  getGraphCentroid() {
    const c = new THREE.Vector3();
    if (this.planets.length === 0) return c;
    const s = this._spacingScale;
    for (const p of this.planets) {
      c.x += p.def.position[0] * s;
      c.y += p.def.position[1] * s;
      c.z += p.def.position[2] * s;
    }
    c.divideScalar(this.planets.length);
    return c;
  }

  /**
   * Scale every planet's world position by `scale` relative to its base `def.position`.
   * Updates the planet mesh, the surrounding star cluster (via {@link THREE.Points#position}, since
   * cluster vertices already include the base center), the invisible pick proxy, and rebuilds the
   * graph edge geometry, graph-edge star cloud, and interstitial stars. Blue stays at the origin regardless of scale.
   * @param {number} scale
   */
  setPlanetSpacing(scale) {
    if (!Number.isFinite(scale)) return;
    if (Math.abs(scale - this._spacingScale) < 1e-4) return;
    this._spacingScale = scale;
    for (let i = 0; i < this.planets.length; i++) {
      const base = PLANET_DEFS[i].position;
      this.planets[i].mesh.position.set(base[0] * scale, base[1] * scale, base[2] * scale);
      this.planetClusters[i].position.set(
        base[0] * (scale - 1),
        base[1] * (scale - 1),
        base[2] * (scale - 1)
      );
      this._clusterPickProxies[i].position.set(
        base[0] * scale,
        base[1] * scale,
        base[2] * scale
      );
    }
    this._rebuildGraphEdgeGeometry();
    this._rebuildInterstitialStarGeometry();
    this._rebuildGraphEdgeStarGeometry();
  }

  /** @returns {number} */
  getPlanetSpacing() {
    return this._spacingScale;
  }

  /**
   * Add a "Planet Graph" folder with a Spacing slider to a lil-gui instance.
   * Optional `onChange` runs after each slider tick so callers can refresh dependent state
   * (for example {@link CameraController#graphCentroid}).
   * @param {{ addFolder: Function }} gui
   * @param {{ onChange?: (scale: number) => void }} [options]
   */
  setupGUI(gui, { onChange } = {}) {
    const folder = gui.addFolder("Planet Graph");
    const params = { spacing: this._spacingScale };
    folder.add(params, "spacing", 0.3, 3, 0.05).name("Planet Spacing").onChange((v) => {
      this.setPlanetSpacing(v);
      if (typeof onChange === "function") onChange(v);
    });
    this._setupGreenPlanetGUI(gui);
  }

  /**
   * Live editing controls for the green planet (PLANET_DEFS index 2). The Planet Growth folder
   * exposes one color picker per palette entry plus a softness slider that controls how sharp
   * each color's territory is on the planet surface.
   * @param {{ addFolder: Function }} gui
   */
  _setupGreenPlanetGUI(gui) {
    const green = this.planets[2];
    if (!green?.fade?.uniforms?.uColors) return;
    const folder = gui.addFolder("Planet Growth");
    PLANET_GROWTH_PALETTE.forEach((entry, i) => {
      folder.addColor(green.fade.uniforms.uColors.value, i).name(entry.name);
    });
    folder.add(green.fade.uniforms.uSoftness, "value", 0.5, 8, 0.1).name("Softness");
  }

  /**
   * Patches the green planet's MeshPhysicalMaterial so its diffuse color is a soft blend across
   * {@link PLANET_GROWTH_PALETTE}. Each palette entry has a world-space axis (driven by
   * {@link createGreenPlanetFadeHandles}); the blend weight at each fragment is the remapped
   * dot product of the surface normal with that axis, raised to `uSoftness`.
   * @param {{ material: import("three").Material }} planet
   */
  _attachGreenPlanetFade(planet) {
    const colors = PLANET_GROWTH_PALETTE.map((entry) => new THREE.Color(entry.hex));
    const axes = [];
    for (let i = 0; i < PLANET_GROWTH_PALETTE.length; i++) {
      const a = (i / PLANET_GROWTH_PALETTE.length) * Math.PI * 2 - Math.PI / 2;
      axes.push(new THREE.Vector3(Math.cos(a), -Math.sin(a), 0));
    }
    planet.fade = {
      uniforms: {
        uColors: { value: colors },
        uAxes: { value: axes },
        uSoftness: { value: 2.5 },
      },
    };
    planet.material.onBeforeCompile = (shader) => {
      shader.uniforms.uColors = planet.fade.uniforms.uColors;
      shader.uniforms.uAxes = planet.fade.uniforms.uAxes;
      shader.uniforms.uSoftness = planet.fade.uniforms.uSoftness;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", PLANET_GROWTH_VERTEX_COMMON_INSERT)
        .replace("#include <beginnormal_vertex>", PLANET_GROWTH_VERTEX_NORMAL_INSERT);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", PLANET_GROWTH_FRAG_COMMON_INSERT)
        .replace("#include <color_fragment>", PLANET_GROWTH_FRAG_COLOR_INSERT);
    };
    planet.material.needsUpdate = true;
  }

  /**
   * Invisible click proxies (one per planet) used in graph view — planet meshes are sub-pixel from 15k away.
   * @returns {Array<import("three").Mesh>}
   */
  getClusterPickProxies() {
    return this._clusterPickProxies;
  }

  addToScene(scene) {
    // Place sun far from blue planet (Earth-Sun distance ~150 million km, scale for scene)
    // Blue planet sits at the origin, so sun is offset 150 units along +X.
    this.sun.position.set(150, 0, 0);
    scene.add(this.sun);
    for (let i = 0; i < this.planets.length; i++) {
      this.planets[i].pivot.visible = true;
      scene.add(this.planets[i].pivot);
    }
    scene.add(this.starField);
    scene.add(this.interstitialStars);
    for (const cluster of this.planetClusters) scene.add(cluster);
    for (const proxy of this._clusterPickProxies) scene.add(proxy);
    scene.add(this.graphEdgeStars);
    scene.add(this.graphLines);
    this.sunLight = this._setupLights(scene);
  }

  update(dt) {
    for (const p of this.planets) {
      // p.pivot.rotation.y += dt * p.def.speed; // Orbit disabled
      p.mesh.rotation.y += dt * 0.2;
      // No mesh.rotation.x — pyramid field (child of primary planet) would tumble off-axis; keep spin Y-only for comfort.
      if (p.goopMaterial?.uniforms?.uTime) {
        p.goopMaterial.uniforms.uTime.value += dt;
      }
    }
    this.starField.rotation.y += dt * 0.001;
    this.interstitialStars.rotation.y += dt * 0.001;
    this.graphEdgeStars.rotation.y += dt * 0.001;

    this._graphPulse += (this._graphPulseTarget - this._graphPulse) * 0.14;
    this._graphBassSm += (this._graphBassTarget - this._graphBassSm) * 0.2;
    this._redPlanetHalves?.setLoudnessDrive(this._graphPulse);
    this._redPlanetHalves?.update(dt);
    const eqA = 0.19;
    for (let i = 0; i < GRAPH_EQ_BAR_COUNT; i++) {
      this._graphEqSm[i] += (this._graphEqTarget[i] - this._graphEqSm[i]) * eqA;
    }
    if (this._graphLineMat) {
      this._graphLineMat.uniforms.uTime.value += dt;
      this._graphLineMat.uniforms.uMusicPulse.value = this._graphPulse;
      this._graphLineMat.uniforms.uBass.value = this._graphBassSm;
      const u03 = this._graphLineMat.uniforms.uBars0to3.value;
      const u47 = this._graphLineMat.uniforms.uBars4to7.value;
      const b = this._graphEqSm;
      u03.set(b[0], b[1], b[2], b[3]);
      u47.set(b[4], b[5], b[6], b[7]);
    }

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const b = Math.min(Math.max(this._brightness, 0.42), 2.0);
    if (this._sunMat) {
      this._sunMat.opacity = Math.min(0.62 + b * 0.38, 1.0);
    }
  }

  /**
   * Same loudness mapping as {@link Comet#setLoudness} (spectrum-driven pulsing).
   * @param {number} loudness
   */
  setLoudness(loudness) {
    this._targetBrightness = 0.32 + loudness * this._spectrumResponse;
  }

  /**
   * Eight-band EQ levels (0..1) — each graph beam picks a bar; beams turn off when their bar is below threshold.
   * @param {ArrayLike<number>} bands — length {@link GRAPH_EQ_BAR_COUNT}
   */
  setGraphEqBands(bands) {
    for (let i = 0; i < GRAPH_EQ_BAR_COUNT; i++) {
      const v = Number(bands[i]);
      this._graphEqTarget[i] = Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 0;
    }
  }

  /**
   * Drives constellation graph “laser” brightness and pulse speed from FFT data.
   * @param {{ loudness?: number, bass?: number }} [audio]
   */
  setGraphAudioDrive(audio = {}) {
    const L = Number(audio.loudness);
    const B = Number(audio.bass);
    const loud = Number.isFinite(L) ? L : 0;
    const bass = Number.isFinite(B) ? B : 0;
    this._graphPulseTarget = THREE.MathUtils.clamp(loud * 2.25, 0, 1);
    this._graphBassTarget = THREE.MathUtils.clamp(bass * 1.65, 0, 1);
  }

  _createSun() {
    const geo = new THREE.SphereGeometry(
      SUN_WORLD_RADIUS,
      SUN_SPHERE_WIDTH_SEGMENTS,
      SUN_SPHERE_HEIGHT_SEGMENTS,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: SUN_HEAD_COLOR,
      transparent: true,
      opacity: 0.97,
    });
    this._sunMat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.enable(1);
    return mesh;
  }

  _createPlanet(def) {
    const segs = this.isMobile ? 32 : 64;
    const geo = new THREE.SphereGeometry(def.radius, segs, segs);
    const mat = new THREE.MeshPhysicalMaterial({
      color: def.color,
      metalness: 0.2,
      roughness: 0.7,
      clearcoat: 0.5,
      clearcoatRoughness: 0.1,
      reflectivity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const goopMaterial = attachPlanetInteriorGoop(mesh, def, this.isMobile);
    const pivot = new THREE.Group();
    mesh.position.set(def.position[0], def.position[1], def.position[2]);
    pivot.add(mesh);
    return { mesh, material: mat, pivot, def, goopMaterial };
  }

  /**
   * One `THREE.Points` shell per planet at its def.position. Material matches the global starfield
   * (white, size 0.6) so clusters read as ordinary stars — just spatially grouped around each planet.
   * Lives in scene root (not parented to pivot) — positions are static and bake the planet center.
   * @param {{ def: { position: [number, number, number] } }} planet
   * @returns {import("three").Points}
   */
  _createPlanetCluster(planet) {
    const def = planet.def;
    const count = this.isMobile ? PLANET_CLUSTER_COUNT_MOBILE : PLANET_CLUSTER_COUNT_DESKTOP;
    const r0 = PLANET_CLUSTER_INNER_RADIUS;
    const r1 = PLANET_CLUSTER_OUTER_RADIUS;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = r0 + Math.random() * (r1 - r0);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      positions[i * 3] = def.position[0] + r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = def.position[1] + r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = def.position[2] + r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Points(geo, mat);
  }

  /**
   * Invisible mesh sphere covering each planet's cluster — the raycast target in graph view.
   * `userData.planet` holds the planet object so click handlers can resolve back to the model.
   * @param {{ def: { position: [number, number, number] } }} planet
   * @returns {import("three").Mesh}
   */
  _createClusterPickProxy(planet) {
    const geo = new THREE.SphereGeometry(PLANET_PICK_PROXY_RADIUS, 16, 12);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.Mesh(geo, mat);
    proxy.position.set(planet.def.position[0], planet.def.position[1], planet.def.position[2]);
    proxy.userData.planet = planet;
    return proxy;
  }

  /**
   * `THREE.LineSegments` for the k-nearest-neighbor graph. Hub–hub edges: fan from lower index toward
   * the neighbor. **Leaf** planets (graph degree 1): beams shoot from that planet’s center in seeded
   * random directions (open end). An isolated edge (two leaves) emits rays from **both** centers.
   * @returns {import("three").LineSegments}
   */
  _createGraphEdges() {
    const { verts, lineProgress, edgePhase, barIndex, blueFanBeam } = this._buildGraphEdgeGeometryArrays();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute("lineProgress", new THREE.BufferAttribute(lineProgress, 1));
    geo.setAttribute("edgePhase", new THREE.BufferAttribute(edgePhase, 1));
    geo.setAttribute("barIndex", new THREE.BufferAttribute(barIndex, 1));
    geo.setAttribute("blueFanBeam", new THREE.BufferAttribute(blueFanBeam, 1));
    const mat = createGraphLaserLineMaterial();
    this._graphLineMat = mat;
    return new THREE.LineSegments(geo, mat);
  }

  /**
   * Edge endpoints plus per-vertex shader attributes (0..1 along each segment; phase per beam).
   * @returns {{ verts: Float32Array, lineProgress: Float32Array, edgePhase: Float32Array, barIndex: Float32Array, blueFanBeam: Float32Array }}
   */
  _buildGraphEdgeGeometryArrays() {
    const s = this._spacingScale;
    const positions = PLANET_DEFS.map((d) => [
      d.position[0] * s,
      d.position[1] * s,
      d.position[2] * s,
    ]);
    const edgeList = [...computeKnnEdges(positions, PLANET_GRAPH_K)];
    const deg = computePlanetDegrees(edgeList, positions.length);
    const beams = GRAPH_LASER_FAN_BEAMS;
    const nSeg = countGraphLaserSegments(edgeList, deg, beams);
    const verts = new Float32Array(nSeg * 6);
    const lineProgress = new Float32Array(nSeg * 2);
    const edgePhase = new Float32Array(nSeg * 2);
    const barIndex = new Float32Array(nSeg * 2);
    const blueFanBeam = new Float32Array(nSeg * 2);
    const state = { ptr: 0, globalSeg: 0 };

    for (let edgeIdx = 0; edgeIdx < edgeList.length; edgeIdx++) {
      const key = edgeList[edgeIdx];
      const [iStr, jStr] = key.split("-");
      const i = Number(iStr);
      const j = Number(jStr);
      const di = deg[i];
      const dj = deg[j];
      const ax = positions[i][0];
      const ay = positions[i][1];
      const az = positions[i][2];
      const bx = positions[j][0];
      const by = positions[j][1];
      const bz = positions[j][2];
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const chordLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (di > 1 && dj > 1) {
        if (i === 0) {
          pushBlueHubGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, j, s);
        } else {
          pushHubHubGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, i, j, beams, s);
        }
      } else if (di === 1 && dj > 1) {
        pushLeafGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, i, chordLen, edgeIdx, beams);
      } else if (dj === 1 && di > 1) {
        pushLeafGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, j, chordLen, edgeIdx, beams);
      } else {
        pushLeafGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, i, chordLen, edgeIdx, beams);
        pushLeafGraphLasers(state, verts, lineProgress, edgePhase, barIndex, blueFanBeam, positions, j, chordLen, edgeIdx, beams);
      }
    }
    return { verts, lineProgress, edgePhase, barIndex, blueFanBeam };
  }

  /** Refresh the graph-line geometry in place after a spacing change. */
  _rebuildGraphEdgeGeometry() {
    const { verts, lineProgress, edgePhase, barIndex, blueFanBeam } = this._buildGraphEdgeGeometryArrays();
    const geo = this.graphLines.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute("lineProgress", new THREE.BufferAttribute(lineProgress, 1));
    geo.setAttribute("edgePhase", new THREE.BufferAttribute(edgePhase, 1));
    geo.setAttribute("barIndex", new THREE.BufferAttribute(barIndex, 1));
    geo.setAttribute("blueFanBeam", new THREE.BufferAttribute(blueFanBeam, 1));
    geo.attributes.position.needsUpdate = true;
    geo.attributes.lineProgress.needsUpdate = true;
    geo.attributes.edgePhase.needsUpdate = true;
    geo.attributes.barIndex.needsUpdate = true;
    geo.attributes.blueFanBeam.needsUpdate = true;
  }

  /** @returns {Array<[number, number, number]>} */
  _scaledPlanetCenters() {
    const s = this._spacingScale;
    return PLANET_DEFS.map((d) => [
      d.position[0] * s,
      d.position[1] * s,
      d.position[2] * s,
    ]);
  }

  /** @returns {Float32Array} */
  _buildInterstitialStarPositions() {
    const count = this.isMobile ? INTERSTITIAL_STAR_COUNT_MOBILE : INTERSTITIAL_STAR_COUNT_DESKTOP;
    return buildInterstitialStarPositions(this._scaledPlanetCenters(), count, INTERSTITIAL_CLEARANCE);
  }

  /**
   * Stars sampled outside every planet cluster shell — fills voids along graph edges / between clusters.
   * @returns {import("three").Points}
   */
  _createInterstitialStars() {
    const positions = this._buildInterstitialStarPositions();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Points(geo, mat);
  }

  _rebuildInterstitialStarGeometry() {
    const verts = this._buildInterstitialStarPositions();
    this.interstitialStars.geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    this.interstitialStars.geometry.attributes.position.needsUpdate = true;
  }

  /** @returns {Float32Array} */
  _buildGraphEdgeStarPositions() {
    const count = this.isMobile ? GRAPH_EDGE_STAR_COUNT_MOBILE : GRAPH_EDGE_STAR_COUNT_DESKTOP;
    return buildGraphEdgeStarPositions(this._scaledPlanetCenters(), count, INTERSTITIAL_CLEARANCE);
  }

  /**
   * Stars forming a loose tube around each graph laser beam (see {@link buildGraphEdgeStarPositions}).
   * @returns {import("three").Points}
   */
  _createGraphEdgeStars() {
    const positions = this._buildGraphEdgeStarPositions();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const baseOpacity = 0.82;
    this._graphEdgeStarsBaseOpacity = baseOpacity;
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
      transparent: true,
      opacity: baseOpacity,
    });
    return new THREE.Points(geo, mat);
  }

  /**
   * @param {number[] | null} indices - ascending chunk indices from waveform analysis; `null` clears (pending).
   */
  setGraphLaserHotChunkIndices(indices) {
    if (indices == null) {
      this._graphLaserHotChunkIndices = null;
      return;
    }
    this._graphLaserHotChunkIndices = Array.from(indices, (n) => Math.floor(Number(n))).filter(
      (n) => Number.isFinite(n) && n >= 0,
    );
  }

  /**
   * @param {'on' | 'off' | null} mode - `null` clears override (music-driven lasers again).
   */
  setGraphLaserManualOverride(mode) {
    if (mode === "on" || mode === "off") {
      this._graphLaserManualOverride = mode;
    } else {
      this._graphLaserManualOverride = null;
    }
  }

  /** @returns {'on' | 'off' | null} */
  getGraphLaserManualOverride() {
    return this._graphLaserManualOverride;
  }

  _computeGraphLaserAutoCycle(audioCurrentTime, barDuration) {
    let cycle = 1;
    const hot = this._graphLaserHotChunkIndices;
    const isFile =
      audioCurrentTime != null && Number.isFinite(audioCurrentTime) && audioCurrentTime >= 0;

    if (isFile && Number.isFinite(barDuration) && barDuration > 1e-6) {
      const t = Math.max(0, audioCurrentTime);
      if (hot != null && hot.length > 0) {
        const barIdx = Math.floor(t / barDuration);
        const chunkIdx = Math.floor(barIdx / 16);
        cycle = hot.includes(chunkIdx) ? 1 : 0;
      } else if (hot != null && hot.length === 0) {
        const barIdx = Math.floor(t / barDuration);
        const chunk = Math.floor(barIdx / 8);
        cycle = chunk % 2 === 0 ? 1 : 0;
      } else {
        cycle = 0;
      }
    } else if (Number.isFinite(barDuration) && barDuration > 1e-6) {
      const t = performance.now() * 0.001;
      const barIdx = Math.floor(t / barDuration);
      const chunk = Math.floor(barIdx / 8);
      cycle = chunk % 2 === 0 ? 1 : 0;
    }
    return cycle;
  }

  /**
   * **File** (`audioCurrentTime` set): lasers on only during the two loudest 16-bar chunks once
   * {@link #setGraphLaserHotChunkIndices} is populated; off while analysis is pending (`null`);
   * if analysis yields no full chunks, falls back to hide/show every 8 bars.
   *
   * **Live** (`audioCurrentTime` null): ignores hot chunks; toggles every 8 bars on wall-clock time.
   *
   * Override: {@link #setGraphLaserManualOverride} forces visible or hidden regardless of audio.
   * @param {number | null} audioCurrentTime - seconds; null = live / wall-clock phase.
   * @param {number} barDuration - seconds per 4/4 bar from beat detector (must be > 0).
   */
  setGraphLaserEightBarPhase(audioCurrentTime, barDuration) {
    const o = this._graphLaserManualOverride;
    let cycle = 1;
    if (o === "off") {
      cycle = 0;
    } else if (o === "on") {
      cycle = 1;
    } else {
      cycle = this._computeGraphLaserAutoCycle(audioCurrentTime, barDuration);
    }
    if (this._graphLineMat) {
      this._graphLineMat.uniforms.uLaserCycle.value = cycle;
    }
    const base = this._graphEdgeStarsBaseOpacity ?? 0.82;
    if (this.graphEdgeStars?.material) {
      this.graphEdgeStars.material.opacity = base * cycle;
    }
  }

  _rebuildGraphEdgeStarGeometry() {
    const verts = this._buildGraphEdgeStarPositions();
    this.graphEdgeStars.geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    this.graphEdgeStars.geometry.attributes.position.needsUpdate = true;
  }

  _createStars() {
    const starsGeo = new THREE.BufferGeometry();
    const count = this.isMobile ? 1200 : 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 200 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    starsGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const starsMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    return new THREE.Points(starsGeo, starsMat);
  }

  _setupLights(scene) {
    const sunLight = new THREE.PointLight(0xfff9ec, 14, 520, 0.52);
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x6b6f88, 0.5)); // Increased ambient
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x101020, 0.5));
    return sunLight;
  }
}

export {
  PLANET_DEFS,
  computeKnnEdges,
  buildInterstitialStarPositions,
  buildGraphEdgeStarPositions,
  INTERSTITIAL_CLEARANCE,
  GRAPH_LASER_FAN_BEAMS,
  GRAPH_BLUE_HUB_BEAM_COUNT,
  GRAPH_EQ_BAR_COUNT,
  spectrumToGraphEqBands,
  countGraphLineVertices,
};
export default SolarSystem;
