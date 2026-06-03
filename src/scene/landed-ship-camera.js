import * as THREE from "three";

const _worldUp = new THREE.Vector3(0, 1, 0);
const _horizonTangent = new THREE.Vector3();

/** World units: camera offset along the local horizon (side-on, not above the pad). */
export const LANDING_HORIZON_CAM_SIDE = 1.75;
export const LANDING_HORIZON_CAM_LIFT = 0.32;
export const LANDED_HORIZON_CAM_SIDE = 3.1;
export const LANDED_HORIZON_CAM_LIFT = 0.52;
/** Extra follow-orbit radius after landing (applied to {@link CameraController} distance scale). */
export const LANDED_ORBIT_DISTANCE_MULT = 1.38;

/**
 * Place the camera beside the landed ship so the frame shows surface horizon + sky shards.
 * @param {import('three').Vector3} shipPosition
 * @param {import('three').Vector3} surfaceNormal — outward from the planet through the ship
 * @param {import('three').Vector3} outPosition
 * @param {number} sideDistance — tangent offset (world units)
 * @param {number} lift — outward normal offset (world units)
 */
export function computeHorizonShipCameraPosition(
  shipPosition,
  surfaceNormal,
  outPosition,
  sideDistance,
  lift,
) {
  _horizonTangent.crossVectors(_worldUp, surfaceNormal);
  if (_horizonTangent.lengthSq() < 1e-8) {
    _horizonTangent.set(1, 0, 0).cross(surfaceNormal);
  }
  _horizonTangent.normalize();
  outPosition
    .copy(shipPosition)
    .addScaledVector(_horizonTangent, sideDistance)
    .addScaledVector(surfaceNormal, lift);
}
