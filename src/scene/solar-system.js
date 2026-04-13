import * as THREE from "three";
import { createCometHeadStyleMesh } from "./comet-head-mesh.js";
import { attachPlanetInteriorGoop } from "./planet-goop-material.js";

/** World-space radius of the sun mesh (matches previous SphereGeometry(6) size). */
const SUN_WORLD_RADIUS = 6;
/** Warm cream aligned with scene PointLight (`_setupLights`). */
const SUN_HEAD_COLOR = 0xfff3d6;

const PLANET_DEFS = [
  { color: 0x60a5fa, radius: 0.9, orbit: 12, speed: 0.3,  label: "Blue"   },
  { color: 0xf87171, radius: 0.6, orbit: 20, speed: 0.2,  label: "Red"    },
  { color: 0x4ade80, radius: 1.1, orbit: 30, speed: 0.12, label: "Green"  },
  { color: 0xfbbf24, radius: 0.5, orbit: 40, speed: 0.08, label: "Gold"   },
  { color: 0xa78bfa, radius: 0.75, orbit: 52, speed: 0.05, label: "Violet" },
];

class SolarSystem {
  constructor(isMobile = false) {
    this.isMobile = isMobile;
    this._brightness = 0.4;
    this._targetBrightness = 0.4;
    this._spectrumResponse = 1.35;
    this.sun = this._createSun();
    this.sunLight = null;
    this.planets = PLANET_DEFS.map((def) => this._createPlanet(def));
    this.starField = this._createStars();
  }

  get primary() {
    return this.planets[0];
  }

  addToScene(scene) {
    // Place sun far from blue planet (Earth-Sun distance ~150 million km, scale for scene)
    // Assume blue planet is at orbit=12, so sun should be at (12 + 150) units along X
    this.sun.position.set(162, 0, 0); // 12 (blue planet orbit) + 150 (scaled distance)
    scene.add(this.sun);
    for (let i = 0; i < this.planets.length; i++) {
      if (i === 0) {
        this.planets[i].pivot.visible = true;
      } else {
        this.planets[i].pivot.visible = false;
      }
      scene.add(this.planets[i].pivot);
    }
    scene.add(this.starField);
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

    this._brightness += (this._targetBrightness - this._brightness) * 0.1;
    const b = Math.min(Math.max(this._brightness, 0.42), 2.0);
    if (this._sunMat) {
      this._sunMat.opacity = Math.min(0.5 + b * 0.35, 0.95);
    }
  }

  /**
   * Same loudness mapping as {@link Comet#setLoudness} (spectrum-driven pulsing).
   * @param {number} loudness
   */
  setLoudness(loudness) {
    this._targetBrightness = 0.32 + loudness * this._spectrumResponse;
  }

  _createSun() {
    const { mesh, material } = createCometHeadStyleMesh(SUN_WORLD_RADIUS, SUN_HEAD_COLOR);
    this._sunMat = material;
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
    mesh.position.set(def.orbit, 0, 0);
    pivot.add(mesh);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    return { mesh, material: mat, pivot, def, goopMaterial };
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
    const sunLight = new THREE.PointLight(0xfff3d6, 6, 300, 0.64); // Increased intensity
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x6b6f88, 0.5)); // Increased ambient
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x101020, 0.5));
    return sunLight;
  }
}

export { PLANET_DEFS };
export default SolarSystem;
