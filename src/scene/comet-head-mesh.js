import * as THREE from "three";

/** Base radius for comet-head style spheres (matches Comet `_initHead`). */
export const COMET_HEAD_BASE_RADIUS = 0.18;

/**
 * Soft translucent orb: low-poly sphere or icosahedron + MeshBasicMaterial.
 * @param {number} worldRadius - desired radius in world units
 * @param {number} color - THREE.Color hex (e.g. 0xfff3d6)
 * @param {{ icosahedronDetail?: number }} [options] - if `icosahedronDetail` is set (0–4 typical), uses
 *   {@link THREE.IcosahedronGeometry} for a faceted “lumpy” look; otherwise a smooth 12×12 sphere.
 * @returns {{ mesh: THREE.Mesh, material: THREE.MeshBasicMaterial }}
 */
export function createCometHeadStyleMesh(worldRadius, color, options = {}) {
  const { icosahedronDetail } = options;
  const geo =
    typeof icosahedronDetail === "number"
      ? new THREE.IcosahedronGeometry(COMET_HEAD_BASE_RADIUS, icosahedronDetail)
      : new THREE.SphereGeometry(COMET_HEAD_BASE_RADIUS, 12, 12);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.88,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(worldRadius / COMET_HEAD_BASE_RADIUS);
  return { mesh, material: mat };
}
