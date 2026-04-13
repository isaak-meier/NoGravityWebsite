import * as THREE from "three";

/** Radius multiplier for inner shell (slightly smaller than outer so the crust reads as a shell). */
export const PLANET_GOOP_INNER_SCALE = 0.93;

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vLocalDir;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vLocalDir = normalize(position);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;

varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vLocalDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

void main() {
  float t = uTime;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPosition);

  // --- Concentric ripples on the inner sphere (rain-on-puddle read) ---
  vec3 d = vLocalDir;
  float lon = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float rip1 = sin(lon * 14.0 + t * 1.1) * sin(lat * 11.0 - t * 0.85);
  float rip2 = sin(lon * 23.0 - t * 0.9) * cos(lat * 18.0 + t * 0.6);
  float ripples = rip1 * 0.55 + rip2 * 0.35;
  ripples = ripples * 0.5 + 0.5;

  // --- Slow turbulent shimmer (under-surface) ---
  vec3 p = vWorldPos * 2.6 + vec3(t * 0.06, t * 0.04, t * 0.07);
  float n1 = noise3(p);
  float n2 = noise3(p * 2.8 + vec3(1.7, 0.0, 2.2));
  float n3 = noise3(p * 6.1 - vec3(t * 0.15));
  float n = n1 * 0.52 + n2 * 0.32 + n3 * 0.16;
  float caust = smoothstep(0.55, 0.92, n * n2) * (0.35 + 0.65 * ripples);

  // --- Palette: deep pool, teal body, cyan spec / caustic ---
  vec3 poolDeep = vec3(0.02, 0.06, 0.09);
  vec3 poolMid = vec3(0.04, 0.22, 0.28);
  vec3 poolLit = vec3(0.12, 0.62, 0.72);
  vec3 caustBright = vec3(0.45, 0.92, 0.98);
  vec3 edgeSheen = vec3(0.75, 0.92, 1.0);

  vec3 col = mix(poolDeep, poolMid, n);
  col = mix(col, poolLit, smoothstep(0.2, 0.75, ripples) * 0.55);
  col = mix(col, uTint * vec3(0.55, 0.6, 0.65), 0.22);
  col += caustBright * caust * 0.42;
  col += 0.06 * vec3(n1, n2 * 0.9, n3);

  // View-dependent liquid edge + soft spec (puddle rim)
  float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.8);
  col += edgeSheen * fres * 0.38;
  vec3 L = normalize(vec3(0.25, 0.92, 0.18));
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 48.0);
  col += vec3(0.55, 0.88, 1.0) * spec * 0.55;

  // Slight vignette on dome so center feels like still water
  float dome = pow(0.48 + 0.52 * abs(N.y), 1.15);
  col *= 0.78 + 0.22 * dome;

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Interior shell material: only visible from inside the sphere (BackSide). Liquid pool: ripples, caustics, fresnel edge.
 * @param {number} tintHex - planet surface color for subtle tint
 * @returns {THREE.ShaderMaterial}
 */
export function createPlanetGoopMaterial(tintHex) {
  const tint = new THREE.Color(tintHex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: true,
  });
}

/**
 * Adds a slightly smaller inner shell as a child of the planet mesh so flying inside shows the puddle interior.
 * @param {THREE.Mesh} planetMesh
 * @param {{ radius: number, color: number }} def
 * @param {boolean} isMobile
 * @returns {THREE.ShaderMaterial}
 */
export function attachPlanetInteriorGoop(planetMesh, def, isMobile) {
  const innerR = def.radius * PLANET_GOOP_INNER_SCALE;
  const segs = isMobile ? 28 : 48;
  const geo = new THREE.SphereGeometry(innerR, segs, segs);
  const mat = createPlanetGoopMaterial(def.color);
  const inner = new THREE.Mesh(geo, mat);
  inner.name = "planetInteriorGoop";
  inner.renderOrder = -1;
  planetMesh.add(inner);
  return mat;
}
