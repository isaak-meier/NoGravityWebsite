import * as THREE from "three";

/**
 * Booster ring + smoke-trail visuals for the shard-flight ship.
 *
 * 7 nozzles + cone flames are parented to the ship group at its rear ring;
 * a single Points particle system in world space carries the smoke trail so
 * the puffs lag behind as the ship pulls away (the way a real rocket plume
 * stays roughly stationary in the world frame after combustion exits the
 * nozzle, while the vehicle keeps moving).
 */

const BOOSTER_COUNT = 7;
const BOOSTER_RING_RADIUS = 0.05;
/** Local +Z is the rear of the ship after the hull's -PI/2 X-rotation flip (see shard-flight-game.js). */
const BOOSTER_BACK_Z = 0.165;
const NOZZLE_OUTER_RADIUS = 0.014;
const NOZZLE_INNER_RADIUS = 0.011;
const NOZZLE_LENGTH = 0.05;
const FLAME_MAX_LENGTH = 0.32;
const FLAME_MAX_RADIUS = 0.026;
const SMOKE_MAX_PARTICLES = 320;
/** Min / max per-particle lifetime, seconds. Drives the fade-out curve in the shader. */
const SMOKE_LIFE_MIN = 1.1;
const SMOKE_LIFE_MAX = 1.95;
/** Exponential drag on the smoke particle velocities — e-fold every ~0.6s. */
const SMOKE_DRAG_PER_SEC = 1.55;

function makeSmokePuffTexture() {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.78, "rgba(255,255,255,0.18)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeNozzleMesh(nozzleGeo, nozzleMat, x, y) {
  const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
  nozzle.position.set(x, y, BOOSTER_BACK_Z + NOZZLE_LENGTH * 0.5);
  // ConeGeometry / CylinderGeometry default to a Y axis; rotate so the axis lies along ship +Z.
  nozzle.rotation.x = Math.PI / 2;
  return nozzle;
}

function makeFlameMesh(flameGeo, x, y) {
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(x, y, BOOSTER_BACK_Z + NOZZLE_LENGTH + FLAME_MAX_LENGTH * 0.5);
  flame.rotation.x = Math.PI / 2;
  flame.scale.setScalar(0.0001);
  return flame;
}

/**
 * Build {@link BOOSTER_COUNT} evenly-spaced nozzle + flame pairs as children of `parent`
 * (typically the ship group). The flames render additively and are scaled / faded each
 * frame by {@link updateBoosterFlames}.
 *
 * @param {THREE.Object3D} parent
 * @returns {{
 *   nozzles: THREE.Mesh[],
 *   flames: THREE.Mesh[],
 *   localPositions: THREE.Vector3[],
 *   _geo: THREE.BufferGeometry[],
 *   _mats: THREE.Material[]
 * }}
 */
export function buildBoosterRing(parent) {
  const nozzleGeo = new THREE.CylinderGeometry(
    NOZZLE_INNER_RADIUS,
    NOZZLE_OUTER_RADIUS,
    NOZZLE_LENGTH,
    12,
    1,
    false,
  );
  const flameGeo = new THREE.ConeGeometry(FLAME_MAX_RADIUS, FLAME_MAX_LENGTH, 14, 1, true);
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0x111827,
    emissiveIntensity: 0.4,
  });
  const nozzles = [];
  const flames = [];
  const localPositions = [];
  const flameMats = [];
  for (let i = 0; i < BOOSTER_COUNT; i++) {
    const angle = (i / BOOSTER_COUNT) * Math.PI * 2;
    const x = Math.cos(angle) * BOOSTER_RING_RADIUS;
    const y = Math.sin(angle) * BOOSTER_RING_RADIUS;
    const nozzle = makeNozzleMesh(nozzleGeo, nozzleMat, x, y);
    nozzle.frustumCulled = false;
    parent.add(nozzle);
    nozzles.push(nozzle);
    const flame = makeFlameMesh(flameGeo, x, y);
    flame.frustumCulled = false;
    parent.add(flame);
    flames.push(flame);
    flameMats.push(/** @type {THREE.Material} */ (flame.material));
    // Nozzle exit (where smoke spawns) sits at the front face of the flame cone.
    localPositions.push(new THREE.Vector3(x, y, BOOSTER_BACK_Z + NOZZLE_LENGTH));
  }
  return {
    nozzles,
    flames,
    localPositions,
    _geo: [nozzleGeo, flameGeo],
    _mats: [nozzleMat, ...flameMats],
  };
}

/**
 * @param {ReturnType<typeof buildBoosterRing>} boosters
 * @param {number} intensity 0 = off, 1 = full throttle, >1 = boost (we clamp 0..2).
 * @param {number} dt
 */
export function updateBoosterFlames(boosters, intensity, dt) {
  const norm = Math.max(0, Math.min(2, intensity));
  const easeIn = Math.min(1, dt * 22);
  const flicker = 0.88 + Math.random() * 0.24;
  const targetWidth = (0.35 + norm * 0.55) * flicker;
  const targetLength = (0.18 + norm * 1.0) * flicker;
  const targetOpacity = norm > 0.02 ? Math.min(1, 0.5 + norm * 0.45) : 0;
  const hex = norm > 1.05 ? 0xfff2b3 : norm > 0.5 ? 0xffd166 : 0xff8a32;
  for (const flame of boosters.flames) {
    flame.scale.x += (targetWidth - flame.scale.x) * easeIn;
    flame.scale.y += (targetLength - flame.scale.y) * easeIn;
    flame.scale.z += (targetWidth - flame.scale.z) * easeIn;
    const mat = /** @type {THREE.MeshBasicMaterial} */ (flame.material);
    mat.opacity += (targetOpacity - mat.opacity) * easeIn;
    mat.color.setHex(hex);
  }
}

const SMOKE_VERT_SHADER = `
  attribute float aAge;
  attribute float aLife;
  attribute float aSize;
  uniform float uScale;
  varying float vAlpha;
  varying float vAgeFrac;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float ageFrac = clamp(aAge / aLife, 0.0, 1.0);
    vAgeFrac = ageFrac;
    float fadeIn = smoothstep(0.0, 0.06, ageFrac);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, ageFrac);
    vAlpha = ageFrac < 1.0 ? fadeIn * fadeOut : 0.0;
    float sizeMul = mix(0.7, 2.3, ageFrac);
    gl_PointSize = aSize * sizeMul * uScale / max(0.0001, -mv.z);
  }
`;

const SMOKE_FRAG_SHADER = `
  uniform sampler2D uTexture;
  varying float vAlpha;
  varying float vAgeFrac;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    vec3 hot = vec3(1.0, 0.72, 0.28);
    vec3 mid = vec3(0.78, 0.66, 0.55);
    vec3 cool = vec3(0.74, 0.80, 0.88);
    vec3 col = mix(hot, mid, smoothstep(0.0, 0.22, vAgeFrac));
    col = mix(col, cool, smoothstep(0.22, 0.7, vAgeFrac));
    gl_FragColor = vec4(col, tex.a * vAlpha * 0.92);
  }
`;

function makeSmokeBuffers() {
  const positions = new Float32Array(SMOKE_MAX_PARTICLES * 3);
  const velocities = new Float32Array(SMOKE_MAX_PARTICLES * 3);
  const ages = new Float32Array(SMOKE_MAX_PARTICLES);
  const lifes = new Float32Array(SMOKE_MAX_PARTICLES);
  const sizes = new Float32Array(SMOKE_MAX_PARTICLES);
  for (let i = 0; i < SMOKE_MAX_PARTICLES; i++) {
    ages[i] = SMOKE_LIFE_MAX + 1;
    lifes[i] = 1;
    sizes[i] = 0.1;
  }
  return { positions, velocities, ages, lifes, sizes };
}

/**
 * Custom-shader Points system whose particles each carry their own age / life / size so the
 * trail fades and expands per-particle (vanilla PointsMaterial can't do that — it only
 * supports uniform opacity).
 *
 * @returns {THREE.Points & { userData: {
 *   positions: Float32Array,
 *   velocities: Float32Array,
 *   ages: Float32Array,
 *   lifes: Float32Array,
 *   sizes: Float32Array,
 *   head: number,
 *   tex: THREE.Texture,
 *   uniforms: { uTexture: { value: THREE.Texture }, uScale: { value: number } },
 * } }}
 */
export function createSmokeTrail() {
  const { positions, velocities, ages, lifes, sizes } = makeSmokeBuffers();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aAge", new THREE.BufferAttribute(ages, 1));
  geo.setAttribute("aLife", new THREE.BufferAttribute(lifes, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const tex = makeSmokePuffTexture();
  const uniforms = {
    uTexture: { value: tex },
    uScale: { value: 420.0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SMOKE_VERT_SHADER,
    fragmentShader: SMOKE_FRAG_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData = {
    positions,
    velocities,
    ages,
    lifes,
    sizes,
    head: 0,
    tex,
    uniforms,
  };
  return pts;
}

/**
 * Spawn `count` particles distributed across the supplied nozzle world positions. Each
 * particle inherits a fraction of the ship's velocity (so the plume drags behind realistically)
 * plus a random jitter.
 *
 * @param {ReturnType<typeof createSmokeTrail>} smoke
 * @param {THREE.Vector3[]} nozzleWorldPositions
 * @param {THREE.Vector3} shipWorldVelocity
 * @param {number} count
 * @param {number} [exhaustSpeed] base outward speed (away from ship) for hot exhaust gases
 */
export function emitSmoke(smoke, nozzleWorldPositions, shipWorldVelocity, count, exhaustSpeed = 0.6) {
  if (count <= 0 || nozzleWorldPositions.length === 0) return;
  const d = smoke.userData;
  for (let i = 0; i < count; i++) {
    const head = d.head;
    d.head = (head + 1) % SMOKE_MAX_PARTICLES;
    const nozzle = nozzleWorldPositions[i % nozzleWorldPositions.length];
    const jx = (Math.random() - 0.5) * 0.02;
    const jy = (Math.random() - 0.5) * 0.02;
    const jz = (Math.random() - 0.5) * 0.02;
    d.positions[head * 3] = nozzle.x + jx;
    d.positions[head * 3 + 1] = nozzle.y + jy;
    d.positions[head * 3 + 2] = nozzle.z + jz;
    // Inherit a slice of ship velocity (plume mostly stays put in world frame) plus jitter.
    const spreadX = (Math.random() - 0.5) * exhaustSpeed;
    const spreadY = (Math.random() - 0.5) * exhaustSpeed;
    const spreadZ = (Math.random() - 0.5) * exhaustSpeed;
    d.velocities[head * 3] = shipWorldVelocity.x * 0.35 + spreadX;
    d.velocities[head * 3 + 1] = shipWorldVelocity.y * 0.35 + spreadY;
    d.velocities[head * 3 + 2] = shipWorldVelocity.z * 0.35 + spreadZ;
    d.ages[head] = 0;
    d.lifes[head] = SMOKE_LIFE_MIN + Math.random() * (SMOKE_LIFE_MAX - SMOKE_LIFE_MIN);
    d.sizes[head] = 0.07 + Math.random() * 0.05;
  }
  smoke.geometry.attributes.position.needsUpdate = true;
  smoke.geometry.attributes.aAge.needsUpdate = true;
  smoke.geometry.attributes.aLife.needsUpdate = true;
  smoke.geometry.attributes.aSize.needsUpdate = true;
}

/**
 * Advance ages, integrate velocities with exponential drag, and flag the position +
 * age attributes dirty so the next draw uploads them.
 *
 * @param {ReturnType<typeof createSmokeTrail>} smoke
 * @param {number} dt
 */
export function updateSmokeTrail(smoke, dt) {
  const d = smoke.userData;
  const drag = Math.exp(-SMOKE_DRAG_PER_SEC * dt);
  for (let i = 0; i < SMOKE_MAX_PARTICLES; i++) {
    if (d.ages[i] >= d.lifes[i]) continue;
    d.ages[i] += dt;
    const ix = i * 3;
    d.positions[ix] += d.velocities[ix] * dt;
    d.positions[ix + 1] += d.velocities[ix + 1] * dt;
    d.positions[ix + 2] += d.velocities[ix + 2] * dt;
    d.velocities[ix] *= drag;
    d.velocities[ix + 1] *= drag;
    d.velocities[ix + 2] *= drag;
  }
  smoke.geometry.attributes.position.needsUpdate = true;
  smoke.geometry.attributes.aAge.needsUpdate = true;
}

/**
 * Kill all live particles. Cheaper than rebuilding the buffers when the ship resets.
 * @param {ReturnType<typeof createSmokeTrail>} smoke
 */
export function clearSmokeTrail(smoke) {
  const d = smoke.userData;
  for (let i = 0; i < SMOKE_MAX_PARTICLES; i++) {
    d.ages[i] = d.lifes[i] + 1;
  }
  smoke.geometry.attributes.aAge.needsUpdate = true;
}

/**
 * Resize-aware: update the shader's pixel-scale uniform so smoke puffs keep a consistent
 * world size regardless of viewport height.
 * @param {ReturnType<typeof createSmokeTrail>} smoke
 * @param {number} viewportHeight
 */
export function setSmokeTrailViewportHeight(smoke, viewportHeight) {
  smoke.userData.uniforms.uScale.value = Math.max(120, viewportHeight * 0.5);
}

/**
 * @param {ReturnType<typeof buildBoosterRing>} boosters
 * @param {THREE.Object3D} parent
 */
export function disposeBoosters(boosters, parent) {
  for (const m of boosters.nozzles) parent.remove(m);
  for (const m of boosters.flames) parent.remove(m);
  for (const g of boosters._geo) g.dispose();
  for (const mat of boosters._mats) mat.dispose();
}

/**
 * @param {ReturnType<typeof createSmokeTrail>} smoke
 * @param {THREE.Scene} scene
 */
export function disposeSmokeTrail(smoke, scene) {
  scene.remove(smoke);
  smoke.geometry.dispose();
  const m = smoke.material;
  if (Array.isArray(m)) m.forEach((x) => x.dispose());
  else m.dispose();
  smoke.userData.tex.dispose();
}
