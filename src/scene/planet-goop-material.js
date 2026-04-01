import * as THREE from "three";

/** Radius multiplier for inner shell (slightly smaller than outer so the crust reads as a shell). */
export const PLANET_GOOP_INNER_SCALE = 0.93;

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;

varying vec3 vNormal;
varying vec3 vWorldPos;

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
  vec3 p = vWorldPos * 3.8 + vec3(t * 0.07, t * 0.05, t * 0.09);
  float n1 = noise3(p);
  float n2 = noise3(p * 2.4 + vec3(2.1, 0.0, 1.7));
  float n3 = noise3(p * 5.2 - vec3(t * 0.2));
  float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  float flow = sin(n * 10.0 + t * 2.2) * 0.5 + 0.5;

  vec3 slimeA = vec3(0.95, 0.12, 0.55);
  vec3 slimeB = vec3(0.15, 0.88, 0.55);
  vec3 slimeC = vec3(0.4, 0.35, 1.0);
  vec3 slimeD = vec3(1.0, 0.75, 0.15);

  vec3 col = mix(slimeA, slimeB, n);
  col = mix(col, slimeC, smoothstep(0.15, 0.85, flow));
  col = mix(col, slimeD, smoothstep(0.35, 0.95, n2 * n3));
  col = mix(col, uTint, 0.28);
  col += 0.07 * vec3(n1, n2, n3);

  float rim = pow(0.5 + 0.5 * abs(normalize(vNormal).z), 1.35);
  col *= 0.62 + 0.38 * rim;

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Interior shell material: only visible from inside the sphere (BackSide). Colorful animated slime.
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
 * Adds a slightly smaller inner shell as a child of the planet mesh so flying inside shows animated goop.
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
