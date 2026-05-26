import * as THREE from "three";

/** Index of the Red planet in {@link PLANET_DEFS} / `solarSystem.planets`. */
export const RED_PLANET_INDEX = 1;

/** Seconds for split apart → hold → reunite. */
export const PLANET_SHATTER_DURATION_SEC = 1.35;
/** Peak separation as a multiple of planet radius (world units in mesh local space). */
export const PLANET_SHATTER_SEPARATION_SCALE = 1.25;

/** Normalized timeline: burst apart [0, BURST_END), brief hold, then reunite. */
export const PLANET_SHATTER_BURST_END = 0.38;
export const PLANET_SHATTER_HOLD_END = 0.55;

const PLANE_EPS = 1e-5;
const CAP_DEDUPE_EPS = 1e-4;

/** Normalized loudness → separation: floor at min, full span at 1. */
export const PLANET_SHATTER_LOUDNESS_MIN = 0.08;
/** Seconds to ramp separation after a beat while loudness is driving. */
export const PLANET_SHATTER_ATTACK_SEC = 0.22;
/** Reunite when smoothed loudness stays below this. */
export const PLANET_SHATTER_REUNITE_THRESHOLD = 0.06;
/** Quiet time before reuniting in music-driven mode. */
export const PLANET_SHATTER_REUNITE_QUIET_SEC = 0.45;

/**
 * @param {number} loudnessSm — smoothed 0..1 loudness drive
 * @returns {number} separation factor in [LOUDNESS_MIN, 1]
 */
export function planetHalfSeparationFactorFromLoudness(loudnessSm) {
  const u = Math.min(1, Math.max(0, loudnessSm));
  return PLANET_SHATTER_LOUDNESS_MIN + u * (1 - PLANET_SHATTER_LOUDNESS_MIN);
}

/**
 * @param {number} t — normalized time in [0, 1]
 * @returns {number} separation factor 0 → 1 (peak) → 0
 */
export function planetShatterSeparationFactor(t) {
  const u = Math.min(1, Math.max(0, t));
  if (u < PLANET_SHATTER_BURST_END) {
    const p = u / PLANET_SHATTER_BURST_END;
    return p * easeOutBack(p);
  }
  if (u < PLANET_SHATTER_HOLD_END) {
    return 1;
  }
  const p = (u - PLANET_SHATTER_HOLD_END) / (1 - PLANET_SHATTER_HOLD_END);
  return 1 - easeInOutCubic(p);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.Vector3[][]}
 */
function extractTriangles(geometry) {
  const pos = geometry.getAttribute("position");
  const idx = geometry.getIndex();
  const triangles = [];
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2));
      triangles.push([a, b, c]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      triangles.push([a, b, c]);
    }
  }
  return triangles;
}

/**
 * Clip one triangle to the half-space y >= 0 (positive) or y <= 0 (negative).
 * @param {THREE.Vector3} v0
 * @param {THREE.Vector3} v1
 * @param {THREE.Vector3} v2
 * @param {boolean} keepPositiveY
 * @param {THREE.Vector3[]} outTris — flat list of triangle vertices (3 per tri)
 * @param {THREE.Vector3[]} capRing — intersection points on y = 0
 */
function clipTriangleToYHalf(v0, v1, v2, keepPositiveY, outTris, capRing) {
  const inside = (v) => (keepPositiveY ? v.y >= -PLANE_EPS : v.y <= PLANE_EPS);
  const verts = [v0, v1, v2];
  const mask = verts.map(inside);

  const pushTri = (a, b, c) => {
    outTris.push(a, b, c);
  };

  const edgeCross = (a, b) => {
    const da = a.y;
    const db = b.y;
    if (Math.abs(da - db) < 1e-12) return a.clone();
    const t = da / (da - db);
    const p = a.clone().lerp(b, t);
    p.y = 0;
    capRing.push(p);
    return p;
  };

  const nIn = mask.filter(Boolean).length;
  if (nIn === 3) {
    pushTri(v0, v1, v2);
    return;
  }
  if (nIn === 0) return;

  const poly = [];
  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 3];
    const aIn = mask[i];
    const bIn = mask[(i + 1) % 3];
    if (aIn) poly.push(a.clone());
    if (aIn !== bIn) poly.push(edgeCross(a, b));
  }

  if (poly.length < 3) return;
  for (let i = 1; i < poly.length - 1; i++) {
    pushTri(poly[0], poly[i], poly[i + 1]);
  }
}

/**
 * @param {THREE.Vector3[]} points
 * @returns {THREE.Vector3[]}
 */
function dedupeCapPoints(points) {
  const out = [];
  for (const p of points) {
    if (out.every((q) => q.distanceToSquared(p) > CAP_DEDUPE_EPS * CAP_DEDUPE_EPS)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Fan-triangulate the cut disc so each half is a closed solid (shell + cap).
 * @param {THREE.Vector3[]} ring
 * @param {boolean} keepPositiveY
 * @param {THREE.Vector3[]} outTris
 */
function triangulateCap(ring, keepPositiveY, outTris) {
  if (ring.length < 3) return;
  const sorted = [...ring].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  const center = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    if (keepPositiveY) {
      outTris.push(center, b, a);
    } else {
      outTris.push(center, a, b);
    }
  }
}

/** Material group index for the curved outer shell. */
export const PLANET_HALF_SHELL_GROUP = 0;
/** Material group index for the flat cut / interior cap. */
export const PLANET_HALF_INTERIOR_GROUP = 1;

/** Emissive strength on interior caps — kept modest so UnrealBloomPass reads as a soft glow. */
export const PLANET_HALF_INTERIOR_EMISSIVE_INTENSITY = 0.62;

/**
 * White interior face on the split plane (material group 1).
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createPlanetHalfInteriorMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: PLANET_HALF_INTERIOR_EMISSIVE_INTENSITY,
    metalness: 0.05,
    roughness: 0.72,
    clearcoat: 0.2,
    clearcoatRoughness: 0.15,
    side: THREE.DoubleSide,
  });
  return mat;
}

/**
 * @param {THREE.Vector3[]} shellVerts — outer surface triangles
 * @param {THREE.Vector3[]} capVerts — interior cap triangles
 * @returns {THREE.BufferGeometry}
 */
function bufferGeometryFromShellAndCap(shellVerts, capVerts) {
  const shellVertCount = shellVerts.length;
  const totalVerts = shellVertCount + capVerts.length;
  const positions = new Float32Array(totalVerts * 3);
  const writeVerts = (verts, offset) => {
    for (let i = 0; i < verts.length; i++) {
      const o = (offset + i) * 3;
      positions[o] = verts[i].x;
      positions[o + 1] = verts[i].y;
      positions[o + 2] = verts[i].z;
    }
  };
  writeVerts(shellVerts, 0);
  writeVerts(capVerts, shellVertCount);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (shellVertCount > 0) {
    geo.addGroup(0, shellVertCount, PLANET_HALF_SHELL_GROUP);
  }
  if (capVerts.length > 0) {
    geo.addGroup(shellVertCount, capVerts.length, PLANET_HALF_INTERIOR_GROUP);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Split a sphere (or any closed mesh centered on the origin) into two solid halves at y = 0.
 * Each half includes the curved outer surface and a flat cap on the cut plane.
 * @param {THREE.BufferGeometry} geometry
 * @returns {{ positive: THREE.BufferGeometry, negative: THREE.BufferGeometry }}
 */
export function splitSphereGeometryAtEquator(geometry) {
  const tris = extractTriangles(geometry);
  const posShell = [];
  const negShell = [];
  const posCapRing = [];
  const negCapRing = [];
  const posCap = [];
  const negCap = [];

  for (const [a, b, c] of tris) {
    clipTriangleToYHalf(a, b, c, true, posShell, posCapRing);
    clipTriangleToYHalf(a, b, c, false, negShell, negCapRing);
  }

  triangulateCap(dedupeCapPoints(posCapRing), true, posCap);
  triangulateCap(dedupeCapPoints(negCapRing), false, negCap);

  return {
    positive: bufferGeometryFromShellAndCap(posShell, posCap),
    negative: bufferGeometryFromShellAndCap(negShell, negCap),
  };
}

/**
 * Solid 3D half-spheres: clipped mesh + capped cut face (watertight).
 * @param {number} radius
 * @param {number} widthSegments
 * @param {number} heightSegments
 * @returns {[THREE.BufferGeometry, THREE.BufferGeometry]}
 */
export function createSphereHalvesGeometries(radius, widthSegments, heightSegments) {
  const full = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const halves = splitSphereGeometryAtEquator(full);
  full.dispose();
  return [halves.positive, halves.negative];
}

/**
 * Split / reunite animation for one planet mesh (Red planet in dev).
 */
export class PlanetHalvesEffect {
  /**
   * @param {{ mesh: THREE.Mesh, pivot: THREE.Group, def: { radius: number } }} planet
   */
  constructor(planet) {
    this.planet = planet;
    this.group = new THREE.Group();
    this.group.name = "planetHalves";
    planet.pivot.add(this.group);
    /** @type {[THREE.Mesh, THREE.Mesh] | null} */
    this._halves = null;
    this.active = false;
    this._elapsed = 0;
    this._quietElapsed = 0;
    this._maxSep = planet.def.radius * PLANET_SHATTER_SEPARATION_SCALE;
    this._loudnessTarget = 0;
    this._loudnessSm = 0;
    /** Stays true after music drives a split until halves reunite. */
    this._musicSplitMode = false;
  }

  /** @param {number} loudness01 — smoothed 0..1 music loudness drive */
  setLoudnessDrive(loudness01) {
    this._loudnessTarget = Math.min(1, Math.max(0, loudness01));
  }

  trigger() {
    if (!this.planet?.mesh) return;
    if (!this._halves) {
      this._buildHalves();
    }
    this.active = true;
    this._elapsed = 0;
    this._quietElapsed = 0;
    this.planet.mesh.visible = false;
    this.group.visible = true;
  }

  update(dt) {
    const step = Math.max(0, dt || 0);
    this._loudnessSm += (this._loudnessTarget - this._loudnessSm) * 0.18;
    if (!this.active || !this._halves) return;

    this._syncGroupToPlanet();
    this._elapsed += step;

    if (
      this._loudnessTarget > PLANET_SHATTER_REUNITE_THRESHOLD ||
      this._loudnessSm > PLANET_SHATTER_REUNITE_THRESHOLD
    ) {
      this._musicSplitMode = true;
    }

    let sepFactor;
    if (this._musicSplitMode) {
      sepFactor =
        planetHalfSeparationFactorFromLoudness(this._loudnessSm) *
        Math.min(1, this._elapsed / PLANET_SHATTER_ATTACK_SEC);
      if (
        this._loudnessSm < PLANET_SHATTER_REUNITE_THRESHOLD &&
        this._loudnessTarget < PLANET_SHATTER_REUNITE_THRESHOLD
      ) {
        this._quietElapsed += step;
        if (this._quietElapsed >= PLANET_SHATTER_REUNITE_QUIET_SEC) {
          this._finish();
          return;
        }
      } else {
        this._quietElapsed = 0;
      }
    } else {
      const t = Math.min(1, this._elapsed / PLANET_SHATTER_DURATION_SEC);
      sepFactor = planetShatterSeparationFactor(t);
      if (t >= 1) {
        this._finish();
        return;
      }
    }

    this._applySeparation(sepFactor);
  }

  /** @param {number} sepFactor — 0..1+ separation multiplier */
  _applySeparation(sepFactor) {
    if (!this._halves) return;
    const sep = this._maxSep * sepFactor;
    const [upper, lower] = this._halves;
    upper.position.set(0, sep * 0.5, 0);
    lower.position.set(0, -sep * 0.5, 0);
    const wobble = sepFactor * 0.22;
    upper.rotation.x = wobble * 0.35;
    lower.rotation.x = -wobble * 0.35;
    upper.rotation.z = wobble * 0.18;
    lower.rotation.z = -wobble * 0.18;
  }

  dispose() {
    this._disposeHalves();
    this.planet?.pivot?.remove(this.group);
  }

  _syncGroupToPlanet() {
    const mesh = this.planet.mesh;
    this.group.position.copy(mesh.position);
    this.group.quaternion.copy(mesh.quaternion);
  }

  _buildHalves() {
    const { mesh } = this.planet;
    const { positive, negative } = splitSphereGeometryAtEquator(mesh.geometry);
    const shellMat = mesh.material.clone();
    const interiorMat = createPlanetHalfInteriorMaterial();
    const upper = new THREE.Mesh(positive, [shellMat, interiorMat]);
    const lower = new THREE.Mesh(negative, [shellMat.clone(), interiorMat.clone()]);
    upper.name = "planetHalfUpper";
    lower.name = "planetHalfLower";
    this.group.add(upper, lower);
    this._halves = [upper, lower];
    this._syncGroupToPlanet();
  }

  _finish() {
    this.active = false;
    this._elapsed = 0;
    this._quietElapsed = 0;
    this._musicSplitMode = false;
    this.group.visible = false;
    if (this._halves) {
      for (const half of this._halves) {
        half.position.set(0, 0, 0);
        half.rotation.set(0, 0, 0);
      }
    }
    this.planet.mesh.visible = true;
  }

  _disposeHalves() {
    if (!this._halves) return;
    for (const half of this._halves) {
      this.group.remove(half);
      half.geometry.dispose();
      const mats = Array.isArray(half.material) ? half.material : [half.material];
      for (const m of mats) m.dispose();
    }
    this._halves = null;
  }
}
